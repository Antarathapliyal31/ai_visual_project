// Level description -> everything the game needs to play it.
//
// A level description lists pieces from the inventory:
//   { item: 'desk', wall: 'north', at: 0.6 }          against a wall, centred at `at` along it
//   { item: 'coffeeTable', x: -1.85, z: 2.0, turn: 1 } free-standing, centre and quarter turns
// plus where the cat starts: { cat: { x, z, heading? } }.
//
// Each piece is its canonical placement (inventory.js) moved and turned: a
// transform T takes a canonical point to the level. compileLevel applies it to
// the piece's boxes, occluders, hiding volumes and (for the bed) the owner's
// home, finds where the owner can walk (a grid of points his footprint fits
// at) and where he looks around when he searches, and keeps T for the look
// and the props, which are built canonically and moved the same way.
//
// compileLevel does not judge the level; validate.js does. It throws only
// when the description cannot be read at all.
//
// No Three.js: runs headless.

import { STATIC_BOXES, ROOM } from '../collision/index.js';
import { createNavigator } from '../ai/navigation.js';
import { tuning as defaultTuning } from '../core/tuning.js';
import { INVENTORY, SHELL_IDS, WALL_FACE, footprint } from './inventory.js';

const COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];
const BACK = { west: { x: -1, z: 0 }, east: { x: 1, z: 0 }, north: { x: 0, z: -1 }, south: { x: 0, z: 1 } };
export const WALLS = Object.keys(BACK);

/**
 * Moving a canonical placement by quarter turns about its origin `from`,
 * then to `to`. Turning follows the room's convention: yaw y takes (x, z) to
 * (x cos y + z sin y, -x sin y + z cos y), as rotY does on a box.
 */
export function makeTransform(from, to, quarterTurns) {
  const k = ((Math.round(quarterTurns) % 4) + 4) % 4;
  const c = COS[k], s = SIN[k];
  return {
    from, to, turns: k, yaw: (k * Math.PI) / 2,
    /** A canonical point [x, y, z] (or {x, z}) in the level. */
    point(p) {
      const arr = Array.isArray(p);
      const x = arr ? p[0] : p.x, z = arr ? p[2] : p.z;
      const dx = x - from.x, dz = z - from.z;
      const nx = to.x + dx * c + dz * s, nz = to.z - dx * s + dz * c;
      return arr ? [nx, p[1], nz] : { ...p, x: nx, z: nz };
    },
  };
}

/** Quarter turns that take the canonical wall's direction to `wall`'s. */
function turnsBetween(fromWall, toWall) {
  const a = BACK[fromWall], b = BACK[toWall];
  for (let k = 0; k < 4; k++) {
    const x = a.x * COS[k] + a.z * SIN[k], z = -a.x * SIN[k] + a.z * COS[k];
    if (Math.abs(x - b.x) < 1e-9 && Math.abs(z - b.z) < 1e-9) return k;
  }
  throw new Error(`cannot turn ${fromWall} to ${toWall}`);
}

/** Where a piece goes: its transform from the canonical placement. */
export function placementTransform(piece) {
  const item = INVENTORY[piece.item];
  if (!item) throw new Error(`unknown item "${piece.item}"`);
  if (item.mount === 'wall') {
    if (!BACK[piece.wall]) throw new Error(`${piece.item}: wall must be one of ${WALLS.join(', ')}`);
    if (!Number.isFinite(piece.at)) throw new Error(`${piece.item}: needs a number "at", its centre along the wall`);
    const turns = turnsBetween(item.wall, piece.wall);
    const inward = { x: -BACK[piece.wall].x, z: -BACK[piece.wall].z };
    const along = piece.wall === 'west' || piece.wall === 'east';
    const face = WALL_FACE[piece.wall];
    const to = along
      ? { x: face + inward.x * item.depth, z: piece.at }
      : { x: piece.at, z: face + inward.z * item.depth };
    return makeTransform(item.origin, to, turns);
  }
  if (!Number.isFinite(piece.x) || !Number.isFinite(piece.z)) throw new Error(`${piece.item}: needs numbers "x" and "z", its centre on the floor`);
  return makeTransform(item.origin, { x: piece.x, z: piece.z }, piece.turn ?? 0);
}

const moveBox = (b, T, id) => ({ ...b, id, center: T.point(b.center), rotY: (b.rotY ?? 0) + T.yaw || undefined });

function moveVolume(v, T, id) {
  const corners = [[v.min[0], v.min[2]], [v.max[0], v.min[2]], [v.max[0], v.max[2]], [v.min[0], v.max[2]]].map(([x, z]) => T.point({ x, z }));
  return {
    id,
    min: [Math.min(...corners.map((c) => c.x)), v.min[1], Math.min(...corners.map((c) => c.z))],
    max: [Math.max(...corners.map((c) => c.x)), v.max[1], Math.max(...corners.map((c) => c.z))],
    checks: v.checks.map((p) => T.point(p)),
  };
}

/**
 * Grid points on open floor the owner's footprint fits at: his waypoints in a
 * level nobody placed them by hand for.
 */
export function floorGrid(nav, { spacing = 0.45, margin = 0.3, room = ROOM, radius = 0.25 } = {}) {
  const points = [];
  for (let x = room.minX + margin; x <= room.maxX - margin + 1e-9; x += spacing) {
    for (let z = room.minZ + margin; z <= room.maxZ - margin + 1e-9; z += spacing) {
      const p = { x: +x.toFixed(3), z: +z.toFixed(3) };
      if (nav.clear(p, p, radius)) points.push(p);
    }
  }
  return points;
}

/** The part of the room a point is in, as Antara's search picks its anchors (owner.js). */
export function roomAreaOf(p) {
  const { x, z } = p;
  if (z < -1.25) return x < -1 ? 'northWest' : 'northEast';
  if (z > 1.25) return x < 0 ? 'southWest' : 'southEast';
  if (x < -1.25) return 'west';
  if (x > 1.25) return 'east';
  return 'center';
}

/** Up to three anchors per area, spread apart (the first is nearest the area's middle). */
function searchAnchorsFrom(points) {
  const byArea = {};
  for (const p of points) (byArea[roomAreaOf(p)] ??= []).push(p);
  const anchors = {};
  for (const [area, pts] of Object.entries(byArea)) {
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
    const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const chosen = [pts.reduce((best, p) => (d(p, mid) < d(best, mid) ? p : best), pts[0])];
    while (chosen.length < 3 && chosen.length < pts.length) {
      chosen.push(pts.reduce((best, p) => (Math.min(...chosen.map((c) => d(c, p))) > Math.min(...chosen.map((c) => d(c, best))) ? p : best), pts[0]));
    }
    anchors[area] = chosen.map(({ x, z }) => ({ x, z }));
  }
  anchors.center ??= Object.values(anchors)[0] ?? [{ x: 0, z: 0 }];
  return anchors;
}

/**
 * @param {object} spec  a level description
 * @param {{tuning?: object}} [opts]
 */
export function compileLevel(spec, opts = {}) {
  const tuning = opts.tuning ?? defaultTuning;
  if (!spec || !Array.isArray(spec.pieces)) throw new Error('a level needs a "pieces" list');
  const shell = STATIC_BOXES.filter((b) => SHELL_IDS.includes(b.id));
  const counts = {};
  const pieces = [];
  const boxes = [...shell], occluders = [], hidingVolumes = [];
  let home = null;

  spec.pieces.forEach((piece, index) => {
    const item = INVENTORY[piece.item];
    if (!item) throw new Error(`unknown item "${piece.item}" (known: ${Object.keys(INVENTORY).join(', ')})`);
    const n = (counts[item.id] = (counts[item.id] ?? 0) + 1);
    const suffix = n === 1 ? '' : `#${n}`;
    const T = placementTransform(piece);
    const own = item.boxes.map((b) => moveBox(b, T, b.id + suffix));
    const occ = item.occluders.map((b) => moveBox(b, T, b.id + suffix));
    const hid = item.hiding.map((v) => moveVolume(v, T, v.id + suffix));
    boxes.push(...own);
    occluders.push(...occ);
    hidingVolumes.push(...hid);
    pieces.push({ index, item, spec: piece, suffix, T, boxes: own, occluders: occ, hiding: hid, footprint: footprint([...own, ...occ]) });
    if (item.home && !home) {
      const h = item.home;
      home = {
        piece: pieces.at(-1),
        bed: { from: T.from, to: T.to, yaw: T.yaw },
        head: { ...T.point(h.head) },
        lie: T.point(h.lie),
        sitEye: T.point(h.sitEye),
        facing: h.facing + T.yaw,
        bedsides: h.bedsides.map((b) => ({ at: T.point(b.at), heading: b.heading + T.yaw, lookAt: T.point(b.lookAt) })),
      };
    }
  });

  // Where the owner can walk, from the solid boxes (props are pushed aside).
  const o = tuning.owner;
  const probe = createNavigator({ radius: o.radius, height: o.height, boxes, waypoints: [] });
  const grid = floorGrid(probe, { radius: o.radius + 0.03 });
  const waypoints = grid.map((p, i) => ({ id: `g${i}`, ...p }));
  const free = (p) => probe.clear(p, p, o.radius + 0.02);

  // Each hiding volume: the first place to crouch that he fits at.
  for (const v of hidingVolumes) {
    const at = v.checks.find((c) => free({ x: c[0], z: c[2] })) ?? v.checks[0];
    v.checkFrom = at;
  }
  // The bed: the first side he can stand at.
  if (home) {
    const side = home.bedsides.find((b) => free(b.at)) ?? home.bedsides[0];
    home.bedside = { x: side.at.x, z: side.at.z };
    home.bedsideHeading = side.heading;
    home.waitLookAt = { x: side.lookAt.x, z: side.lookAt.z };
  }

  const cat = spec.cat ?? { x: 0, z: 0.9 };
  return {
    id: spec.id ?? 'level', name: spec.name ?? spec.id ?? 'Level', blurb: spec.blurb ?? '',
    designedBy: spec.designedBy ?? 'unknown',
    legacy: false,
    room: ROOM,
    spec,
    pieces, boxes, occluders, hidingVolumes, home, waypoints,
    searchAnchors: searchAnchorsFrom(grid),
    cat: { position: [cat.x, tuning.cat.radius + 0.001, cat.z], heading: cat.heading ?? -0.6 },
    decor: spec.decor ?? null,
  };
}
