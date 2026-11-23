// A night's goal and its missions.
//
// To win a night the cat must make enough chaos (the goal) and not be caught
// before dawn (round.js). Each room also has two missions, jobs worth a star
// each on a night the cat wins:
//
//   break   break N plates or mugs (from one piece, or anywhere)
//   knock   knock N props of a kind over (off one piece, or anywhere)
//   clear   knock everything off one piece
//   hide    stay in a hiding place while he is right next to it
//   sneak   get within a metre of him while he is up, without being seen
//
// A mission is data; its text comes from the data (describe), so what the
// player reads is what is checked. The missions of each room are written by
// a language model (src/levels/missions.js) and checked here against what
// the room really holds (validateMissions); defaultMissions() stands in for
// a room without any.
//
// No Three.js: runs headless.

import { INVENTORY } from '../levels/inventory.js';
import { hidingSpotAt } from '../collision/index.js';

export const MISSION_TYPES = ['break', 'knock', 'clear', 'hide', 'sneak'];
export const BREAKABLE = ['plate', 'mug'];
export const SNEAK_DISTANCE = 1.0; // m
export const BESIDE_DISTANCE = 1.0; // m from a hiding place's edge: he is right next to it
export const MAX_CLEAR = 8;        // most props on a piece a 'clear' mission may ask for

/** What the player calls each kind of prop: one, many. */
export const KIND_NAMES = {
  plate: ['plate', 'plates'], mug: ['mug', 'mugs'], book: ['book', 'books'], lamp: ['lamp', 'lamps'],
  pot: ['plant', 'plants'], clock: ['alarm clock', 'alarm clocks'], monitor: ['monitor', 'monitors'],
  keyboard: ['keyboard', 'keyboards'], pillow: ['cushion', 'cushions'], ball: ['ball of yarn', 'balls of yarn'],
};
/**
 * Where a 'hide' mission can be done: the hiding places he couldn't see into
 * even if he crouched to look (validate.js safeSpotIds), so the cat is safe
 * there however close he comes.
 */
export const SPOTS = { underBed: 'under the bed', underTable: 'under the dining table', underArmchair: 'under an armchair', any: 'in a hiding place' };

const PIECE_NAMES = { windowSill: 'window sill' };
export const pieceName = (id) => PIECE_NAMES[id] ?? INVENTORY[id]?.name.toLowerCase() ?? id;
const base = (id) => String(id).split('#')[0];
const article = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');

/** A box's footprint, turned with it. */
function footprintOf(b) {
  const c = Math.cos(b.rotY ?? 0), s = Math.sin(b.rotY ?? 0);
  const ex = Math.abs(b.half[0] * c) + Math.abs(b.half[2] * s), ez = Math.abs(b.half[0] * s) + Math.abs(b.half[2] * c);
  return { minX: b.center[0] - ex, maxX: b.center[0] + ex, minZ: b.center[2] - ez, maxZ: b.center[2] + ez };
}

/**
 * What a room holds: every prop with its kind and the piece it starts on (the
 * piece whose highest surface under it carries it; none for the floor).
 * Call it right after the props are spawned, while they are still at home.
 * @param {{pieces: object[]}} level  a loadLevel() result
 * @param {{body: object, kind: string, tag?: string}[]} props  physics.props
 */
export function contentsOf(level, props) {
  const list = props.map((p) => {
    const at = p.body.position;
    const home = { x: at.x, y: at.y, z: at.z };
    let piece = null, support = -Infinity;
    for (const candidate of level.pieces) {
      for (const b of candidate.boxes) {
        const f = footprintOf(b);
        if (home.x < f.minX - 0.05 || home.x > f.maxX + 0.05 || home.z < f.minZ - 0.05 || home.z > f.maxZ + 0.05) continue;
        const top = b.center[1] + b.half[1];
        if (top <= home.y + 0.02 && top > support) { support = top; piece = candidate.item.id; }
      }
    }
    return { body: p.body, kind: p.kind, tag: p.tag ?? null, piece, home };
  });
  /** How many props of a kind ('breakable' for plates and mugs, null for any), on a piece if given. */
  const count = (kind, piece) => list.filter((p) =>
    (kind == null || (kind === 'breakable' ? BREAKABLE.includes(p.kind) : p.kind === kind)) && (!piece || p.piece === piece)).length;
  const onPieces = new Set(list.map((p) => p.piece).filter(Boolean));
  return { props: list, count, onPieces, spots: level.hidingVolumes ?? [] };
}

/** Is someone at (x, z) within BESIDE_DISTANCE of the edge of hiding place v? */
function besideSpot(at, v) {
  const dx = Math.max(v.min[0] - at.x, 0, at.x - v.max[0]);
  const dz = Math.max(v.min[2] - at.z, 0, at.z - v.max[2]);
  return Math.hypot(dx, dz) <= BESIDE_DISTANCE;
}

/** The chaos it takes to win a night in this room: a share of all it could make. */
export function goalFor(contents, tuning) {
  const g = tuning.game;
  const most = contents.props.length * g.points.knocked + contents.count('breakable') * g.points.broken;
  return Math.max(50, Math.round((g.goalShare * most) / 10) * 10);
}

/** Stars for a night: one for winning it, one more for each mission done (only on a won night). */
export function starsFor({ won, done }) {
  return won ? 1 + done : 0;
}

/** A mission in words, from its data. */
export function describe(m) {
  const piece = m.piece ? pieceName(m.piece) : null;
  switch (m.type) {
    case 'break': {
      const what = m.kind === 'any' ? (m.count === 1 ? 'plate or mug' : 'plates or mugs') : KIND_NAMES[m.kind][m.count === 1 ? 0 : 1];
      return `Break ${m.count === 1 ? article(what) : m.count} ${what}${piece ? ` from the ${piece}` : ''}`;
    }
    case 'knock': {
      const [one, many] = KIND_NAMES[m.kind];
      if (m.count === 1) return piece ? `Knock the ${one} off the ${piece}` : `Knock over ${article(one)} ${one}`;
      return `Knock ${m.count} ${many} ${piece ? `off the ${piece}` : 'over'}`;
    }
    case 'clear': return `Clear everything off the ${piece}`;
    case 'hide': return m.spot === 'any' ? "Stay hidden while he's right next to your hiding place" : `Stay ${SPOTS[m.spot]} while he's right next to it`;
    case 'sneak': return 'Get within a metre of him while he is up, without being seen';
    default: return 'Unknown mission';
  }
}

/**
 * Can these missions be done in this room? Each problem in words a person or
 * a model can act on; none means they are fine.
 * @param {object[]} missions
 * @param {ReturnType<typeof contentsOf>} contents
 * @param {string[]} safeSpots  ids of the hiding places he can't see into crouching (validate.js metrics.safeSpotIds)
 */
export function validateMissions(missions, contents, safeSpots = []) {
  const errors = [];
  if (!Array.isArray(missions) || missions.length !== 2) return ['Give exactly two missions.'];
  const safe = new Set(safeSpots.map(base));
  const pieces = [...contents.onPieces].map(pieceName).join(', ');
  const seen = new Set();
  missions.forEach((m, i) => {
    const at = `Mission ${i + 1} (${m?.type ?? 'no type'})`;
    if (!MISSION_TYPES.includes(m?.type)) { errors.push(`${at}: the type must be one of ${MISSION_TYPES.join(', ')}.`); return; }
    if (typeof m.title !== 'string' || !m.title.trim() || m.title.length > 40) errors.push(`${at}: give it a short title of two to four words.`);
    const key = JSON.stringify([m.type, m.kind ?? null, m.piece ?? null, m.spot ?? null]);
    if (seen.has(key)) errors.push(`${at}: the two missions must be different jobs.`);
    seen.add(key);
    if (m.piece && !contents.onPieces.has(m.piece)) {
      errors.push(`${at}: this room has no ${pieceName(m.piece)} with things on it. Pieces with things on them here: ${pieces}.`);
      return;
    }
    if (m.type === 'break' || m.type === 'knock') {
      const kinds = m.type === 'break' ? ['plate', 'mug', 'any'] : Object.keys(KIND_NAMES);
      if (!kinds.includes(m.kind)) { errors.push(`${at}: the kind must be one of ${kinds.join(', ')}.`); return; }
      const have = contents.count(m.kind === 'any' ? 'breakable' : m.kind, m.piece);
      const most = Math.max(1, Math.floor(have * 0.7));
      const what = m.kind === 'any' ? 'plates or mugs' : KIND_NAMES[m.kind][1];
      const where = m.piece ? `on the ${pieceName(m.piece)}` : 'in this room';
      if (!Number.isInteger(m.count) || m.count < 1) errors.push(`${at}: the count must be a whole number, 1 or more.`);
      else if (have === 0) errors.push(`${at}: there are no ${what} ${where}.`);
      else if (m.count > most) errors.push(`${at}: there ${have === 1 ? 'is' : 'are'} only ${have} ${have === 1 ? KIND_NAMES[m.kind === 'any' ? 'plate' : m.kind][0] : what} ${where}; ask for at most ${most}.`);
    }
    if (m.type === 'clear') {
      const have = contents.count(null, m.piece);
      if (!m.piece || have === 0) errors.push(`${at}: name a piece with things on it: ${pieces}.`);
      else if (have > MAX_CLEAR) errors.push(`${at}: the ${pieceName(m.piece)} holds ${have} things, too many to clear in one night; pick a piece with ${MAX_CLEAR} or fewer.`);
    }
    if (m.type === 'hide') {
      const spots = [...safe].filter((s) => SPOTS[s]).map((s) => `${s} (${SPOTS[s]})`).join(', ') || 'none';
      if (!SPOTS[m.spot]) errors.push(`${at}: the spot must be one of ${Object.keys(SPOTS).join(', ')}.`);
      else if (m.spot === 'any' ? !safe.size : !safe.has(m.spot)) errors.push(`${at}: ${SPOTS[m.spot]} is not a hiding place he can't see into in this room. Safe ones here: ${spots}.`);
    }
  });
  return errors;
}

/** Two missions any room can have, from what it holds: for rooms the model has not written missions for. */
export function defaultMissions(contents, safeSpots = ['underBed']) {
  const out = [];
  const plates = [...contents.onPieces].map((piece) => [piece, contents.count('plate', piece)]).sort((a, b) => b[1] - a[1])[0];
  if (plates && plates[1] >= 1) {
    out.push({ type: 'break', kind: 'plate', count: Math.max(1, Math.min(3, Math.floor(plates[1] * 0.7))), piece: plates[0], title: 'Plate smash' });
  } else {
    out.push({ type: 'break', kind: 'any', count: Math.max(1, Math.min(2, Math.floor(contents.count('breakable') * 0.7))), title: 'Something breakable' });
  }
  if (contents.count('monitor', 'desk')) out.push({ type: 'knock', kind: 'monitor', count: 1, piece: 'desk', title: 'Screen time' });
  else if (safeSpots.some((s) => base(s) === 'underBed')) out.push({ type: 'hide', spot: 'underBed', title: 'Under his nose' });
  else out.push({ type: 'sneak', title: 'Close call' });
  return out;
}

/**
 * Follows a night's missions.
 * @param {object[]} missions
 * @param {ReturnType<typeof contentsOf>} contents
 */
export function createMissionTracker(missions, contents) {
  const byBody = new Map(contents.props.map((p) => [p.body, p]));
  const broken = [];
  const state = missions.map((m) => ({ m, progress: 0, done: false, pending: false }));
  const need = (m) => (m.type === 'clear' ? contents.count(null, m.piece) : m.type === 'break' || m.type === 'knock' ? m.count : 1);
  const matches = (p, m) => (m.kind === 'any' ? BREAKABLE.includes(p.kind) : p.kind === m.kind) && (!m.piece || p.piece === m.piece);

  /** A prop broke (physics onBroken's `info.parent`). */
  function onBroken(body) {
    const p = byBody.get(body);
    if (p) broken.push(p);
  }

  /**
   * After each step: `knocked` is every prop body knocked over or smashed so
   * far; `catAt` the cat's position; `owner` the owner (src/ai/owner.js).
   * @returns {object[]} the missions done this time
   */
  function frame({ knocked, catAt, owner }) {
    const now = [];
    for (const s of state) {
      if (s.done) continue;
      const m = s.m;
      if (m.type === 'break') s.progress = broken.filter((p) => matches(p, m)).length;
      else if (m.type === 'knock') s.progress = contents.props.filter((p) => matches(p, m) && knocked.has(p.body)).length;
      else if (m.type === 'clear') s.progress = contents.props.filter((p) => p.piece === m.piece && knocked.has(p.body)).length;
      else if (m.type === 'hide') {
        // Done once he has been right next to the spot, up and about, with the cat in it unseen,
        // and has moved off again without catching it. (The cat must still be in it as he goes.)
        const st = owner?.state;
        const beside = owner?.isUp && st ? contents.spots.filter((v) => (m.spot === 'any' || base(v.id) === m.spot) && besideSpot(st, v)) : [];
        if (beside.length) {
          s.pending = Boolean(catAt && hidingSpotAt(catAt, beside) && !st.seesCat);
        } else if (s.pending) {
          if (!st?.caught) s.progress = 1;
          s.pending = false;
        }
      } else if (m.type === 'sneak') {
        const st = owner?.state;
        if (owner?.isUp && catAt && Math.hypot(st.x - catAt.x, st.z - catAt.z) < SNEAK_DISTANCE && !st.seesCat) s.progress = 1;
      }
      if (s.progress >= need(m)) {
        s.progress = need(m);
        s.done = true;
        now.push(m);
      }
    }
    return now;
  }

  return {
    onBroken,
    frame,
    /** Every mission: its title, its text, how far along it is. */
    list: () => state.map((s) => ({ title: s.m.title, text: describe(s.m), progress: s.progress, need: need(s.m), done: s.done })),
    get done() { return state.filter((s) => s.done).length; },
  };
}
