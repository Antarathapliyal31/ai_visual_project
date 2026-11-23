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
/** Tuning with Christina's hiding-spot checks back on: he crouches to look under things. */
const looksUnder = () => freshTuning((t) => { t.owner.looksUnder = true; });

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
  it('a real crash wakes him: he walks to it, looks around, and soon gives up and goes back to sleep', () => {
    const s = setup();
    // Three plates dropped on the open floor between the bed and the desk.
    const at = [-0.6, -1.3];
    for (let i = 0; i < 3; i++) s.physics.spawn('plate', { position: [at[0] + 0.1 * i, 1.0 + 0.2 * i, at[1]] });
    let closest = Infinity, scanned = false, up = 0;
    s.run(20, () => {
      closest = Math.min(closest, Math.hypot(s.owner.state.x - at[0], s.owner.state.z - at[1]));
      if (s.owner.state.motor === 'scanning') scanned = true;
    });
    expect(closest).toBeLessThan(0.6);
    expect(scanned).toBe(true);
    // He never saw the cat: back in bed within half a minute of the crash, not wandering the room.
    s.run(40, () => { up = s.physics.stepCount; return s.owner.state.motor !== 'inBed'; });
    expect(s.owner.state.motor).toBe('inBed');
    expect(up / 120).toBeLessThan(30);
    s.run(20, () => s.owner.state.stage !== 'asleep'); // drowsy, then asleep
    expect(s.owner.state.stage).toBe('asleep');
    expect(s.caught).toHaveLength(0); // the cat was under the bed all along
  });

  it('his own bumps are not noises to him', () => {
    // Mugs on the floor in his way: walking into them is his doing, not something to go and look at.
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const cat = createCat(physics, { position: UNDER_BED, heading: 0 });
    let owner;
    const heard = [];
    const noise = createNoise(physics, { listener: () => owner.head(), onNoise: (n) => { heard.push(n); owner.hear(n); } });
    owner = createOwner(physics, { cat, wake: noise.meter });
    for (let i = 0; i < 120; i++) physics.step();
    const mugs = [-1.6, -1.2, -0.8].map((x) => physics.spawn('mug', { base: [x, 0, -1.4] }));
    for (let i = 0; i < 30; i++) physics.step();
    noise.meter.raise(0.8);
    owner.hear({ position: { x: 0.3, y: 0.05, z: -1.4 }, loudness: 0.8, heardLoudness: 0.8 });
    for (let i = 0; i < 120 * 8; i++) physics.step();
    expect(mugs.some((m) => Math.hypot(m.body.position.x - m.body.initPosition.x, m.body.position.z - m.body.initPosition.z) > 0.05)).toBe(true); // he did push through them
    expect(heard.filter((n) => n.impact.bodyA === owner.body || n.impact.bodyB === owner.body)).toEqual([]);
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

  /** Where he stops to look around, in order, and the hiding places he crouches to look into. */
  const watch = (s, seconds) => {
    const goals = [], crouched = [];
    s.run(seconds, () => {
      const st = s.owner.state;
      if (st.motor === 'scanning' && st.noise) {
        if (!goals.some((p) => Math.hypot(p.x - st.noise.x, p.z - st.noise.z) < 0.05)) goals.push({ x: st.noise.x, z: st.noise.z });
      }
      if (st.motor === 'crouching' && !crouched.includes(st.spot.id)) crouched.push(st.spot.id);
    });
    return { goals, crouched };
  };

  it('with only a noise to go on, he looks where it was and nowhere else', () => {
    const s = setup(); // the cat stays hidden under the bed
    s.noise.meter.raise(0.8);
    s.sound([1.2, 1.8]); // south-east of the room, near nothing
    const { goals, crouched } = watch(s, 40);
    expect(goals).toHaveLength(1);
    expect(Math.hypot(goals[0].x - 1.2, goals[0].z - 1.8)).toBeLessThan(0.05);
    expect(s.owner.state.motor === 'inBed' || s.owner.state.motor === 'lyingDown').toBe(true);
    expect(crouched).toEqual([]);
  });

  /** He sees the cat as he gets up, then it dashes under the bed, out of sight: what he does next. */
  const lostUnderTheBed = (t) => {
    const s = setup({ catAt: [-1.0, R + 0.001, -1.3], t }); // in front of the bed, where he'll see it as he gets up
    s.noise.meter.raise(0.8);
    s.run(8, () => !s.owner.state.seesCat);
    expect(s.owner.state.seesCat).toBe(true);
    s.cat.teleport(UNDER_BED);
    let crouchedAt = null, planned = 0;
    s.run(30, () => {
      if (s.owner.state.motor === 'crouching') crouchedAt ??= s.owner.state.spot.id;
      planned = Math.max(planned, s.owner.state.route.length);
    });
    return { s, crouchedAt, planned };
  };

  it('once he has seen the cat and lost it, he searches harder (a sweep of that part of the room) but never looks under things', () => {
    const { s, crouchedAt, planned } = lostUnderTheBed();
    expect(planned).toBeGreaterThanOrEqual(1); // he lines up places to look round there
    expect(crouchedAt).toBe(null); // and doesn't look under the bed after it
    expect(s.caught).toHaveLength(0);
  });

  it('with looksUnder on, he also looks under the bed after the cat (the skirt still hides it)', () => {
    const { s, crouchedAt } = lostUnderTheBed(looksUnder());
    expect(crouchedAt).toBe('underBed');
    expect(s.caught).toHaveLength(0);
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

  it('with looksUnder on, never sees a cat under the bed, even when he crouches to look', () => {
    const s = setup({ catAt: UNDER_BED, t: looksUnder() });
    expect(hidingSpotAt(s.cat.body.position)?.id).toBe('underBed');
    s.noise.meter.raise(0.8);
    s.sound([-1.2, 0.3]); // by the foot of the bed
    let crouchedAtBed = false;
    s.run(30, () => { if (s.owner.state.motor === 'crouching' && s.owner.state.spot?.id === 'underBed') crouchedAtBed = true; });
    expect(crouchedAtBed).toBe(true);
    expect(s.caught).toHaveLength(0);
  });

  it('leaves a cat under the desk alone: he looks round in front of it but never under it', () => {
    const s = setup({ catAt: UNDER_DESK });
    s.noise.meter.raise(0.8);
    s.sound([0.3, -1.3]); // in front of the desk
    let crouched = false, scanned = false;
    s.run(25, () => {
      if (s.owner.state.motor === 'crouching') crouched = true;
      if (s.owner.state.motor === 'scanning') scanned = true;
    });
    expect(scanned).toBe(true);
    expect(crouched).toBe(false);
    expect(s.caught).toHaveLength(0);
  });

  it('with looksUnder on, finds a cat under the desk when he crouches to look', () => {
    const s = setup({ catAt: UNDER_DESK, t: looksUnder() });
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
