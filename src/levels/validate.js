// Is a level playable? The check every level passes before the game uses it,
// whoever placed its furniture (a person, or a model through
// scripts/generate-level.mjs, which sends these errors back for another try,
// so each message says where things are and what to change).
//
// Errors (the level is rejected):
//   unreadable        the description cannot be compiled
//   too-many          more of an item than the inventory allows
//   bed               not exactly one bed
//   hidden-wall       a tall or wall-mounted piece on the east or south wall,
//                     which the camera looks through
//   out-of-room       a piece sticks out of the room
//   overlap           two pieces share space
//   bed-blocked       no side of the bed the owner can get out on
//   owner-cant-reach  he cannot walk to a hiding place to check it
//   cat-start         the cat starts inside furniture
//   cat-cant-reach    the cat cannot walk into a hiding place
//   few-hiding        fewer than two hiding places
//   not-hidden        a "hiding place" he sees into from most of the room
//   few-breakables    fewer than four plates and mugs to break
//   props-unstable    props fall, roll away or keep moving after spawning
//   cramped           too little open floor to play on
// Warnings (allowed, reported): exposed hiding places, sealed-off floor.
//
// It also measures the level (metrics) and turns that into a difficulty 1-5.
//
// No Three.js: runs headless.

import { ROOM, lineOfSight } from '../collision/index.js';
import { STATIC } from '../core/groups.js';
import { createNavigator } from '../ai/navigation.js';
import { createPhysicsWorld } from '../physics/world.js';
import { tuning as defaultTuning } from '../core/tuning.js';
import { INVENTORY } from './inventory.js';
import { floorGrid } from './compile.js';
import { loadLevel } from './index.js';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const describe = (piece) => {
  const s = piece.spec;
  return s.wall ? `${s.item} (${s.wall} wall, at ${s.at})` : `${s.item} (x ${s.x}, z ${s.z}, turn ${s.turn ?? 0})`;
};
const f2 = (v) => v.toFixed(2);
/** Where a piece is on the floor, as the model can compare it with others. */
const covers = (piece) => {
  const fp = piece.footprint;
  return `covers x ${f2(fp.minX)}..${f2(fp.maxX)}, z ${f2(fp.minZ)}..${f2(fp.maxZ)}`;
};
/** The pieces standing within `r` of a point on the floor. */
const piecesAt = (level, p, r) => level.pieces.filter((piece) => {
  const fp = piece.footprint;
  return p.x > fp.minX - r && p.x < fp.maxX + r && p.z > fp.minZ - r && p.z < fp.maxZ + r;
});

/** Axis-aligned bounds of a box (its turned footprint) in 3D. */
function bounds(b) {
  const c = Math.cos(b.rotY ?? 0), s = Math.sin(b.rotY ?? 0);
  const [hx, hy, hz] = b.half;
  const ex = Math.abs(hx * c) + Math.abs(hz * s), ez = Math.abs(hx * s) + Math.abs(hz * c);
  return { minX: b.center[0] - ex, maxX: b.center[0] + ex, minY: b.center[1] - hy, maxY: b.center[1] + hy, minZ: b.center[2] - ez, maxZ: b.center[2] + ez };
}
const overlaps = (a, b, tol = 0.005) =>
  a.minX < b.maxX - tol && b.minX < a.maxX - tol && a.minY < b.maxY - tol && b.minY < a.maxY - tol && a.minZ < b.maxZ - tol && b.minZ < a.maxZ - tol;

const FACING = ['south (+z)', 'east (+x)', 'north (-z)', 'west (-x)'];
const STEP = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }];

/**
 * For a piece with one open side (the cardboard box): which way its opening
 * faces now, how much open floor lies in front, and which turns would point
 * it at a wall or a big piece about 1.1 to 1.5 m away, where it hides best
 * and the owner can still crouch in front of it.
 */
function facingHint(level, piece) {
  const fp = piece.footprint;
  const c = { x: (fp.minX + fp.maxX) / 2, z: (fp.minZ + fp.maxZ) / 2 };
  const others = level.pieces.filter((p) => p !== piece);
  const clearAhead = (k) => {
    const d = STEP[k];
    const start = k % 2 === 0 ? (fp.maxZ - fp.minZ) / 2 : (fp.maxX - fp.minX) / 2;
    for (let t = 0; t < 7; t += 0.05) {
      const p = { x: c.x + d.x * (start + t), z: c.z + d.z * (start + t) };
      if (p.x <= ROOM.minX || p.x >= ROOM.maxX || p.z <= ROOM.minZ || p.z >= ROOM.maxZ) return { t, what: 'the wall' };
      const hit = others.find(({ footprint: o }) => p.x > o.minX && p.x < o.maxX && p.z > o.minZ && p.z < o.maxZ);
      if (hit) return { t, what: `the ${hit.item.id}` };
    }
    return { t: 7, what: 'nothing' };
  };
  const turn = piece.spec.turn ?? 0;
  const now = clearAhead(turn);
  const good = [0, 1, 2, 3].filter((k) => k !== turn).map((k) => ({ k, ...clearAhead(k) })).filter((o) => o.t >= 1.05 && o.t <= 1.6);
  return `its opening faces ${FACING[turn]} with ${f2(now.t)} m of open floor in front before ${now.what}. `
    + `At turn 0 the opening faces ${FACING[0]}, turn 1 ${FACING[1]}, turn 2 ${FACING[2]}, turn 3 ${FACING[3]}. `
    + (good.length
      ? `Here, ${good.map((o) => `turn ${o.k} would face ${o.what} ${f2(o.t)} m away`).join('; ')}`
      : 'No turn here faces a wall or a big piece 1.1 to 1.5 m away: move it so one does');
}

/**
 * The floor as the cat walks it: a 10 cm grid of the spots its body fits
 * at, and how far apart they are on foot.
 */
function catGrid(level, tuning) {
  const r = tuning.cat.radius + 0.01;
  const nav = createNavigator({ radius: r, height: 0.26, boxes: level.boxes, waypoints: [] });
  const step = 0.1;
  const ni = Math.floor((ROOM.maxX - ROOM.minX - 2 * r) / step), nj = Math.floor((ROOM.maxZ - ROOM.minZ - 2 * r) / step);
  const key = (i, j) => i * 10000 + j;
  const cell = (i, j) => ({ x: ROOM.minX + r + i * step, z: ROOM.minZ + r + j * step });
  const index = (p) => [Math.round((p.x - ROOM.minX - r) / step), Math.round((p.z - ROOM.minZ - r) / step)];
  const fits = new Map();
  const free = (i, j) => {
    if (i < 0 || j < 0 || i > ni || j > nj) return false;
    const k = key(i, j);
    if (!fits.has(k)) fits.set(k, nav.clear(cell(i, j), cell(i, j)));
    return fits.get(k);
  };
  /** Steps on foot from the nearest of `sources` to every spot it can reach. */
  const spread = (sources) => {
    const dist = new Map(), queue = [];
    for (const [i, j] of sources) {
      if (free(i, j) && !dist.has(key(i, j))) { dist.set(key(i, j), 0); queue.push([i, j]); }
    }
    for (let h = 0; h < queue.length; h++) {
      const [i, j] = queue[h], d = dist.get(key(i, j));
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (dist.has(key(a, b)) || !free(a, b) || !nav.clear(cell(i, j), cell(a, b))) continue;
        dist.set(key(a, b), d + 1);
        queue.push([a, b]);
      }
    }
    return dist;
  };
  /** The grid spots inside a hiding volume. */
  const inside = (v) => {
    const out = [];
    const [i0, j0] = index({ x: v.min[0], z: v.min[2] }), [i1, j1] = index({ x: v.max[0], z: v.max[2] });
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = cell(i, j);
      if (c.x > v.min[0] && c.x < v.max[0] && c.z > v.min[2] && c.z < v.max[2]) out.push([i, j]);
    }
    return out;
  };
  return { step, key, cell, index, free, spread, inside };
}

/** Floor the cat can walk to from `start`. */
function catReach(grid, start) {
  const [i, j] = grid.index(start);
  if (!grid.free(i, j)) return { ok: false, cells: [] };
  const dist = grid.spread([[i, j]]);
  const cells = [...dist.keys()].map((k) => grid.cell(Math.floor(k / 10000), k % 10000));
  return { ok: true, cells };
}

/**
 * How far, on average, the cat runs from the things it breaks to the nearest
 * hiding place the owner cannot find even when he crouches (any hiding place,
 * if none is that safe), in metres.
 */
function runToHide(grid, breakables, volumes) {
  if (!breakables.length) return 0;
  const dist = grid.spread(volumes.flatMap((v) => grid.inside(v)));
  const runs = breakables.map((p) => {
    // From the floor just below or beside it, where the cat jumps down.
    const [i0, j0] = grid.index(p);
    let best = Infinity;
    for (let di = -6; di <= 6; di++) {
      for (let dj = -6; dj <= 6; dj++) {
        const d = dist.get(grid.key(i0 + di, j0 + dj));
        if (d !== undefined) best = Math.min(best, (d + Math.hypot(di, dj)) * grid.step);
      }
    }
    return Number.isFinite(best) ? best : 6;
  });
  return runs.reduce((s, x) => s + x, 0) / runs.length;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * How hard a room is to play, 1 (easy) to 5 (hard), from what makes the
 * cat's night hard: the owner seeing much of the room when he sits up in
 * bed, few hiding places he cannot find even crouching, few hiding places at
 * all, a long run from the plates and mugs to safety, and short walks for
 * him to the hiding places. Each part runs 0 (easy) to 1 (hard).
 */
export function difficultyOf(m) {
  const parts = {
    view: clamp01((m.bedView - 0.1) / 0.25),
    safe: 1 - clamp01((m.safeSpots - 1) / 3),
    spots: 1 - clamp01((m.hidingSpots - 2) / 5),
    run: clamp01((m.runToHide - 1) / 3),
    walk: 1 - clamp01((m.meanCheckPath - 2) / 3),
  };
  const score = 0.2 * parts.view + 0.25 * parts.safe + 0.15 * parts.spots + 0.3 * parts.run + 0.1 * parts.walk;
  for (const k of Object.keys(parts)) parts[k] = +parts[k].toFixed(2);
  return { parts, score: +score.toFixed(2), difficulty: 1 + Math.round(score * 4) };
}

/**
 * @param {object} spec  a level description
 * @param {{tuning?: object, settle?: boolean}} [opts]  settle: false skips the props check (fast)
 * @returns {{ok: boolean, errors: {code: string, message: string}[], warnings: {code: string, message: string}[], metrics: object, level?: object}}
 */
export function validateLevel(spec, opts = {}) {
  const tuning = opts.tuning ?? defaultTuning;
  const errors = [], warnings = [];
  const fail = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const result = () => ({ ok: errors.length === 0, errors, warnings, metrics, level });
  const metrics = {};
  let level = null;

  // ------------------------------------------------------------ the description
  try {
    level = loadLevel(spec, { tuning });
  } catch (e) {
    fail('unreadable', e.message);
    return result();
  }
  const counts = {};
  for (const p of spec.pieces) counts[p.item] = (counts[p.item] ?? 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    if (n > INVENTORY[id].maxCount) fail('too-many', `${n} ${id} pieces; at most ${INVENTORY[id].maxCount} allowed.`);
  }
  if ((counts.bed ?? 0) !== 1) fail('bed', `A level needs exactly one bed (it has ${counts.bed ?? 0}).`);
  for (const piece of level.pieces) {
    const item = piece.item;
    if (item.mount === 'wall' && (item.visibleWall || item.tall) && (piece.spec.wall === 'east' || piece.spec.wall === 'south')) {
      fail('hidden-wall', `${describe(piece)}: ${item.tall ? 'tall pieces' : 'this piece'} must stand on the north or west wall; the camera looks through the east and south sides.`);
    }
  }

  // ----------------------------------------------------- room and other pieces
  const tol = 0.01;
  for (const piece of level.pieces) {
    const fp = piece.footprint;
    if (fp.minX < ROOM.minX - tol || fp.maxX > ROOM.maxX + tol || fp.minZ < ROOM.minZ - tol || fp.maxZ > ROOM.maxZ + tol) {
      // Where its centre may go instead, so the fix is one number.
      const s = piece.spec;
      const rangeX = [ROOM.minX + (s.x ?? 0) - fp.minX, ROOM.maxX - (fp.maxX - (s.x ?? 0))];
      const rangeZ = [ROOM.minZ + (s.z ?? 0) - fp.minZ, ROOM.maxZ - (fp.maxZ - (s.z ?? 0))];
      let fix;
      if (s.wall) {
        const alongX = s.wall === 'north' || s.wall === 'south';
        const half = alongX ? (fp.maxX - fp.minX) / 2 : (fp.maxZ - fp.minZ) / 2;
        const [lo, hi] = alongX ? [ROOM.minX, ROOM.maxX] : [ROOM.minZ, ROOM.maxZ];
        fix = `on the ${s.wall} wall its "at" must be between ${f2(lo + half)} and ${f2(hi - half)}`;
      } else {
        fix = `at turn ${s.turn ?? 0} its centre must be within x ${f2(rangeX[0])}..${f2(rangeX[1])}, z ${f2(rangeZ[0])}..${f2(rangeZ[1])}`;
      }
      fail('out-of-room', `${describe(piece)} reaches x ${f2(fp.minX)}..${f2(fp.maxX)}, z ${f2(fp.minZ)}..${f2(fp.maxZ)}; the room is x ${ROOM.minX}..${ROOM.maxX}, z ${ROOM.minZ}..${ROOM.maxZ}, so ${fix}.`);
    }
  }
  for (let a = 0; a < level.pieces.length; a++) {
    for (let b = a + 1; b < level.pieces.length; b++) {
      const pa = level.pieces[a], pb = level.pieces[b];
      const A = [...pa.boxes, ...pa.occluders].map(bounds), B = [...pb.boxes, ...pb.occluders].map(bounds);
      if (A.some((x) => B.some((y) => overlaps(x, y)))) {
        // Moving the small or free-standing one is the fix that disturbs least.
        const area = (p) => (p.footprint.maxX - p.footprint.minX) * (p.footprint.maxZ - p.footprint.minZ);
        const loose = (p) => (p.item.mount === 'wall' ? 0 : 1);
        const mover = loose(pa) !== loose(pb) ? (loose(pa) ? pa : pb) : area(pa) <= area(pb) ? pa : pb;
        fail('overlap', `${describe(pa)} ${covers(pa)}, and ${describe(pb)} ${covers(pb)}: they overlap. Move the ${mover.spec.item} clear of the ${(mover === pa ? pb : pa).spec.item}, to open floor or a free stretch of wall.`);
      }
    }
  }
  if (errors.length) return result(); // the rest needs a room that makes sense

  // ------------------------------------------------------------- the owner
  const o = tuning.owner;
  const nav = createNavigator({ radius: o.radius, height: o.height, boxes: level.boxes, waypoints: level.waypoints });
  const home = level.home;
  if (!nav.clear(home.bedside, home.bedside, o.radius + 0.02)) {
    const sides = (home.bedsides ?? []).map((b) => {
      const inTheWay = piecesAt(level, b.at, o.radius).filter((p) => p !== home.piece).map(describe);
      return `x ${f2(b.at.x)}, z ${f2(b.at.z)}${inTheWay.length ? ` (blocked by ${inTheWay.join(', ')})` : ''}`;
    });
    fail('bed-blocked', `The owner cannot get out of bed: leave about 0.6 m of open floor beside one long side of the bed${sides.length ? `, where he stands up: ${sides.join(' or ')}` : ''}.`);
    return result();
  }
  const reachable = (from, to) => {
    const path = nav.path(from, to);
    if (!path) return null;
    const end = path.at(-1);
    if (flat(end, to) > 0.35) return null;
    let len = 0, prev = from;
    for (const p of path) { len += flat(prev, p); prev = p; }
    return len;
  };
  const checkPaths = [];
  for (const v of level.hidingVolumes) {
    const at = { x: v.checkFrom[0], z: v.checkFrom[2] };
    const len = reachable(home.bedside, at);
    const owner = level.pieces.find((p) => p.hiding.includes(v));
    if (len === null) {
      const inTheWay = piecesAt(level, at, o.radius).filter((p) => p !== owner).map((p) => `${describe(p)} ${covers(p)}`);
      const r = o.radius;
      const outside = at.x < ROOM.minX + r || at.x > ROOM.maxX - r || at.z < ROOM.minZ + r || at.z > ROOM.maxZ - r;
      const why = outside ? `; that spot is outside the room or against its wall: turn the ${owner?.spec.item ?? 'piece'} so its open side faces into the room, or move it away from the wall`
        : inTheWay.length ? `; in the way there: ${inTheWay.join('; ')}` : '; that spot is open, but there is no way to it from the bed';
      fail('owner-cant-reach', `The owner cannot walk to where he checks the hiding place ${v.id}${owner ? ` of ${describe(owner)}` : ''} (x ${f2(at.x)}, z ${f2(at.z)})${why}. Leave about 1 m of open floor there and a way to it.`);
    }
    else checkPaths.push(len);
  }
  // Open floor he can reach, against all the open floor there is (the same
  // 45 cm grid for every level, whatever waypoints it walks on).
  const grid = floorGrid(createNavigator({ radius: o.radius, height: o.height, boxes: level.boxes, waypoints: [] }), { radius: o.radius + 0.03 });
  const reachedGrid = grid.filter((w) => reachable(home.bedside, w) !== null);
  metrics.freeFloor = +(grid.length * 0.45 * 0.45).toFixed(1);
  if (grid.length && reachedGrid.length < 0.85 * grid.length) {
    warn('sealed-floor', `Some open floor is cut off from the bed (${grid.length - reachedGrid.length} of ${grid.length} grid points).`);
  }
  if (metrics.freeFloor < 12) fail('cramped', `Only about ${metrics.freeFloor} m² of open floor the owner can stand on; keep at least 12 m² (of 42) free.`);

  // ---------------------------------------------------------------- the cat
  const catAt = { x: level.cat.position[0], z: level.cat.position[2] };
  const catFloor = catGrid(level, tuning);
  const reach = catReach(catFloor, catAt);
  if (!reach.ok) {
    const inTheWay = piecesAt(level, catAt, tuning.cat.radius).map((p) => `${describe(p)} ${covers(p)}`);
    fail('cat-start', `The cat starts inside furniture at x ${catAt.x}, z ${catAt.z}${inTheWay.length ? ` (${inTheWay.join('; ')})` : ''}; start it on open floor.`);
  }
  const inside = (c, v) => c.x > v.min[0] && c.x < v.max[0] && c.z > v.min[2] && c.z < v.max[2];
  if (reach.ok) {
    for (const v of level.hidingVolumes) {
      if (!reach.cells.some((c) => inside(c, v))) fail('cat-cant-reach', `The cat cannot walk into the hiding place ${v.id}: its open side is blocked.`);
    }
  }
  if (level.hidingVolumes.length < 2) fail('few-hiding', `Only ${level.hidingVolumes.length} hiding place; use at least two (bed, desk, dining table, armchair, open box).`);

  // ------------------------------------------------- sight: do they hide?
  const physics = createPhysicsWorld({ tuning, room: { boxes: level.boxes, occluders: level.occluders }, guard: false, fracture: false });
  const sees = (from, to) => lineOfSight(physics.raycast, from, to, STATIC).visible;
  const standing = grid.map((w) => ({ x: w.x, y: o.eyeHeight, z: w.z }));
  metrics.exposure = {};
  const found = new Set(); // hiding places he finds the cat in when he crouches to look
  for (const v of level.hidingVolumes) {
    const target = { x: (v.min[0] + v.max[0]) / 2, y: 0.12, z: (v.min[2] + v.max[2]) / 2 };
    const near = standing.filter((e) => Math.hypot(e.x - target.x, e.z - target.z) < o.visionRange);
    const seenFrom = near.filter((e) => sees(e, target)).length;
    const exposure = near.length ? seenFrom / near.length : 0;
    metrics.exposure[v.id] = +exposure.toFixed(2);
    if (exposure > 0.35) {
      const owner = level.pieces.find((p) => p.hiding.includes(v));
      fail('not-hidden', `The hiding place ${v.id}${owner ? ` of ${describe(owner)}` : ''} is in plain view from ${Math.round(exposure * 100)}% of the room; ${owner?.item.id === 'cardboardBox' ? facingHint(level, owner) : 'move it so a wall or other furniture stands between it and the open room'}.`);
    }
    else if (exposure > 0.15) warn('exposed', `The hiding place ${v.id} can be seen from ${Math.round(exposure * 100)}% of the room.`);
    const crouch = { x: v.checkFrom[0], y: o.crouchEyeHeight, z: v.checkFrom[2] };
    if (sees(crouch, target)) found.add(v.id);
  }
  metrics.hidingSpots = level.hidingVolumes.length;
  metrics.crouchFinds = found.size;
  metrics.meanCheckPath = checkPaths.length ? +(checkPaths.reduce((s, x) => s + x, 0) / checkPaths.length).toFixed(2) : 0;

  // How much of the floor he sees from bed when he sits up.
  const eye = { x: home.sitEye.x, y: o.sitEyeHeight, z: home.sitEye.z };
  const sample = reach.cells.filter((_, i) => i % 3 === 0);
  const inView = sample.filter((c) => {
    const dx = c.x - eye.x, dz = c.z - eye.z;
    if (Math.hypot(dx, dz) > o.sitVisionRange) return false;
    const bearing = Math.atan2(-dz, dx), off = Math.atan2(Math.sin(bearing - home.facing), Math.cos(bearing - home.facing));
    return Math.abs(off) <= o.visionAngle + 1.2 && sees(eye, { x: c.x, y: 0.12, z: c.z });
  });
  metrics.bedView = sample.length ? +(inView.length / sample.length).toFixed(2) : 0;

  // ---------------------------------------------------------------- props
  // Spawned either way (it is quick): where the breakables are counts for difficulty.
  const world = createPhysicsWorld({ tuning, room: { boxes: level.boxes, occluders: level.occluders }, ...(opts.settle === false && { guard: false, fracture: false }) });
  const props = level.spawnProps(world);
  metrics.props = props.all.length;
  const breakables = world.props.filter((p) => p.kind === 'plate' || p.kind === 'mug');
  metrics.breakables = breakables.length;
  if (opts.settle !== false) {
    for (let i = 0; i < 180; i++) world.step();
    const restless = world.props.filter((p) => {
      const b = p.body, v = b.velocity;
      return b.position.y < -0.05 || b.position.x < ROOM.minX || b.position.x > ROOM.maxX || b.position.z < ROOM.minZ || b.position.z > ROOM.maxZ
        || Math.hypot(v.x, v.y, v.z) > 0.3 || !Number.isFinite(b.position.x);
    });
    if (restless.length) fail('props-unstable', `${restless.length} props fell or kept moving after spawning (${[...new Set(restless.map((p) => p.kind))].join(', ')}); a piece's props may be landing on another piece.`);
  }
  if (metrics.breakables < 4) fail('few-breakables', `Only ${metrics.breakables} plates and mugs to break; include the desk or the dining table.`);

  // ---------------------------------------------------------- difficulty
  const safeVolumes = level.hidingVolumes.filter((v) => !found.has(v.id));
  metrics.safeSpots = safeVolumes.length;
  metrics.runToHide = +runToHide(catFloor, breakables.map((p) => p.body.position), safeVolumes.length ? safeVolumes : level.hidingVolumes).toFixed(2);
  const d = difficultyOf(metrics);
  metrics.difficultyParts = d.parts;
  metrics.difficultyScore = d.score;
  metrics.difficulty = d.difficulty;
  return result();
}
