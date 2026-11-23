#!/usr/bin/env node
// A model designs new levels from the furniture inventory; the validator
// checks each one and sends back what to fix; the rooms that pass go into
// src/levels/catalog.js, and with them into the game.
//
// This runs offline, before a release. The game ships the level files and
// never calls a model.
//
//   node scripts/generate-level.mjs --theme "a cramped artist's studio"
//
// By default the designer is Gemini through Google's Gemini API, on its free
// tier. It needs a key, read from GEMINI_API_KEY: make one at
// https://aistudio.google.com/apikey and `export GEMINI_API_KEY=...`. On the
// free tier Google may use what is sent (furniture and the game's rules) to
// improve its products.
//
// Options:
//   --theme "..."        what kind of room (optional; the model picks otherwise)
//   --difficulty D       easy, medium or hard: what to aim for (the validator measures
//                        what it really is, and the game files it under that)
//   --count N            how many levels to make (default 1)
//   --rounds N           design + fix turns per level before giving up
//                        (default 6; 8 with Ollama; 4 with Claude)
//   --model NAME         the model (default gemini-3.8-flash; qwen3.5:9b with
//                        Ollama; claude-opus-5-5 with Claude)
//   --thinking LEVEL     Gemini: minimal, low, medium, high or xhigh (default: the model's own)
//                        (a busy or rate-limited model hands over to gemini-4-hydrogen,
//                        then gemini-3.6-flash; the level records which one designed it)
//   --designer ollama    use a local model through Ollama instead (free and offline,
//                        but on this laptop a room takes 4 to 45 minutes): the Ollama
//                        app must be running and have the model (`ollama pull qwen3.5:9b`)
//   --no-think           Ollama: answer without reasoning first (faster, but this
//                        model then rarely gets a room past the validator)
//   --think-budget N     Ollama: characters of reasoning per turn before it must answer
//                        from its notes (default 8000, about 2,000 tokens)
//   --host URL           Ollama's address (default http://127.0.0.1:11434)
//   --designer claude    use Claude through the Anthropic API instead (paid: needs
//                        `npm install --save-dev @anthropic-ai/sdk` and ANTHROPIC_API_KEY;
//                        server-side fallback on, so a declined request is re-run
//                        on Anthropic's recommended fallback model)
//   --log DIR            where each run's transcript goes (default docs/level-runs)
//   --rescore            measure every generated room again and update the difficulty
//                        stored in catalog.js (after the scoring changes); calls no model
//   --dry-run            print the prompt and the schema; call nothing, write nothing
//   --no-write           design and validate, but leave catalog.js alone
//
// Review a new level in the game before committing it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVELS, EXAMPLE_LEVELS, ORIGINAL } from '../src/levels/index.js';
import { DESIGNED_LEVELS } from '../src/levels/catalog.js';
import { generateLevel, catalogEntry, addToCatalog, freeId, setDifficulty } from '../src/levels/generate.js';
import { validateLevel } from '../src/levels/validate.js';
import { tierOf } from '../src/levels/pool.js';
import { designPrompt, systemPrompt, LEVEL_SCHEMA } from '../src/levels/prompt.js';
import { ollamaDesigner, checkOllama, OLLAMA_MODEL, OLLAMA_HOST } from '../src/levels/ollama.js';
import { claudeDesigner, CLAUDE_MODEL } from '../src/levels/claude.js';
import { geminiDesigner, checkGemini, GEMINI_MODEL, THINKING_LEVELS } from '../src/levels/gemini.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = `${ROOT}src/levels/catalog.js`;

function args(argv) {
  const o = { count: 1, rounds: null, theme: undefined, difficulty: undefined, rescore: false, model: null, thinking: undefined, think: true, thinkBudget: 8000, host: OLLAMA_HOST, designer: 'gemini', log: `${ROOT}docs/level-runs`, dryRun: false, write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--theme') o.theme = argv[++i];
    else if (a === '--difficulty') o.difficulty = argv[++i];
    else if (a === '--rescore') o.rescore = true;
    else if (a === '--count') o.count = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--rounds') o.rounds = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--thinking') o.thinking = argv[++i];
    else if (a === '--no-think') o.think = false;
    else if (a === '--think-budget') o.thinkBudget = Math.max(1000, Number(argv[++i]) || 8000);
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--designer') o.designer = argv[++i];
    else if (a === '--log') o.log = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-write') o.write = false;
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 50).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else { console.error(`Unknown option ${a} (try --help)`); process.exit(2); }
  }
  if (!['gemini', 'ollama', 'claude'].includes(o.designer)) { console.error('--designer is gemini, ollama or claude'); process.exit(2); }
  if (o.difficulty !== undefined && !['easy', 'medium', 'hard'].includes(o.difficulty)) { console.error('--difficulty is easy, medium or hard'); process.exit(2); }
  if (o.thinking !== undefined && !THINKING_LEVELS.includes(o.thinking)) { console.error(`--thinking is one of ${THINKING_LEVELS.join(', ')}`); process.exit(2); }
  o.model ??= { gemini: GEMINI_MODEL, ollama: OLLAMA_MODEL, claude: CLAUDE_MODEL }[o.designer];
  o.rounds ??= { gemini: 6, ollama: 8, claude: 4 }[o.designer];
  return o;
}

const opts = args(process.argv.slice(2));
// Shown to the model in full: the original room and the hand-placed examples.
const examples = [ORIGINAL, ...EXAMPLE_LEVELS];
// The rooms already made: listed by name, so a new one differs from them.
const made = [...DESIGNED_LEVELS];
const takenIds = () => [...examples, ...made].map((l) => l.id);

if (opts.rescore) {
  let source = readFileSync(CATALOG, 'utf8');
  for (const spec of DESIGNED_LEVELS) {
    const d = validateLevel(spec).metrics.difficulty;
    if (d !== spec.difficulty) console.log(`${spec.id}: difficulty ${spec.difficulty ?? 'none'} -> ${d} (${tierOf(d)})`);
    source = setDifficulty(source, spec.id, d);
  }
  writeFileSync(CATALOG, source);
  console.log(`Measured ${DESIGNED_LEVELS.length} rooms; catalog.js is up to date.`);
  process.exit(0);
}

if (opts.dryRun) {
  const user = designPrompt({ theme: opts.theme, target: opts.difficulty, examples, others: made });
  const system = systemPrompt();
  console.log(`=== designer ${opts.designer} | model ${opts.model} | rounds ${opts.rounds}`);
  console.log('\n=== system\n' + system);
  console.log('\n=== user\n' + user);
  console.log('\n=== schema\n' + JSON.stringify(LEVEL_SCHEMA, null, 2));
  console.log(`\n(dry run: nothing sent; about ${Math.round((system.length + user.length) / 4)} input tokens)`);
  process.exit(0);
}

// ------------------------------------------------------------ the designer
let ask, credit;
if (opts.designer === 'gemini') {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const ready = await checkGemini({ apiKey, model: opts.model });
  if (!ready.ok) { console.error(ready.problem); process.exit(1); }
  const onRetry = ({ model, status, reason, wait }) => console.log(wait
    ? `    ... every model was busy; asking again in ${Math.round(wait / 1000)} s`
    : `    ... ${model}: ${reason ?? (status === 429 ? 'free-tier rate limit' : status === 503 ? 'busy (high demand)' : `error ${status}`)}; trying the next model`);
  ask = geminiDesigner({ apiKey, model: opts.model, thinking: opts.thinking, onRetry });
  credit = (served) => `Gemini (${served}) through Google's Gemini API, checked by validate.js`;
  console.log(`Designing ${opts.count} level(s) with ${opts.model} through the Gemini API${opts.theme ? `: ${opts.theme}` : ''}`);
} else if (opts.designer === 'ollama') {
  const ready = await checkOllama({ model: opts.model, host: opts.host });
  if (!ready.ok) { console.error(ready.problem); process.exit(1); }
  // A thinking model can be quiet for minutes: say how far it has got, twice a minute.
  let said = Date.now();
  const onProgress = ({ thinking, answer }) => {
    if (Date.now() - said < 30000) return;
    said = Date.now();
    console.log(`    ... ${answer ? `writing the room (${answer} characters)` : `thinking (${thinking} characters so far)`}`);
  };
  ask = ollamaDesigner({ model: opts.model, host: opts.host, think: opts.think, thinkBudget: opts.thinkBudget, onProgress });
  credit = () => `${opts.model} (a local model, through Ollama), checked by validate.js`;
  console.log(`Designing ${opts.count} level(s) with ${opts.model} on this machine${opts.theme ? `: ${opts.theme}` : ''}`);
} else {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    console.error('The Anthropic SDK is not installed. Run: npm install --save-dev @anthropic-ai/sdk');
    process.exit(1);
  }
  ask = claudeDesigner(new Anthropic(), { model: opts.model }); // ANTHROPIC_API_KEY, or an `ant auth login` profile
  credit = (served) => `Claude (${served}) through the Anthropic API, checked by validate.js`;
  console.log(`Designing ${opts.count} level(s) with ${opts.model} (server-side fallback on)${opts.theme ? `: ${opts.theme}` : ''}`);
}

// ---------------------------------------------------------- the transcript
function transcript(outcome, started, spec) {
  const lines = [
    `# Level run: ${spec?.name ?? outcome.spec?.name ?? 'no room'} (${outcome.ok ? 'passed' : 'failed'})`,
    '',
    `- Date: ${started.toISOString()}`,
    `- Designer: ${opts.designer}, model ${outcome.model ?? opts.model}${opts.designer === 'ollama' ? `, thinking ${opts.think ? `on (at most ${opts.thinkBudget} characters a turn)` : 'off'}` : opts.designer === 'gemini' ? `, thinking ${opts.thinking ?? "the model's default"}` : ''}`,
    `- Theme: ${opts.theme ?? '(none: the model chose)'}`,
    `- Asked for: ${opts.difficulty ?? 'any difficulty'}${outcome.ok ? `; measured difficulty ${outcome.result.metrics.difficulty} (${tierOf(outcome.result.metrics.difficulty)})` : ''}`,
    `- Rounds: ${outcome.rounds.length} of at most ${opts.rounds}`,
    '',
  ];
  for (const r of outcome.rounds) {
    const s = r.stats ? ` (${r.stats.seconds.toFixed(0)} s, ${r.stats.outputTokens} tokens out${r.stats.thinkingCut ? `, thinking cut at ${r.stats.thinkingChars} characters` : ''})` : '';
    lines.push(`## Round ${r.n}${s}`, '');
    if (r.refused) { lines.push('The model declined.', ''); continue; }
    if (r.spec) lines.push('```json', JSON.stringify(r.spec, null, 1), '```', '');
    if (r.errors.length) {
      lines.push('Rejected by the validator:', '');
      for (const e of r.errors) lines.push(`- \`${e.code}\`: ${e.message}`);
      lines.push('');
    } else {
      lines.push(`Passed the validator: ${JSON.stringify(r.metrics)}`, '');
    }
    for (const w of r.warnings) lines.push(`- warning \`${w.code}\`: ${w.message}`);
    if (r.warnings.length) lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ the run
let added = 0;
for (let k = 0; k < opts.count; k++) {
  const started = new Date();
  let outcome;
  try {
    outcome = await generateLevel({
      ask, theme: opts.theme, target: opts.difficulty, examples, others: made, maxRounds: opts.rounds,
      // A local model reads its prompt slowly: it sees its last two answers, not all of them.
      keepRounds: opts.designer === 'ollama' ? 2 : Infinity,
      onRound: (r) => {
        const took = r.stats ? ` (${r.stats.seconds.toFixed(0)} s${r.stats.thinkingCut ? ', thinking cut short' : ''})` : '';
        if (r.refused) return console.log(`  round ${r.n}: declined${took}`);
        const head = `  round ${r.n}${took}: ${r.spec?.name ?? 'unreadable'}`;
        if (!r.errors.length) return console.log(`${head} passed (difficulty ${r.metrics.difficulty}, ${r.metrics.hidingSpots} hiding places)`);
        console.log(`${head} rejected:`);
        for (const e of r.errors) console.log(`    - ${e.code}: ${e.message}`);
      },
    });
  } catch (e) {
    if (opts.designer === 'claude' && (e?.status === 401 || /api key|auth/i.test(String(e?.message)))) {
      console.error('No API credentials: set ANTHROPIC_API_KEY or run `ant auth login`, then try again.');
      process.exit(1);
    }
    if (/busy or rate-limited/.test(String(e?.message))) {
      // The free tier is out of requests for now: keep the rounds done, stop without a stack trace.
      if (e.rounds?.length) {
        mkdirSync(opts.log, { recursive: true });
        const file = `${opts.log}/${started.toISOString().slice(0, 10)}-unfinished-${started.getTime().toString(36)}.md`;
        writeFileSync(file, transcript({ ok: false, rounds: e.rounds, model: null, spec: null }, started, null));
        console.error(`Transcript of the rounds done: ${file}`);
      }
      console.error(`${e.message} The free tier has per-minute and per-day limits (the daily one resets at midnight Pacific time). Rooms made before this are saved.`);
      process.exit(3);
    }
    throw e;
  }
  const date = started.toISOString().slice(0, 10);
  let spec = null;
  if (outcome.ok) {
    spec = {
      ...outcome.spec,
      id: freeId(outcome.spec.id, takenIds()),
      designedBy: credit(outcome.model),
      difficulty: outcome.result.metrics.difficulty,
    };
  }
  mkdirSync(opts.log, { recursive: true });
  const logFile = `${opts.log}/${date}-${spec?.id ?? outcome.spec?.id ?? 'failed'}-${started.getTime().toString(36)}.md`;
  writeFileSync(logFile, transcript(outcome, started, spec));
  if (!outcome.ok) {
    console.log(`Level ${k + 1}: no room passed in ${outcome.rounds.length} rounds; nothing written. Transcript: ${logFile}`);
    continue;
  }
  if (opts.write) {
    const entry = catalogEntry(spec, { model: outcome.model, theme: opts.theme, target: opts.difficulty, date, rounds: outcome.rounds.length, metrics: outcome.result.metrics });
    writeFileSync(CATALOG, addToCatalog(readFileSync(CATALOG, 'utf8'), entry));
    made.push(spec); // so the next one differs from it too
    console.log(`Level ${k + 1}: "${spec.name}" (${spec.id}), difficulty ${spec.difficulty} (${tierOf(spec.difficulty)}${opts.difficulty && opts.difficulty !== tierOf(spec.difficulty) ? `; asked for ${opts.difficulty}` : ''}), added to src/levels/catalog.js. Transcript: ${logFile}`);
  } else {
    console.log(`Level ${k + 1}: "${spec.name}" passed (not written). Transcript: ${logFile}\n${JSON.stringify(spec, null, 2)}`);
  }
  added++;
}
console.log(added ? 'Run the tests (npm test) and look at the new rooms in the game before committing.' : 'No levels made.');
