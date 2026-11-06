// Room scene (Workstream B): the slice scene plus the room clusters.
//
//   desk        the slice scene (five plates, two mugs, a book), a lamp, a monitor and keyboard
//   bookshelf   rows of standing books, a few lying in piles, a plant on top
//   nightstand  a lamp and an alarm clock, under the wall shelf's books and plant
//   bed         a pillow
//   plants      one on the window sill, a big one on the floor
//   floor       two balls of yarn, a couple of books, a cushion
//   couch       a cushion; coffee table: a mug and a book on top, books on its shelf
//   cat tree    a ball of yarn on the perch
//
// Everything is a real prop on A's static geometry: positions come from
// STATIC_BOXES and SURFACES, so the clusters follow the furniture if the
// layout moves. The fill is seeded, so every run and every test sees the
// same room.
//
// No Three.js: simulation code must run headless.

import { SURFACES, STATIC_BOXES } from '../collision/index.js';
import { spawnSliceScene } from './sliceScene.js';
import { stackHeights } from './props.js';

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

/** Extents of one of A's static boxes. */
function extents(id) {
  const b = STATIC_BOXES.find((s) => s.id === id);
  if (!b) throw new Error(`static geometry has no box "${id}"`);
  const [cx, cy, cz] = b.center, [hx, hy, hz] = b.half;
  return { cx, cy, cz, minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, top: cy + hy };
}

// How full each bookshelf shelf is, bottom to top (the rest stays free for the cat).
const SHELF_FILL = [0.92, 0.7, 0.82, 0.45];

/**
 * @param {ReturnType<import('./world.js').createPhysicsWorld>} physics
 * @param {{seed?: number}} [opts]
 * @returns {object} Prop records by cluster, and `all`
 */
export function spawnRoomScene(physics, opts = {}) {
  const rand = mulberry32(opts.seed ?? 549);
  const between = (lo, hi) => lo + (hi - lo) * rand();
  const std = physics.tuning.props.book;
  const density = std.mass / (8 * std.half[0] * std.half[1] * std.half[2]);
  /** A book of any size, with the standard book's density. `half` is [x, y, z]. */
  const book = (base, half, rotY = 0) =>
    physics.spawn('book', { base, rotY, dims: { half, mass: density * 8 * half[0] * half[1] * half[2] } });

  const slice = spawnSliceScene(physics);

  // --- Bookshelf: standing books from the left, sometimes a lying pile after them.
  const left = extents('bookshelfSideL'), right = extents('bookshelfSideR'), panel = extents('bookshelfPanel0');
  const x0 = left.maxX + 0.015, x1 = right.minX - 0.015;
  const shelfZ = panel.cz - 0.01;
  const shelfBooks = [];
  SURFACES.bookshelfShelves.forEach((y, i) => {
    const end = x0 + (x1 - x0) * SHELF_FILL[i];
    let x = x0;
    for (;;) {
      const thick = between(0.035, 0.06);
      if (x + thick > end) break;
      shelfBooks.push(book([x + thick / 2, y, shelfZ], [thick / 2, between(0.10, 0.145), between(0.07, 0.085)]));
      x += thick + 0.004;
    }
    // Room left over: a couple of books lying flat.
    if (x1 - x >= 2 * std.half[0] + 0.05) {
      const px = x + 0.03 + std.half[0];
      stackHeights(y, std.half[1], i % 2 ? 3 : 2).forEach((py) => {
        shelfBooks.push(physics.spawn('book', { position: [px, py, shelfZ], rotY: between(-0.12, 0.12) }));
      });
    }
  });

  // --- Wall shelf (above the nightstand): three books, spines to the room, and a small plant.
  const shelf = extents('wallShelf');
  const wallShelfBooks = [];
  let z = shelf.minZ + 0.08;
  for (let i = 0; i < 3; i++) {
    const thick = between(0.035, 0.055);
    wallShelfBooks.push(book([shelf.cx, SURFACES.wallShelfTop, z + thick / 2], [0.075, between(0.10, 0.13), thick / 2]));
    z += thick + 0.004;
  }
  const shelfPot = physics.spawn('pot', { base: [shelf.cx, SURFACES.wallShelfTop, shelf.maxZ - 0.2] });

  // --- Nightstand: lamp at the back, clock at the front facing the bed.
  const ns = extents('nightstand');
  const bedsideLamp = physics.spawn('lamp', { base: [ns.cx - 0.05, SURFACES.nightstandTop, ns.cz - 0.08] });
  const clock = physics.spawn('clock', { base: [ns.cx + 0.05, SURFACES.nightstandTop, ns.maxZ - 0.08] });

  // --- Desk lamp in the back right corner; monitor at the back, keyboard in front of it.
  const desk = extents('deskTop');
  const deskLamp = physics.spawn('lamp', { base: [desk.maxX - 0.2, SURFACES.deskTop, desk.minZ + 0.2] });
  const screenX = desk.cx + 0.12;
  const monitor = physics.spawn('monitor', { base: [screenX, SURFACES.deskTop, desk.minZ + 0.19] });
  const keyboard = physics.spawn('keyboard', { base: [screenX, SURFACES.deskTop, desk.minZ + 0.4] });

  // --- Pillow at the head of the bed.
  const mattress = extents('bedMattress');
  const pillow = physics.spawn('pillow', { base: [mattress.minX + 0.3, SURFACES.bedTop, mattress.cz] });

  // --- Plants: on the sill, on top of the bookshelf, and a big one on the floor between desk and bookshelf.
  const sill = extents('windowSill');
  const sillPot = physics.spawn('pot', { base: [sill.cx, SURFACES.windowSillTop, sill.cz] });
  const topPot = physics.spawn('pot', { base: [right.minX - 0.15, SURFACES.bookshelfTop, shelfZ] });
  const pedestal = extents('deskPedestal');
  const floorPot = physics.spawn('pot', {
    base: [(pedestal.maxX + left.minX) / 2, SURFACES.floor, panel.maxZ - 0.05],
    dims: { radiusTop: 0.15, radiusBottom: 0.11, height: 0.26, mass: 3 },
  });

  // --- On the floor: things a cat finds on its own.
  const bedFoot = extents('bedPlatform');
  const balls = [
    physics.spawn('ball', { base: [0.95, SURFACES.floor, 1.35], tag: 'yarn' }),
    physics.spawn('ball', { base: [bedFoot.maxX + 0.75, SURFACES.floor, 0.35], tag: 'yarn' }),
  ];
  const bx = bedFoot.maxX + 0.45, bz = bedFoot.maxZ + 0.35;
  const floorBooks = stackHeights(SURFACES.floor, std.half[1], 2).map((py, i) =>
    physics.spawn('book', { position: [bx + i * 0.03, py, bz], rotY: 0.5 + i * 0.6 }));
  const cushion = physics.spawn('pillow', { base: [2.45, SURFACES.floor, 1.75], rotY: 0.35, tag: 'cushion', dims: { half: [0.22, 0.07, 0.22] } });

  // --- The sitting corner: a cushion on the couch, a mug and a book on the
  // coffee table, a pile of books on its shelf.
  const seat = extents('couchSeat'), table = extents('coffeeTableTop');
  const couchCushion = physics.spawn('pillow', { base: [seat.cx - 0.05, SURFACES.couchSeatTop, seat.minZ + 0.3], rotY: 0.25, tag: 'cushion', dims: { half: [0.18, 0.07, 0.2] } });
  const tableMug = physics.spawn('mug', { base: [table.cx + 0.05, SURFACES.coffeeTableTop, table.cz - 0.25] });
  const tableBook = physics.spawn('book', { base: [table.cx - 0.02, SURFACES.coffeeTableTop, table.cz + 0.22], rotY: 1.2 });
  const underTable = stackHeights(SURFACES.coffeeTableShelfTop, std.half[1], 2).map((py, i) =>
    physics.spawn('book', { position: [table.cx, py, table.cz + 0.1], rotY: 1.57 + i * 0.25 }));

  // --- A ball of yarn left on the cat tree's perch.
  const perch = extents('catTreePerch');
  const perchBall = physics.spawn('ball', { base: [perch.cx + 0.05, SURFACES.catTreePerchTop, perch.cz + 0.05], tag: 'yarn' });
  balls.push(perchBall);

  const lamps = [bedsideLamp, deskLamp];
  const pots = [shelfPot, sillPot, topPot, floorPot];
  const sitting = [couchCushion, tableMug, tableBook, ...underTable];
  return {
    ...slice,
    shelfBooks, wallShelfBooks, lamps, clock, pillow, pots, balls, floorBooks, cushion, monitor, keyboard,
    couchCushion, tableMug, tableBook, underTable,
    all: [...slice.all, ...shelfBooks, ...wallShelfBooks, ...lamps, clock, pillow, ...pots, ...balls, ...floorBooks, cushion, monitor, keyboard, ...sitting],
  };
}
