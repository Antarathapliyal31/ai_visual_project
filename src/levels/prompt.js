// What Claude is told when it designs a level, and the shape it answers in.
//
// The prompt is built from the inventory itself (names, sizes, what each
// piece is for), so a piece added to inventory.js is offered to the model
// without editing this file. The rules are the validator's (validate.js):
// the model is told what will be checked, and when a room fails, the
// validator's own messages go back to it as the next turn.
//
// No Three.js, no SDK: runs headless; scripts/generate-level.mjs sends it.

import { ROOM } from '../collision/index.js';
import { INVENTORY } from './inventory.js';

const WALL_ITEMS = Object.values(INVENTORY).filter((i) => i.mount === 'wall').map((i) => i.id);
const FLOOR_ITEMS = Object.values(INVENTORY).filter((i) => i.mount !== 'wall').map((i) => i.id);
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * The answer's JSON schema, for structured outputs (output_config.format).
 * Plain types, enums and required fields only: numeric ranges are the
 * validator's job, and its messages say what is out of range.
 */
export const LEVEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'blurb', 'pieces', 'cat'],
  properties: {
    id: { type: 'string', description: 'short kebab-case id, e.g. "artist-studio"' },
    name: { type: 'string', description: 'the room\'s name on the menu, two or three words' },
    blurb: { type: 'string', description: 'one sentence for the menu: what is different about this room' },
    pieces: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'wall', 'at'],
            properties: {
              item: { type: 'string', enum: WALL_ITEMS },
              wall: { type: 'string', enum: ['north', 'west', 'east', 'south'] },
              at: { type: 'number', description: 'centre along the wall: x on the north and south walls, z on the west and east walls' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'x', 'z', 'turn'],
            properties: {
              item: { type: 'string', enum: FLOOR_ITEMS },
              x: { type: 'number' },
              z: { type: 'number' },
              turn: { type: 'integer', enum: [0, 1, 2, 3] },
            },
          },
        ],
      },
    },
    cat: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'z'],
      properties: { x: { type: 'number' }, z: { type: 'number' } },
    },
  },
};

/** One line per inventory item: id, how it is placed, its size, how many, what it is for. */
export function inventoryTable() {
  return Object.values(INVENTORY).map((item) => {
    const count = item.maxCount > 1 ? `up to ${item.maxCount}` : 'at most 1';
    const hide = item.hiding.length ? ' Hiding place.' : '';
    let placed;
    if (item.mount === 'wall') {
      const walls = item.tall || item.visibleWall ? 'north or west wall only' : 'any wall';
      placed = `wall piece (${walls}); ${r2(item.length)} m along the wall, ${r2(item.depth * 2)} m into the room`;
    } else {
      placed = `floor piece; ${r2(item.size.w)} m (x) by ${r2(item.size.d)} m (z) at turn 0`;
    }
    return `- ${item.id} (${item.name}): ${placed}; ${count}.${hide} ${item.about}`;
  }).join('\n');
}

/** The standing instructions: the game, the room, the pieces and the rules. */
export function systemPrompt() {
  return `You design rooms for Last One Awake, a small stealth game. The player is a cat loose in a studio flat at 3 a.m. It knocks things over and breaks plates and mugs before dawn. Every crash makes noise, and noise wakes its owner: he stirs, sits up in bed, then gets up, walks to where he heard it, looks around, and crouches to check hiding places near it. If he sees the cat for long, it is caught.

A good room gives the cat a few places to hide, breakable things on surfaces it can jump to, and open floor the owner has to walk across to reach them. Rooms should play differently from each other: where the bed is decides where he starts and what he sees from it; where the hiding places are decides how far the cat must run.

You place furniture from a fixed inventory. A validator then builds the room and checks it; if it finds problems you get its messages back and fix them.

## The room

The floor runs from x = ${ROOM.minX} (the west wall) to x = ${ROOM.maxX} (the east wall), and from z = ${ROOM.minZ} (the north wall) to z = ${ROOM.maxZ} (the south wall). Metres. North is -z, east is +x.

The camera looks in from the south-east, so the east and south walls are cut away. Tall pieces and pieces you see on the wall must stand on the north or west wall, or they would block the view.

## Placing pieces

- Wall pieces: {"item", "wall", "at"}. The piece stands with its back to that wall. "at" is its centre along the wall: the x coordinate on the north and south walls, the z coordinate on the west and east walls. It covers at - length/2 to at + length/2 along the wall.
- Floor pieces: {"item", "x", "z", "turn"}. (x, z) is the centre of its footprint. "turn" is quarter turns: 1 turns what faced east (+x) to face north (-z), 2 faces it west, 3 south. Turns 1 and 3 swap its x and z sizes.
- Pieces must not overlap each other or stick out of the room. Leave walking room: the owner is about 0.5 m wide.
- "cat" is where the cat starts, on open floor, not inside or under furniture.

## The inventory

${inventoryTable()}

## What the validator checks

1. Exactly one bed. No more of any piece than the inventory allows.
2. Tall and on-the-wall pieces on the north or west wall only.
3. Everything inside the room; no two pieces overlapping.
4. About 0.6 m of open floor beside a long side of the bed, so the owner can get up.
5. Each hiding place has a spot where the owner crouches to look in (in front of the opening, about 1 m out). He must be able to walk there from the bed: keep about 1 m of open floor in front of each hiding place, and a way to it.
6. At least 12 m² of the 42 m² floor open for the owner to stand on.
7. The cat can walk from its start into every hiding place.
8. At least two hiding places.
9. Hiding places are not in plain view: from no more than 35% of the open floor may a standing owner see into one. Face an open side (the cardboard box's opening, for example) towards a wall or other furniture about 1.2 to 1.5 m away, not towards the open room.
10. The props (books, plates, mugs, lamps) settle where each piece puts them; nothing may stand on top of another piece.
11. At least four plates and mugs to break: include the desk or the dining table.

## How hard a room plays

The validator also rates every room from 1 (easy) to 5 (hard). A room is harder when:
- the owner sees much of the floor when he sits up in bed;
- few hiding places stay hidden when he crouches to look (under the bed, a skirted armchair and an open box facing a wall stay hidden; under the desk and under the dining table do not);
- there are few hiding places at all;
- the cat has a long run from the plates and mugs (on the desk and the dining table) to a hiding place he cannot find;
- his walks from the bed to the hiding places are short.

## Your answer

Answer with the room as JSON in the given schema, and nothing else. Give it a short name of two or three words for the menu (not the theme repeated), and a one-sentence blurb that says what is different about it.`;
}

/** A level description as the model sees it in examples: the fields of the schema. */
export function asExample(spec) {
  return {
    id: spec.id, name: spec.name, blurb: spec.blurb,
    pieces: spec.pieces.map((p) => (INVENTORY[p.item].mount === 'wall'
      ? { item: p.item, wall: p.wall, at: r2(p.at) }
      : { item: p.item, x: r2(p.x), z: r2(p.z), turn: p.turn ?? 0 })),
    cat: { x: r2(spec.cat.x), z: r2(spec.cat.z) },
  };
}

// What to aim for, by difficulty.
export const TARGETS = {
  easy: 'Make it EASY (difficulty 1 or 2): put two or three hiding places he cannot find even when he crouches (skirted armchairs, open boxes facing a wall) right next to the desk or the dining table, keep the hiding places well away from his bed, and let furniture stand between the bed and the open room.',
  medium: 'Make it MEDIUM (difficulty 3): a fair mix, with three to five hiding places, one or two of them safe even when he crouches, a few metres from the plates.',
  hard: 'Make it HARD (difficulty 4 or 5): only two or three hiding places, mostly ones he finds when he crouches (under the desk, under the dining table); put the desk and the dining table far from the bed and from any other safe hiding place, and leave the middle of the room open so he sees it from bed.',
};

/**
 * The first turn: what to design, example rooms that pass the validator (in
 * full, with how hard they rated), and the rooms already made (by name, so
 * the new one differs from them).
 * @param {{theme?: string, target?: 'easy'|'medium'|'hard', examples: object[], others?: object[]}} opts
 */
export function designPrompt({ theme, target, examples, others = [] }) {
  const rated = (spec) => (spec.difficulty ? ` (difficulty ${spec.difficulty})` : '');
  const full = examples.map((spec) => `${spec.name}${rated(spec)}: ${spec.blurb}\n${JSON.stringify(asExample(spec))}`).join('\n\n');
  const lines = [`These rooms pass the validator.`, '', full];
  if (others.length) {
    lines.push('', 'These rooms are in the game already; make yours different from them, with a name of its own:');
    for (const spec of others) lines.push(`- ${spec.name}${rated(spec)}: ${spec.blurb}`);
  }
  lines.push('', `Design a new room${theme ? `: ${theme}` : ''}. Move the bed, the hiding places and the open floor, not just the decoration.`);
  if (target) lines.push(TARGETS[target]);
  return lines.join('\n');
}

const f2 = (v) => v.toFixed(2);

/** Where each piece of a compiled room stands, as floor extents. */
export function floorPlan(level) {
  return level.pieces.map((p) => {
    const s = p.spec, fp = p.footprint;
    const where = s.wall ? `${s.wall} wall, at ${s.at}` : `x ${s.x}, z ${s.z}, turn ${s.turn ?? 0}`;
    return `- ${s.item} (${where}): x ${f2(fp.minX)}..${f2(fp.maxX)}, z ${f2(fp.minZ)}..${f2(fp.maxZ)}`;
  });
}

/**
 * The stretches of each wall nothing stands against (within `depth` of it):
 * where a wall piece still fits.
 */
export function freeWall(level, depth = 0.5) {
  const out = [];
  for (const wall of ['north', 'west', 'east', 'south']) {
    const alongX = wall === 'north' || wall === 'south';
    const [lo, hi] = alongX ? [ROOM.minX, ROOM.maxX] : [ROOM.minZ, ROOM.maxZ];
    const near = (fp) => ({ north: fp.minZ < ROOM.minZ + depth, south: fp.maxZ > ROOM.maxZ - depth, west: fp.minX < ROOM.minX + depth, east: fp.maxX > ROOM.maxX - depth })[wall];
    const taken = level.pieces.map((p) => p.footprint).filter(near)
      .map((fp) => (alongX ? [fp.minX, fp.maxX] : [fp.minZ, fp.maxZ])).sort((a, b) => a[0] - b[0]);
    const free = [];
    let at = lo;
    for (const [a, b] of taken) {
      if (a - at >= 0.3) free.push([at, a]);
      at = Math.max(at, b);
    }
    if (hi - at >= 0.3) free.push([at, hi]);
    const axis = alongX ? 'x' : 'z';
    out.push(`- ${wall} wall: ${free.length ? free.map(([a, b]) => `${axis} ${f2(a)}..${f2(b)}`).join(', ') : 'none'}`);
  }
  return out;
}

/**
 * The biggest open rectangles of floor (nothing stands there): where a
 * free-standing piece can go. Found on a 25 cm grid, largest first, each
 * one taken out before the next is looked for.
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}[]}
 */
export function openFloor(level, { cell = 0.25, count = 4, min = 0.75 } = {}) {
  const nx = Math.round((ROOM.maxX - ROOM.minX) / cell), nz = Math.round((ROOM.maxZ - ROOM.minZ) / cell);
  const used = Array.from({ length: nz }, (_, j) => Array.from({ length: nx }, (_, i) => {
    const x0 = ROOM.minX + i * cell, z0 = ROOM.minZ + j * cell;
    return level.pieces.some(({ footprint: fp }) => x0 < fp.maxX && x0 + cell > fp.minX && z0 < fp.maxZ && z0 + cell > fp.minZ);
  }));
  const out = [];
  for (let k = 0; k < count; k++) {
    // Largest empty rectangle: for each row, the histogram of open cells above it.
    const height = new Array(nx).fill(0);
    let best = null;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) height[i] = used[j][i] ? 0 : height[i] + 1;
      for (let i = 0; i < nx; i++) {
        let h = height[i];
        for (let e = i; e < nx && height[e] > 0; e++) {
          h = Math.min(h, height[e]);
          const area = h * (e - i + 1);
          if (!best || area > best.area) best = { area, i0: i, i1: e, j0: j - h + 1, j1: j };
        }
      }
    }
    if (!best) break;
    const r = { minX: ROOM.minX + best.i0 * cell, maxX: ROOM.minX + (best.i1 + 1) * cell, minZ: ROOM.minZ + best.j0 * cell, maxZ: ROOM.minZ + (best.j1 + 1) * cell };
    if (r.maxX - r.minX < min || r.maxZ - r.minZ < min) break;
    out.push(r);
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) used[j][i] = true;
  }
  return out;
}

/** The turn after a rejected room: the validator's messages, word for word, and where everything is. */
export function feedbackPrompt(result) {
  const lines = ['The validator rejected this room.', '', 'Errors (each must be fixed):'];
  for (const e of result.errors) lines.push(`- ${e.code}: ${e.message}`);
  if (result.warnings.length) {
    lines.push('', 'Warnings (fix them if you can):');
    for (const w of result.warnings) lines.push(`- ${w.code}: ${w.message}`);
  }
  if (result.level?.pieces?.length) {
    lines.push('', 'Where each piece is now (the floor it covers):', ...floorPlan(result.level));
    lines.push('', 'Stretches of wall with nothing against them (where a wall piece still fits, if it is short enough):', ...freeWall(result.level));
    const open = openFloor(result.level);
    if (open.length) {
      lines.push('', 'The biggest open areas of floor (where a free-standing piece fits, away from the walls\' pieces):');
      for (const r of open) lines.push(`- x ${f2(r.minX)}..${f2(r.maxX)}, z ${f2(r.minZ)}..${f2(r.maxZ)} (centre x ${f2((r.minX + r.maxX) / 2)}, z ${f2((r.minZ + r.maxZ) / 2)})`);
    }
  }
  lines.push('', 'Fix these by moving, turning or swapping only the pieces they name; keep everything else where it is. Return the whole corrected room as JSON.');
  return lines.join('\n');
}

/**
 * Read the model's answer into a level description. Coordinates are rounded
 * to centimetres; nothing is judged here (validate.js does that).
 * @param {string} text
 */
export function parseLevel(text) {
  const raw = JSON.parse(text);
  const id = String(raw.id ?? 'generated').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'generated';
  return {
    id,
    name: String(raw.name ?? id),
    blurb: String(raw.blurb ?? ''),
    pieces: (raw.pieces ?? []).map((p) => ('wall' in p
      ? { item: p.item, wall: p.wall, at: r2(p.at) }
      : { item: p.item, x: r2(p.x), z: r2(p.z), turn: p.turn ?? 0 })),
    cat: { x: r2(raw.cat?.x ?? 0), z: r2(raw.cat?.z ?? 0) },
  };
}
