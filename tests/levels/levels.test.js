import { describe, it, expect } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { createCat } from '../../src/player/cat.js';
import { createNoise } from '../../src/noise/index.js';
import { createOwner } from '../../src/ai/index.js';
import { hidingSpotAt } from '../../src/collision/index.js';
import { tuning } from '../../src/core/tuning.js';
import { seesCat } from '../../src/ai/vision.js';
import { LEVELS, ORIGINAL, EXAMPLE_LEVELS, loadLevel } from '../../src/levels/index.js';
import { DESIGNED_LEVELS } from '../../src/levels/catalog.js';

// The rooms a model designed (in the game) and the prompt's hand-placed examples: all must play.
const ROOMS = [...DESIGNED_LEVELS, ...EXAMPLE_LEVELS];
import { validateLevel } from '../../src/levels/validate.js';
import { pictureSpots, rugSpots, pieceTop, PICTURE_BOTTOM } from '../../src/levels/decor.js';
import { ROOM } from '../../src/collision/index.js';
import { freshTuning } from '../helpers/tuning.js';

const R = tuning.cat.radius;

/** A round on a level, as play.html builds it, without the look. */
function setup(level, { catAt } = {}) {
  const t = freshTuning();
  const physics = createPhysicsWorld({ tuning: t, room: { boxes: level.boxes, occluders: level.occluders } });
  level.spawnProps(physics);
  const cat = createCat(physics, { position: catAt ?? level.cat.position, heading: level.cat.heading });
  let owner;
  const caught = [];
  const noise = createNoise(physics, { listener: () => owner.head(), onNoise: (n) => owner.hear(n) });
  owner = createOwner(physics, { cat, wake: noise.meter, level, onCaught: () => caught.push(physics.stepCount) });
  const run = (seconds, each) => {
    for (let i = 0, n = Math.round(seconds * 120); i < n; i++) {
      physics.step();
      if (each?.() === false) return;
    }
  };
  run(1);
  const sound = (p, heardLoudness = 0.6) => owner.hear({ position: { x: p.x, y: 0.05, z: p.z }, loudness: heardLoudness, heardLoudness });
  return { physics, cat, noise, owner, caught, run, sound };
}

/** A box's footprint contains p (in the box's own turned frame). */
function inside(p, b) {
  const c = Math.cos(b.rotY ?? 0), sn = Math.sin(b.rotY ?? 0);
  const dx = p.x - b.center[0], dz = p.z - b.center[2];
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) < b.half[0] && Math.abs(lz) < b.half[2];
}

describe('the level list', () => {
  it('starts with the original room; ids are unique; each says who designed it', () => {
    expect(LEVELS[0]).toBe(ORIGINAL);
    const ids = [...LEVELS, ...EXAMPLE_LEVELS].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of ROOMS) {
      expect(l.name, l.id).toBeTruthy();
      expect(l.designedBy, l.id).toMatch(/\S/);
    }
    // The game's rooms were designed by a model, not placed by hand.
    for (const l of DESIGNED_LEVELS) expect(l.designedBy, l.id).not.toMatch(/by hand/);
  });

  for (const spec of [...LEVELS, ...EXAMPLE_LEVELS]) {
    it(`${spec.id} passes the validator`, () => {
      const r = validateLevel(spec);
      expect(r.errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
      expect(r.metrics.difficulty).toBeGreaterThanOrEqual(1);
      expect(r.metrics.difficulty).toBeLessThanOrEqual(5);
      // The game files rooms by the difficulty they store: it must be what they measure
      // (after changing the scoring: node scripts/generate-level.mjs --rescore).
      expect(spec.difficulty, `${spec.id} stores difficulty`).toBe(r.metrics.difficulty);
    });
  }
});

describe('playing a designed level', () => {
  for (const spec of ROOMS) {
    it(`${spec.id}: he gets up at his own bed, checks a hiding place and goes back to bed`, () => {
      const level = loadLevel(spec);
      const bed = level.hidingVolumes.find((h) => h.id === 'underBed');
      const s = setup(level, { catAt: [(bed.min[0] + bed.max[0]) / 2, R + 0.001, (bed.min[2] + bed.max[2]) / 2] });
      const solid = level.boxes.filter((b) => b.center[1] + b.half[1] > 0.1 && b.center[1] - b.half[1] < 1.6 && !b.id.startsWith('wall') && !b.id.startsWith('boundary'));

      s.noise.meter.raise(0.8);
      s.run(tuning.owner.getUpTime + 0.2);
      expect(Math.hypot(s.owner.state.x - level.home.bedside.x, s.owner.state.z - level.home.bedside.z)).toBeLessThan(0.3);

      // A sound right by a hiding place that is not the bed: he walks over, looks, crouches.
      const v = level.hidingVolumes.find((h) => h.id !== 'underBed');
      const at = { x: (v.min[0] + v.max[0]) / 2, z: (v.min[2] + v.max[2]) / 2 };
      s.sound(at, 0.8);
      const checked = new Set();
      s.run(40, () => {
        const p = { x: s.owner.state.x, z: s.owner.state.z };
        if (s.owner.isUp) for (const b of solid) if (inside(p, b)) throw new Error(`he walked into ${b.id} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
        if (s.owner.state.motor === 'crouching') checked.add(s.owner.state.spot.id);
      });
      expect(checked.size).toBeGreaterThan(0);
      // Then it is quiet; he goes back to bed.
      s.run(60, () => s.owner.state.motor !== 'inBed');
      expect(s.owner.state.motor).toBe('inBed');
      expect(Math.hypot(s.owner.state.x - level.home.lie.x, s.owner.state.z - level.home.lie.z)).toBeLessThan(0.05);
      expect(s.caught).toHaveLength(0); // the cat was under the bed all along
    });
  }

  it('under the dining table the cat is hidden, from a standing look or a crouch', () => {
    // The cloth hangs from the top's edge almost to the floor (it once stopped at 30 cm,
    // and a standing owner saw a cat near the edge through the gap).
    const party = loadLevel(EXAMPLE_LEVELS.find((l) => l.id === 'dinner-party'));
    const v = party.hidingVolumes.find((h) => h.id === 'underTable');
    const c = { x: (v.min[0] + v.max[0]) / 2, z: (v.min[2] + v.max[2]) / 2 };
    const o = tuning.owner;
    for (const [dx, dz, heading] of [[0, 0, 0], [1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2], [1, 1, 0.8]]) {
      const at = [c.x + dx * ((v.max[0] - v.min[0]) / 2 - 0.12), R + 0.001, c.z + dz * ((v.max[2] - v.min[2]) / 2 - 0.12)];
      const physics = createPhysicsWorld({ room: { boxes: party.boxes, occluders: party.occluders }, guard: false, fracture: false });
      const cat = createCat(physics, { position: at, heading });
      for (let i = 0; i < 30; i++) physics.step();
      const p = cat.body.position;
      const view = { range: o.visionRange, angle: o.visionAngle };
      const looking = (eye) => Math.atan2(-(p.z - eye.z), p.x - eye.x);
      for (let x = -3.3; x <= 3.31; x += 0.2) {
        for (let z = -2.8; z <= 2.81; z += 0.2) {
          const eye = { x, y: o.eyeHeight, z };
          if (Math.hypot(x - p.x, z - p.z) < 0.3) continue;
          expect(seesCat(physics.raycast, eye, looking(eye), cat, view).seen, `standing at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
        }
      }
      for (const ck of v.checks) {
        const eye = { x: ck[0], y: o.crouchEyeHeight, z: ck[2] };
        expect(seesCat(physics.raycast, eye, looking(eye), cat, view).seen, `crouched at ${ck[0].toFixed(2)}, ${ck[2].toFixed(2)}`).toBe(false);
      }
    }
  });

  it('he comes to the table, crouches to look under it, and does not catch the cat there', () => {
    const party = loadLevel(EXAMPLE_LEVELS.find((l) => l.id === 'dinner-party'));
    const v = party.hidingVolumes.find((h) => h.id === 'underTable');
    const at = { x: v.max[0] - 0.15, z: (v.min[2] + v.max[2]) / 2 }; // near the edge, not tucked in the middle
    const s = setup(party, { catAt: [at.x, R + 0.001, at.z] });
    s.noise.meter.raise(0.85);
    s.sound(at, 0.9);
    const checked = new Set();
    s.run(45, () => { if (s.owner.state.motor === 'crouching') checked.add(s.owner.state.spot.id); });
    expect(checked.has('underTable')).toBe(true);
    expect(s.caught).toHaveLength(0);
  });

  it('the cat hides in the new furniture: under the dining table and in an open box', () => {
    const party = loadLevel('dinner-party');
    const table = party.hidingVolumes.find((v) => v.id === 'underTable');
    const p = { x: (table.min[0] + table.max[0]) / 2, y: R, z: (table.min[2] + table.max[2]) / 2 };
    expect(hidingSpotAt(p, party.hidingVolumes)?.id).toBe('underTable');

    const moving = loadLevel('moving-day');
    const box = moving.hidingVolumes.find((v) => v.id === 'inBox');
    const q = { x: (box.min[0] + box.max[0]) / 2, y: R, z: (box.min[2] + box.max[2]) / 2 };
    const s = setup(moving, { catAt: [q.x, R + 0.001, q.z] });
    s.run(2);
    const c = s.cat.body.position;
    expect(hidingSpotAt({ x: c.x, y: c.y, z: c.z }, moving.hidingVolumes)?.id).toBe('inBox');
  });
});

describe('dressing a designed level', () => {
  for (const spec of ROOMS) {
    it(`${spec.id}: pictures hang on free wall, apart; rugs lie inside the room`, () => {
      const level = loadLevel(spec);
      const pics = pictureSpots(level.pieces);
      expect(pics.length).toBeGreaterThanOrEqual(2);
      for (const p of pics) {
        const [lo, hi] = p.wall === 'north' ? [ROOM.minX, ROOM.maxX] : [ROOM.minZ, ROOM.maxZ];
        expect(p.along - p.w / 2, p.kind).toBeGreaterThan(lo);
        expect(p.along + p.w / 2, p.kind).toBeLessThan(hi);
        for (const piece of level.pieces) {
          if (pieceTop(piece) < PICTURE_BOTTOM) continue;
          const fp = piece.footprint;
          const near = p.wall === 'north' ? fp.minZ < ROOM.minZ + 0.6 : fp.minX < ROOM.minX + 0.6;
          const [s0, s1] = p.wall === 'north' ? [fp.minX, fp.maxX] : [fp.minZ, fp.maxZ];
          if (near) expect(p.along + p.w / 2 <= s0 || p.along - p.w / 2 >= s1, `${p.kind} behind ${piece.item.id}`).toBe(true);
        }
        for (const q of pics) {
          if (q === p || q.wall !== p.wall) continue;
          expect(Math.abs(q.along - p.along), `${p.kind} and ${q.kind}`).toBeGreaterThan((p.w + q.w) / 2);
        }
      }
      for (const r of rugSpots(level)) {
        expect(r.x - r.w / 2).toBeGreaterThanOrEqual(ROOM.minX);
        expect(r.x + r.w / 2).toBeLessThanOrEqual(ROOM.maxX);
        expect(r.z - r.d / 2).toBeGreaterThanOrEqual(ROOM.minZ);
        expect(r.z + r.d / 2).toBeLessThanOrEqual(ROOM.maxZ);
      }
    });
  }
});
