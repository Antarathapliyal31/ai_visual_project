import { describe, it, expect } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { createCat } from '../../src/player/cat.js';
import { createNoise } from '../../src/noise/index.js';
import { createOwner, createNavigator, WAYPOINTS, BEDSIDE } from '../../src/ai/index.js';
import { STATIC_BOXES, hidingSpotAt } from '../../src/collision/index.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';

const R = tuning.cat.radius;
const UNDER_BED = [-2.4, R + 0.001, -0.1];
const UNDER_DESK = [0.3, R + 0.001, -2.6];
const OPEN_FLOOR = [1.0, R + 0.001, 1.2];

function setup({ catAt = UNDER_BED, catHeading = 0, t = freshTuning() } = {}) {
  const physics = createPhysicsWorld({ tuning: t });
  const cat = createCat(physics, { position: catAt, heading: catHeading });
  let owner;
  const caught = [];
  const noise = createNoise(physics, { listener: () => owner.head(), onNoise: (n) => owner.hear(n) });
  owner = createOwner(physics, { cat, wake: noise.meter, onCaught: () => caught.push(physics.stepCount) });
  const trail = [];
  const run = (seconds, each) => {
    for (let i = 0, n = Math.round(seconds * 120); i < n; i++) {
      physics.step();
      trail.push({ x: owner.state.x, z: owner.state.z, motor: owner.state.motor });
      if (each?.() === false) return;
    }
  };
  run(1); // the room settles
  /** A sound he hears from p, as the noise model would send it. */
  const sound = (p, heardLoudness = 0.6) => owner.hear({ position: { x: p[0], y: 0.05, z: p[1] }, loudness: heardLoudness, heardLoudness });
  return { physics, cat, noise, owner, caught, run, trail, sound };
}

describe('owner in bed', () => {
  it('sleeps through a quiet room, in bed and out of the way', () => {
    const s = setup();
    s.run(10);
    expect(s.owner.state.stage).toBe('asleep');
    expect(s.owner.state.motor).toBe('inBed');
    expect(s.owner.body.collisionFilterMask).toBe(0); // the cat can walk on the bed
    expect(s.caught).toHaveLength(0);
  });

  it("wakes in Christina's stages as the meter rises, and gets up at standing", () => {
    const s = setup();
    const seen = [];
    for (const level of [0.25, 0.5, 0.75]) {
      s.noise.meter.raise(level);
      s.run(0.2);
      seen.push(s.owner.state.stage);
    }
    expect(seen).toEqual(['stirring', 'sittingUp', 'standing']);
    expect(s.owner.state.motor).toBe('gettingUp');
    s.run(tuning.owner.getUpTime + 0.1);
    expect(s.owner.state.motor).not.toBe('gettingUp');
    expect(Math.hypot(s.owner.state.x - BEDSIDE.x, s.owner.state.z - BEDSIDE.z)).toBeLessThan(0.3);
    expect(s.owner.body.collisionFilterMask).not.toBe(0);
  });

  it('sitting up, he sees a cat down the room and that wakes him fast', () => {
    // From his pillow the bed hides the floor just past its foot; a little further he sees.
    const s = setup({ catAt: [0.2, R + 0.001, -0.2] });
    s.noise.meter.raise(0.5); // sitting up
    s.run(2);
    expect(s.owner.state.stage === 'standing' || s.owner.state.stage === 'awake').toBe(true);
  });
});

describe('owner up and about', () => {
  it('a real crash wakes him: he walks to it, looks around and goes back to bed once it is quiet', () => {
    const s = setup();
    // Three plates dropped on the open floor between the bed and the desk.
    const at = [-0.6, -1.3];
    for (let i = 0; i < 3; i++) s.physics.spawn('plate', { position: [at[0] + 0.1 * i, 1.0 + 0.2 * i, at[1]] });
    let closest = Infinity, scanned = false;
    s.run(20, () => {
      closest = Math.min(closest, Math.hypot(s.owner.state.x - at[0], s.owner.state.z - at[1]));
      if (s.owner.state.motor === 'scanning') scanned = true;
    });
    expect(closest).toBeLessThan(0.6);
    expect(scanned).toBe(true);
    s.run(90, () => s.owner.state.motor !== 'inBed');
    expect(s.owner.state.motor).toBe('inBed');
    expect(s.owner.state.stage).toBe('asleep');
    expect(s.caught).toHaveLength(0); // the cat was under the bed all along
  });

  it('walks round the furniture, never through it', () => {
    const nav = createNavigator({ radius: tuning.owner.radius });
    const solid = STATIC_BOXES.filter((b) => b.center[1] + b.half[1] > 0.1 && b.center[1] - b.half[1] < 1.6 && !b.id.startsWith('wall') && !b.id.startsWith('boundary'));
    const inside = (p, b) => {
      const c = Math.cos(b.rotY ?? 0), sn = Math.sin(b.rotY ?? 0);
      const dx = p.x - b.center[0], dz = p.z - b.center[2];
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // into the box's frame
      return Math.abs(lx) < b.half[0] && Math.abs(lz) < b.half[2];
    };
    for (const from of WAYPOINTS) {
      for (const to of WAYPOINTS) {
        const path = nav.path(from, to);
        expect(path, `${from.id} -> ${to.id}`).not.toBeNull();
        const pts = [from, ...path];
        for (let i = 1; i < pts.length; i++) {
          for (let k = 0; k <= 20; k++) {
            const p = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * (k / 20), z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * (k / 20) };
            for (const b of solid) expect(inside(p, b), `${from.id} -> ${to.id} crosses ${b.id}`).toBe(false);
          }
        }
      }
    }
  });

  it('pushes a prop out of his way instead of stopping', () => {
    const s = setup();
    const book = s.physics.spawn('book', { base: [-1.6, 0, -1.5] }); // on the line from the bedside to the noise
    const start = book.body.position.clone();
    s.noise.meter.raise(0.8);
    s.sound([-0.6, -1.6]);
    let reached = false;
    s.run(8, () => { if (Math.hypot(s.owner.state.x + 0.6, s.owner.state.z + 1.6) < 0.3) reached = true; });
    expect(reached).toBe(true);
    expect(book.body.position.distanceTo(start)).toBeGreaterThan(0.05);
  });
});

describe('owner and the cat', () => {
  it('catches a cat that stays in the open', () => {
    const s = setup({ catAt: OPEN_FLOOR });
    s.noise.meter.raise(0.8);
    s.sound([0.6, 0.6]);
    s.run(20, () => s.caught.length === 0);
    expect(s.caught).toHaveLength(1);
    expect(s.owner.state.motor).toBe('caught');
  });

  it('never sees a cat under the bed, even when he looks there', () => {
    const s = setup({ catAt: UNDER_BED });
    expect(hidingSpotAt(s.cat.body.position)?.id).toBe('underBed');
    s.noise.meter.raise(0.8);
    s.sound([-1.2, 0.3]); // by the foot of the bed
    let crouchedAtBed = false;
    s.run(30, () => { if (s.owner.state.motor === 'crouching' && s.owner.state.spot?.id === 'underBed') crouchedAtBed = true; });
    expect(crouchedAtBed).toBe(true);
    expect(s.caught).toHaveLength(0);
  });

  it('finds a cat under the desk when he crouches to look', () => {
    const s = setup({ catAt: UNDER_DESK });
    expect(hidingSpotAt(s.cat.body.position)?.id).toBe('underDesk');
    s.noise.meter.raise(0.8);
    s.sound([0.3, -1.3]); // in front of the desk
    let seenStanding = false;
    s.run(25, () => {
      if (s.owner.state.seesCat && !['crouching', 'chasing', 'caught'].includes(s.owner.state.motor)) seenStanding = true;
      return s.caught.length === 0;
    });
    expect(seenStanding).toBe(false); // the desk panel hides it from standing height
    expect(s.caught).toHaveLength(1);
  });
});
