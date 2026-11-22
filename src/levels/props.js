// The props of a compiled level: each piece brings its own, laid out as in
// the original room (physics/roomScene.js) and moved with the piece, plus a
// little clutter on open floor. The original level keeps spawnRoomScene
// itself, so its props stay exactly as tested.
//
// No Three.js: runs headless.

import { SURFACES, STATIC_BOXES } from '../collision/index.js';
import { spawnSliceScene } from '../physics/sliceScene.js';
import { stackHeights } from '../physics/props.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...String(s)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 549);

/** Extents of one of the original room's boxes (canonical placement). */
function extents(id) {
  const b = STATIC_BOXES.find((s) => s.id === id);
  const [cx, cy, cz] = b.center, [hx, hy, hz] = b.half;
  return { cx, cy, cz, minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, top: cy + hy };
}

/** A physics facade whose spawn() takes canonical positions and places them with T. */
function placed(physics, T) {
  return {
    ...physics,
    spawn(kind, o = {}) {
      return physics.spawn(kind, {
        ...o,
        ...(o.base && { base: T.point(o.base) }),
        ...(o.position && { position: T.point(o.position) }),
        rotY: (o.rotY ?? 0) + T.yaw,
      });
    },
  };
}

const SHELF_FILL = [0.92, 0.7, 0.82, 0.45];

/** What each piece carries, in its canonical placement. */
const PROPS = {
  desk(p) {
    const slice = spawnSliceScene(p);
    const desk = extents('deskTop');
    const screenX = desk.cx + 0.12;
    return [
      ...slice.all,
      p.spawn('lamp', { base: [desk.maxX - 0.2, SURFACES.deskTop, desk.minZ + 0.2] }),
      p.spawn('monitor', { base: [screenX, SURFACES.deskTop, desk.minZ + 0.19] }),
      p.spawn('keyboard', { base: [screenX, SURFACES.deskTop, desk.minZ + 0.4] }),
    ];
  },
  bookshelf(p, { rand, book }) {
    const left = extents('bookshelfSideL'), right = extents('bookshelfSideR'), panel = extents('bookshelfPanel0');
    const x0 = left.maxX + 0.015, x1 = right.minX - 0.015, z = panel.cz - 0.01;
    const between = (lo, hi) => lo + (hi - lo) * rand();
    const out = [];
    SURFACES.bookshelfShelves.forEach((y, i) => {
      const end = x0 + (x1 - x0) * SHELF_FILL[i];
      for (let x = x0; ;) {
        const thick = between(0.035, 0.06);
        if (x + thick > end) break;
        out.push(book([x + thick / 2, y, z], [thick / 2, between(0.10, 0.145), between(0.07, 0.085)]));
        x += thick + 0.004;
      }
    });
    out.push(p.spawn('pot', { base: [right.minX - 0.15, SURFACES.bookshelfTop, z] }));
    return out;
  },
  wallShelf(p, { rand, book }) {
    const shelf = extents('wallShelf');
    const out = [];
    let z = shelf.minZ + 0.08;
    for (let i = 0; i < 3; i++) {
      const thick = 0.035 + 0.02 * rand();
      out.push(book([shelf.cx, SURFACES.wallShelfTop, z + thick / 2], [0.075, 0.10 + 0.03 * rand(), thick / 2]));
      z += thick + 0.004;
    }
    out.push(p.spawn('pot', { base: [shelf.cx, SURFACES.wallShelfTop, shelf.maxZ - 0.2] }));
    return out;
  },
  nightstand(p) {
    const ns = extents('nightstand');
    return [
      p.spawn('lamp', { base: [ns.cx - 0.05, SURFACES.nightstandTop, ns.cz - 0.08] }),
      p.spawn('clock', { base: [ns.cx + 0.05, SURFACES.nightstandTop, ns.maxZ - 0.08] }),
    ];
  },
  bed(p) {
    const m = extents('bedMattress');
    return [p.spawn('pillow', { base: [m.minX + 0.3, SURFACES.bedTop, m.cz] })];
  },
  windowSill(p) {
    const sill = extents('windowSill');
    return [p.spawn('pot', { base: [sill.cx, SURFACES.windowSillTop, sill.cz] })];
  },
  couch(p) {
    const seat = extents('couchSeat');
    return [p.spawn('pillow', { base: [seat.cx - 0.05, SURFACES.couchSeatTop, seat.minZ + 0.3], rotY: 0.25, tag: 'cushion', dims: { half: [0.18, 0.07, 0.2] } })];
  },
  coffeeTable(p, { std }) {
    const table = extents('coffeeTableTop');
    return [
      p.spawn('mug', { base: [table.cx + 0.05, SURFACES.coffeeTableTop, table.cz - 0.25] }),
      p.spawn('book', { base: [table.cx - 0.02, SURFACES.coffeeTableTop, table.cz + 0.22], rotY: 1.2 }),
      ...stackHeights(SURFACES.coffeeTableShelfTop, std.half[1], 2).map((py, i) =>
        p.spawn('book', { position: [table.cx, py, table.cz + 0.1], rotY: 1.57 + i * 0.25 })),
    ];
  },
  catTree(p) {
    const perch = extents('catTreePerch');
    return [p.spawn('ball', { base: [perch.cx + 0.05, SURFACES.catTreePerchTop, perch.cz + 0.05], tag: 'yarn' })];
  },
  diningTable(p) {
    const top = 0.76;
    const plateHalf = p.tuning.props.plate.height / 2;
    return [
      ...stackHeights(top, plateHalf, 3).map((py) => p.spawn('plate', { position: [-0.22, py, -0.12] })),
      p.spawn('mug', { base: [0.22, top, 0.16] }),
      p.spawn('mug', { base: [0.34, top, -0.2] }),
      p.spawn('book', { base: [0.05, top, -0.26], rotY: 0.4 }),
    ];
  },
  armchair(p) {
    return [p.spawn('pillow', { base: [0.02, 0.46, 0], rotY: 0.2, tag: 'cushion', dims: { half: [0.17, 0.07, 0.18] } })];
  },
};

/**
 * Spawn a compiled level's props.
 * @param {ReturnType<import('../physics/world.js').createPhysicsWorld>} physics
 * @param {ReturnType<import('./compile.js').compileLevel>} level
 * @returns {{all: object[], byPiece: object[][], clutter: object[]}}
 */
export function spawnLevelProps(physics, level) {
  const rand = mulberry32(hash(level.id));
  const std = physics.tuning.props.book;
  const density = std.mass / (8 * std.half[0] * std.half[1] * std.half[2]);
  const byPiece = level.pieces.map((piece) => {
    const fill = PROPS[piece.item.id];
    if (!fill) return [];
    const p = placed(physics, piece.T);
    const book = (base, half, rotY = 0) => p.spawn('book', { base, rotY, dims: { half, mass: density * 8 * half[0] * half[1] * half[2] } });
    return fill(p, { rand, book, std });
  });

  // Clutter on open floor: two balls of yarn, a couple of books, a cushion, a big plant.
  const avoid = [{ x: level.cat.position[0], z: level.cat.position[2] }, level.home?.bedside].filter(Boolean);
  const spots = level.waypoints.filter((w) => Math.abs(w.x) < 3.0 && Math.abs(w.z) < 2.5);
  const taken = [];
  const take = (minGap) => {
    for (let tries = 0; tries < 40 && spots.length; tries++) {
      const s = spots[Math.floor(rand() * spots.length)];
      if ([...avoid, ...taken].every((q) => Math.hypot(q.x - s.x, q.z - s.z) > minGap)) { taken.push(s); return s; }
    }
    return null;
  };
  const clutter = [];
  for (let i = 0; i < 2; i++) {
    const s = take(0.8);
    if (s) clutter.push(physics.spawn('ball', { base: [s.x, SURFACES.floor, s.z], tag: 'yarn' }));
  }
  const b = take(0.8);
  if (b) clutter.push(...stackHeights(SURFACES.floor, std.half[1], 2).map((py, i) =>
    physics.spawn('book', { position: [b.x + i * 0.03, py, b.z], rotY: 0.5 + i * 0.6 })));
  const c = take(0.8);
  if (c) clutter.push(physics.spawn('pillow', { base: [c.x, SURFACES.floor, c.z], rotY: 0.35, tag: 'cushion', dims: { half: [0.22, 0.07, 0.22] } }));
  const all = [...byPiece.flat(), ...clutter];
  return { all, byPiece, clutter };
}
