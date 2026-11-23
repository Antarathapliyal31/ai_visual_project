// What a model is told when it writes a room's two missions, and the shape
// it answers in. The missions it may write are the kinds src/core/missions.js
// can check; the room's real contents go in the prompt, and if a mission
// can't be done there, validateMissions' words go back to it.
//
// No Three.js, no SDK: runs headless.

import { KIND_NAMES, SPOTS, MAX_CLEAR, pieceName } from '../core/missions.js';

/** Pieces that carry props, for a mission's `piece`. */
export const MISSION_PIECES = ['desk', 'diningTable', 'coffeeTable', 'nightstand', 'bookshelf', 'wallShelf', 'windowSill', 'catTree', 'couch', 'armchair', 'bed'];

const text = { type: 'string' };
const shape = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const one = (value) => ({ type: 'string', enum: [value] });

/** Two missions, each one of the five kinds. `piece: 'anywhere'` means no particular piece. */
export const MISSIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['missions'],
  properties: {
    missions: {
      type: 'array',
      items: {
        anyOf: [
          shape({ type: one('break'), title: text, kind: { type: 'string', enum: ['plate', 'mug', 'any'] }, count: { type: 'integer' }, piece: { type: 'string', enum: [...MISSION_PIECES, 'anywhere'] } }),
          shape({ type: one('knock'), title: text, kind: { type: 'string', enum: Object.keys(KIND_NAMES) }, count: { type: 'integer' }, piece: { type: 'string', enum: [...MISSION_PIECES, 'anywhere'] } }),
          shape({ type: one('clear'), title: text, piece: { type: 'string', enum: MISSION_PIECES } }),
          shape({ type: one('hide'), title: text, spot: { type: 'string', enum: Object.keys(SPOTS) } }),
          shape({ type: one('sneak'), title: text }),
        ],
      },
    },
  },
};

/** The standing instructions: the game, the mission kinds, what makes a good one. */
export function missionsSystemPrompt() {
  return `You write missions for rooms in Last One Awake, a small stealth game. The player is a cat loose in a flat at 3 a.m. It knocks things over and breaks plates and mugs before dawn, while the noise wakes its owner: he sits up, gets up, walks over to look, and crouches to look into hiding places. To win a night the cat must make enough chaos (the room's goal) and not be caught before dawn. Each room also has two missions: jobs that earn a star each on a night the cat wins.

## The kinds of mission

- break: break "count" plates or mugs ("kind": plate, mug, or any for either), from one "piece" or "anywhere".
- knock: knock "count" props of one "kind" over, off one "piece" or "anywhere". Kinds: ${Object.entries(KIND_NAMES).map(([k, [name]]) => `${k} (${name})`).join(', ')}.
- clear: knock everything off one "piece" (only a piece with ${MAX_CLEAR} things or fewer on it).
- hide: stay in a hiding place ("spot") while he crouches and looks into it, without him seeing the cat. Only the hiding places he can't see into count; each room lists its own.
- sneak: get within a metre of him while he is up, without being seen.

## Good missions

- fit the room: its theme, its furniture, the things on it;
- send the cat to different parts of the room;
- one is quick, the other takes nerve (a hide or a sneak, or a job right next to his bed);
- ask only for what the room holds, at most about two thirds of what is there;
- each has a playful title of two to four words.

Answer with JSON in the given schema, and nothing else.`;
}

/**
 * The room the missions are for.
 * @param {{spec: object, contents: object, safeSpots: string[], goal: number}} opts
 */
export function missionsPrompt({ spec, contents, safeSpots, goal }) {
  const lines = [`Room: ${spec.name}. ${spec.blurb ?? ''}`.trim(), `Its chaos goal is ${goal}.`, '', 'What it holds:'];
  const groups = new Map();
  for (const p of contents.props) {
    const key = p.piece ?? 'floor';
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[p.kind] = (groups.get(key)[p.kind] ?? 0) + 1;
  }
  for (const [piece, kinds] of groups) {
    const what = Object.entries(kinds).map(([k, n]) => `${n} ${KIND_NAMES[k][n === 1 ? 0 : 1]} (${k})`).join(', ');
    lines.push(piece === 'floor' ? `- on the floor (not on any piece): ${what}` : `- on the ${pieceName(piece)} (${piece}): ${what}`);
  }
  const spots = [...new Set(safeSpots.map((s) => s.split('#')[0]))].filter((s) => SPOTS[s]);
  lines.push('', spots.length
    ? `Hiding places he can't see into, even crouching: ${spots.map((s) => `${SPOTS[s]} (${s})`).join(', ')}.`
    : 'There is no hiding place here he can\'t see into when he crouches, so no "hide" mission.');
  lines.push('', 'Write its two missions.');
  return lines.join('\n');
}

/** The turn after missions that can't be done: what is wrong with them. */
export function missionsFeedback(errors) {
  return ['These missions can\'t be done in this room:', ...errors.map((e) => `- ${e}`), '', 'Fix them, and give both missions again as JSON.'].join('\n');
}

/** Read the model's answer into missions (no piece for "anywhere"). */
export function parseMissions(textAnswer) {
  const raw = JSON.parse(textAnswer);
  return (raw.missions ?? []).map((m) => {
    const out = { ...m };
    if (out.piece === 'anywhere') delete out.piece;
    if ('count' in out) out.count = Math.round(Number(out.count));
    if (typeof out.title === 'string') out.title = out.title.trim();
    return out;
  });
}
