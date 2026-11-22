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
// By default the designer is a local model through Ollama (free, nothing
// leaves this machine): the Ollama app must be running and have the model
// (`ollama pull qwen3.5:9b`).
//
// Options:
//   --theme "..."        what kind of room (optional; the model picks otherwise)
//   --count N            how many levels to make (default 1)
//   --rounds N           design + fix turns per level before giving up (default 8; 4 with Claude)
//   --model NAME         the model (default qwen3.5:9b; claude-opus-5-5 with Claude)
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
//   --dry-run            print the prompt and the schema; call nothing, write nothing
//   --no-write           design and validate, but leave catalog.js alone
//
// Review a new level in the game before committing it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVELS, EXAMPLE_LEVELS } from '../src/levels/index.js';
import { generateLevel, catalogEntry, addToCatalog, freeId } from '../src/levels/generate.js';
import { designPrompt, systemPrompt, LEVEL_SCHEMA } from '../src/levels/prompt.js';
import { ollamaDesigner, checkOllama, OLLAMA_MODEL, OLLAMA_HOST } from '../src/levels/ollama.js';
import { claudeDesigner, CLAUDE_MODEL } from '../src/levels/claude.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = `${ROOT}src/levels/catalog.js`;

function args(argv) {
  const o = { count: 1, rounds: null, theme: undefined, model: null, think: true, thinkBudget: 8000, host: OLLAMA_HOST, designer: 'ollama', log: `${ROOT}docs/level-runs`, dryRun: false, write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--theme') o.theme = argv[++i];
    else if (a === '--count') o.count = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--rounds') o.rounds = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--no-think') o.think = false;
    else if (a === '--think-budget') o.thinkBudget = Math.max(1000, Number(argv[++i]) || 8000);
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--designer') o.designer = argv[++i];
    else if (a === '--log') o.log = argv[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-write') o.write = false;
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 35).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else { console.error(`Unknown option ${a} (try --help)`); process.exit(2); }
  }
  if (!['ollama', 'claude'].includes(o.designer)) { console.error('--designer is ollama or claude'); process.exit(2); }
  o.model ??= o.designer === 'claude' ? CLAUDE_MODEL : OLLAMA_MODEL;
  o.rounds ??= o.designer === 'claude' ? 4 : 8;
  return o;
}

const opts = args(process.argv.slice(2));
const examples = () => [...LEVELS, ...EXAMPLE_LEVELS];

if (opts.dryRun) {
  const user = designPrompt({ theme: opts.theme, existing: examples() });
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
if (opts.designer === 'ollama') {
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
    `- Designer: ${opts.designer}, model ${outcome.model ?? opts.model}${opts.designer === 'ollama' ? `, thinking ${opts.think ? `on (at most ${opts.thinkBudget} characters a turn)` : 'off'}` : ''}`,
    `- Theme: ${opts.theme ?? '(none: the model chose)'}`,
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
let made = 0;
for (let k = 0; k < opts.count; k++) {
  const started = new Date();
  let outcome;
  try {
    outcome = await generateLevel({
      ask, theme: opts.theme, existing: examples(), maxRounds: opts.rounds,
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
    throw e;
  }
  const date = started.toISOString().slice(0, 10);
  let spec = null;
  if (outcome.ok) {
    spec = {
      ...outcome.spec,
      id: freeId(outcome.spec.id, examples().map((l) => l.id)),
      designedBy: credit(outcome.model),
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
    const entry = catalogEntry(spec, { model: outcome.model, theme: opts.theme, date, rounds: outcome.rounds.length, metrics: outcome.result.metrics });
    writeFileSync(CATALOG, addToCatalog(readFileSync(CATALOG, 'utf8'), entry));
    LEVELS.push(spec); // so the next one differs from it too
    console.log(`Level ${k + 1}: "${spec.name}" (${spec.id}) added to src/levels/catalog.js. Transcript: ${logFile}`);
  } else {
    console.log(`Level ${k + 1}: "${spec.name}" passed (not written). Transcript: ${logFile}\n${JSON.stringify(spec, null, 2)}`);
  }
  made++;
}
console.log(made ? 'Run the tests (npm test) and look at the new rooms in the game before committing.' : 'No levels made.');
