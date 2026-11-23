// A model designs a level; the validator checks it; the model fixes what failed.
//
// generateLevel() runs that loop with whichever designer it is given: Gemini
// through Google's API (gemini.js, the script's default: free tier, fast), a
// local model through Ollama (ollama.js: free and offline, slow on a laptop),
// Claude through the Anthropic API (claude.js), or a fake one in the tests. It returns the
// first room that passes validate.js, or the last attempt and why it failed.
// Nothing here touches files; catalogEntry() and addToCatalog() only format
// text for scripts/generate-level.mjs to write.
//
// No Three.js, no SDK: runs headless.

import { validateLevel } from './validate.js';
import { LEVEL_SCHEMA, systemPrompt, designPrompt, feedbackPrompt, parseLevel } from './prompt.js';
import { MISSIONS_SCHEMA, missionsSystemPrompt, missionsPrompt, missionsFeedback, parseMissions } from './missionPrompt.js';
import { validateMissions } from '../core/missions.js';

/**
 * A designer is one function: given the instructions, the conversation so far
 * and the schema, it returns the model's next answer.
 * @typedef {(turn: {system: string, messages: object[], schema: object}) => Promise<{
 *   text: string, model: string, stop: 'done'|'refused'|'truncated', assistant: object, detail?: object, stats?: object}>} Designer
 */

/**
 * @param {object} opts
 * @param {Designer} opts.ask
 * @param {string} [opts.theme]       what kind of room to ask for
 * @param {'easy'|'medium'|'hard'} [opts.target]  how hard it should play
 * @param {object[]} opts.examples    rooms that pass the validator, shown in full
 * @param {object[]} [opts.others]    rooms already made, by name, to differ from
 * @param {number} [opts.maxRounds]   design + fix turns before giving up
 * @param {number} [opts.keepRounds]  how many past answers (and the feedback on them) the model
 *   sees again; the feedback carries the whole current floor plan, so a small local model
 *   can do with the last two and reads a much shorter prompt each turn
 * @param {(round: object) => void} [opts.onRound]  called after each turn, for progress
 * @returns {Promise<{ok: boolean, spec: object|null, result: object|null, rounds: object[], model: string|null}>}
 */
export async function generateLevel(opts) {
  const { ask, theme, target, examples, others, maxRounds = 4, keepRounds = Infinity, onRound } = opts;
  const system = systemPrompt();
  const first = { role: 'user', content: designPrompt({ theme, target, examples, others }) };
  let past = []; // [answer, feedback] pairs, oldest first
  const rounds = [];
  let spec = null, result = null, served = null;
  for (let n = 1; n <= maxRounds; n++) {
    let reply;
    try {
      reply = await ask({ system, messages: [first, ...past.flat()], schema: LEVEL_SCHEMA });
    } catch (e) {
      // The designer gave up (a bad key, or every model busy): keep what was done, for the transcript.
      e.rounds = rounds;
      throw e;
    }
    served = reply.model;
    if (reply.stop === 'refused') {
      const round = { n, refused: true, detail: reply.detail ?? null, stats: reply.stats };
      rounds.push(round);
      onRound?.(round);
      return { ok: false, spec, result, rounds, model: served };
    }
    let feedback;
    try {
      if (reply.stop === 'truncated') throw new Error('the answer was cut off');
      spec = parseLevel(reply.text);
      result = validateLevel(spec);
      feedback = result.ok ? null : feedbackPrompt(result);
    } catch (e) {
      spec = null;
      result = null;
      feedback = `That answer could not be read as a room (${e.message}). Return the whole room as JSON in the schema.`;
    }
    const round = { n, spec, errors: result?.errors ?? [{ code: 'unreadable', message: feedback }], warnings: result?.warnings ?? [], metrics: result?.metrics ?? null, stats: reply.stats };
    rounds.push(round);
    onRound?.(round);
    if (!feedback) return { ok: true, spec, result, rounds, model: served };
    past.push([reply.assistant, { role: 'user', content: feedback }]);
    if (past.length > keepRounds) past = past.slice(-keepRounds);
  }
  return { ok: false, spec, result, rounds, model: served };
}

/**
 * A model writes a room's two missions; validateMissions checks them against
 * what the room holds; the model fixes what can't be done.
 * @param {object} opts
 * @param {Designer} opts.ask
 * @param {object} opts.spec        the room
 * @param {object} opts.contents    contentsOf() for it
 * @param {string[]} opts.safeSpots validate.js metrics.safeSpotIds
 * @param {number} opts.goal        its chaos goal
 * @param {number} [opts.maxRounds]
 * @param {(round: object) => void} [opts.onRound]
 * @returns {Promise<{ok: boolean, missions: object[]|null, rounds: object[], model: string|null}>}
 */
export async function generateMissions(opts) {
  const { ask, spec, contents, safeSpots, goal, maxRounds = 3, onRound } = opts;
  const system = missionsSystemPrompt();
  const messages = [{ role: 'user', content: missionsPrompt({ spec, contents, safeSpots, goal }) }];
  const rounds = [];
  let served = null;
  for (let n = 1; n <= maxRounds; n++) {
    let reply;
    try {
      reply = await ask({ system, messages, schema: MISSIONS_SCHEMA });
    } catch (e) {
      e.rounds = rounds;
      throw e;
    }
    served = reply.model;
    if (reply.stop === 'refused') {
      rounds.push({ n, refused: true, errors: [], stats: reply.stats });
      onRound?.(rounds.at(-1));
      return { ok: false, missions: null, rounds, model: served };
    }
    let missions = null, errors;
    try {
      if (reply.stop === 'truncated') throw new Error('the answer was cut off');
      missions = parseMissions(reply.text);
      errors = validateMissions(missions, contents, safeSpots);
    } catch (e) {
      errors = [`That answer could not be read as missions (${e.message}).`];
    }
    rounds.push({ n, missions, errors, stats: reply.stats });
    onRound?.(rounds.at(-1));
    if (!errors.length) return { ok: true, missions, rounds, model: served };
    messages.push(reply.assistant, { role: 'user', content: missionsFeedback(errors) });
  }
  return { ok: false, missions: null, rounds, model: served };
}

/** An id not taken yet: the model's own, or with -2, -3... after it. */
export function freeId(id, taken) {
  if (!taken.includes(id)) return id;
  for (let k = 2; ; k++) if (!taken.includes(`${id}-${k}`)) return `${id}-${k}`;
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const fields = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : v}`).join(', ')} }`;

/**
 * A level as catalog.js source, with a comment saying how it was made.
 * @param {object} spec  a level description that passed validate.js
 * @param {{model: string, theme?: string, date: string, rounds: number, metrics: object}} meta
 */
export function catalogEntry(spec, meta) {
  const m = meta.metrics;
  return [
    `  // Generated ${meta.date} by ${meta.model}${meta.theme ? ` (theme: ${meta.theme.replace(/\n/g, ' ')})` : ''}, passed validate.js`,
    `  // on round ${meta.rounds}${meta.target ? ` (asked for ${meta.target})` : ''}: ${m.hidingSpots} hiding places, ${m.freeFloor} m² open floor, difficulty ${m.difficulty}.`,
    '  {',
    `    id: ${q(spec.id)},`,
    `    name: ${q(spec.name)},`,
    `    blurb: ${q(spec.blurb)},`,
    `    designedBy: ${q(spec.designedBy)},`,
    ...(spec.difficulty ? [`    difficulty: ${spec.difficulty},`] : []),
    '    pieces: [',
    ...spec.pieces.map((p) => `      ${fields(p)},`),
    '    ],',
    `    cat: ${fields(spec.cat)},`,
    '  },',
  ].join('\n');
}

/** catalog.js with a level's stored difficulty set to `difficulty` (after the validator's scoring changed). */
export function setDifficulty(source, id, difficulty) {
  const start = source.indexOf(`id: '${id}',`);
  if (start < 0) throw new Error(`no level "${id}" in catalog.js`);
  const end = source.indexOf('\n  },', start);
  const block = source.slice(start, end);
  const next = /\n {4}difficulty: \d+,/.test(block)
    ? block.replace(/\n {4}difficulty: \d+,/, `\n    difficulty: ${difficulty},`)
    : block.replace(/(\n {4}designedBy: .*,)/, `$1\n    difficulty: ${difficulty},`);
  return source.slice(0, start) + next + source.slice(end);
}

/** src/levels/missions.js, as source: every room's missions and the model that wrote them. */
export function missionsSource(missions) {
  const sorted = Object.fromEntries(Object.entries(missions).sort(([a], [b]) => a.localeCompare(b)));
  return [
    "// Each room's two missions (see src/core/missions.js for what they can be),",
    '// written by a language model with `node scripts/generate-level.mjs --missions`',
    "// and checked against what the room holds. A room missing here gets",
    '// defaultMissions() in the game. This file is rewritten by the script.',
    '',
    `export const MISSIONS = ${JSON.stringify(sorted, null, 2)};`,
    '',
  ].join('\n');
}

/** catalog.js with an entry added at the end of the generated levels. */
export function addToCatalog(source, entry) {
  const marker = '  // generated levels: end';
  if (!source.includes(marker)) throw new Error('catalog.js has lost its "generated levels: end" marker');
  return source.replace(marker, `${entry}\n${marker}`);
}
