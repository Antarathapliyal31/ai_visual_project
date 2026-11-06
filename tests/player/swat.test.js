import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { swat } from '../../src/player/swat.js';
import { stubSwat, SHELF } from '../../harness/scenarios/tunneling.js';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { tuning } from '../../src/core/tuning.js';
import { mulberry32, range } from '../helpers/rng.js';
import { freshTuning } from '../helpers/tuning.js';

const CAP = tuning.swat.maxSpeed;
const mug = (opts = {}) => new CANNON.Body({ mass: 0.3, shape: new CANNON.Cylinder(0.08, 0.07, 0.14, 12), position: new CANNON.Vec3(0, 1, 0), ...opts });

describe('swat()', () => {
  it('follows the contract: the cap is 12 m/s', () => {
    expect(CAP).toBe(12);
  });

  it('sends a resting target off along the direction at the asked speed', () => {
    const b = mug();
    const r = swat(b, { x: 3, y: 0, z: 4 }, 5); // direction of any length
    expect(b.velocity.x).toBeCloseTo(3, 12);
    expect(b.velocity.y).toBeCloseTo(0, 12);
    expect(b.velocity.z).toBeCloseTo(4, 12);
    expect(r.exitSpeed).toBeCloseTo(5, 12);
    expect(r.impulse).toBeCloseTo(0.3 * 5, 12); // N·s = m * dv
    expect(r.capped).toBe(false);
    expect(b.angularVelocity.length()).toBe(0); // through the centre of mass: no spin
  });

  it("matches the day-one stub exactly on a resting target (A's scenario keeps its numbers)", () => {
    const rand = mulberry32(12);
    for (let i = 0; i < 500; i++) {
      const dir = { x: range(rand, -1, 1), y: range(rand, -1, 1), z: range(rand, -1, 1) };
      const speed = range(rand, 0.1, 30);
      const spin = [range(rand, -6, 6), range(rand, -6, 6), range(rand, -6, 6)];
      const a = mug(), b = mug();
      a.angularVelocity.set(...spin);
      b.angularVelocity.set(...spin);
      swat(a, dir, speed);
      stubSwat(b, dir, speed);
      expect(a.velocity.toArray()).toEqual(b.velocity.toArray()); // bit for bit
      expect(a.angularVelocity.toArray()).toEqual(b.angularVelocity.toArray());
    }
  });

  it('caps the exit speed at 12 m/s however hard the swat', () => {
    for (const speed of [12, 12.01, 40, 1e6]) {
      const b = mug();
      const r = swat(b, { x: 0, y: -1, z: 0 }, speed);
      expect(b.velocity.length()).toBeCloseTo(CAP, 12);
      expect(r.exitSpeed).toBeCloseTo(CAP, 12);
      expect(r.capped).toBe(speed > CAP);
    }
  });

  it('never lets an already moving target leave faster than the cap', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const b = mug();
      b.velocity.set(range(rand, -11, 11), range(rand, -11, 11), range(rand, -11, 11));
      swat(b, { x: range(rand, -1, 1), y: range(rand, -1, 1), z: range(rand, -1, 1) }, range(rand, 0.5, 20));
      expect(b.velocity.length()).toBeLessThanOrEqual(CAP + 1e-9);
    }
    // Along its motion the swat adds up, to the cap.
    const b = mug();
    b.velocity.set(8, 0, 0);
    const r = swat(b, { x: 1, y: 0, z: 0 }, 8);
    expect(b.velocity.x).toBeCloseTo(CAP, 12);
    expect(r.capped).toBe(true);
  });

  it('gives the same exit speed to any mass, with the impulse scaling', () => {
    for (const mass of [0.05, 0.3, 2, 20]) {
      const b = mug({ mass });
      const r = swat(b, { x: 1, y: 0, z: 0 }, 4);
      expect(b.velocity.x).toBeCloseTo(4, 12);
      expect(r.impulse).toBeCloseTo(mass * 4, 12);
    }
  });

  it('wakes a sleeping target', () => {
    const world = new CANNON.World();
    world.allowSleep = true;
    const b = mug();
    world.addBody(b);
    b.sleep();
    expect(b.sleepState).toBe(CANNON.Body.SLEEPING);
    swat(b, { x: 1, y: 0, z: 0 }, 3);
    expect(b.sleepState).toBe(CANNON.Body.AWAKE);
    expect(b.velocity.x).toBeCloseTo(3, 12);
  });

  it('ignores static and kinematic bodies, zero directions and zero speeds', () => {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)) });
    expect(swat(wall, { x: 1, y: 0, z: 0 }, 5).impulse).toBe(0);
    expect(wall.velocity.length()).toBe(0);
    const owner = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.3) });
    expect(swat(owner, { x: 1, y: 0, z: 0 }, 5).impulse).toBe(0);
    const b = mug();
    expect(swat(b, { x: 0, y: 0, z: 0 }, 5).impulse).toBe(0);
    expect(swat(b, { x: 1, y: 0, z: 0 }, 0).impulse).toBe(0);
    expect(b.velocity.length()).toBe(0);
  });

  it('spins the target when struck off-centre, by I^-1 (r x J)', () => {
    const b = new CANNON.Body({ mass: 0.4, shape: new CANNON.Box(new CANNON.Vec3(0.11, 0.025, 0.08)), position: new CANNON.Vec3(0, 1, 0) });
    // Push along +x at a point 5 cm towards +z: r x J = (0,0,0.05) x (J,0,0) = (0, 0.05 J, 0)
    const r = swat(b, { x: 1, y: 0, z: 0 }, 2, { point: { x: 0, y: 1, z: 0.05 } });
    const J = 0.4 * 2;
    expect(r.impulse).toBeCloseTo(J, 12);
    expect(b.velocity.toArray()).toEqual([2, 0, 0]); // the linear part is unchanged
    expect(b.angularVelocity.x).toBeCloseTo(0, 9);
    expect(b.angularVelocity.z).toBeCloseTo(0, 9);
    expect(b.angularVelocity.y).toBeCloseTo((0.05 * J) * b.invInertia.y, 9);
    expect(b.angularVelocity.y).toBeGreaterThan(0);
  });

  it('uses the current orientation for the spin, even if the body was turned by hand', () => {
    const b = new CANNON.Body({ mass: 0.4, shape: new CANNON.Box(new CANNON.Vec3(0.11, 0.025, 0.08)), position: new CANNON.Vec3(0, 1, 0) });
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2); // world x is now the body's y axis
    // Torque impulse about world x.
    swat(b, { x: 0, y: 1, z: 0 }, 2, { point: { x: 0, y: 1, z: 0.05 } });
    const L = -0.05 * 0.4 * 2; // (0,0,0.05) x (0,J,0) = (-0.05 J, 0, 0)
    expect(b.angularVelocity.x).toBeCloseTo(L * b.invInertia.y, 9);
  });

  it('caps the spin it adds', () => {
    const b = mug();
    swat(b, { x: 1, y: 0, z: 0 }, 12, { point: { x: 0, y: 1.07, z: 0.08 } }); // hard, at the rim
    expect(b.angularVelocity.length()).toBeLessThanOrEqual(tuning.swat.maxSpin + 1e-9);
    expect(b.angularVelocity.length()).toBeGreaterThan(5);
  });
});

// The tunneling proof is A's. This checks it survives the two things B
// changed underneath it: the real swat(), and B's world with its softer
// contacts and its own solver.
describe("swat() in B's world against A's 2 cm shelf", () => {
  function run({ guard, swats = 100, speed = 12 }) {
    const physics = createPhysicsWorld({ tuning: freshTuning(), room: { boxes: [SHELF], occluders: [] }, guard, allowSleep: false, fracture: false });
    const rand = mulberry32(549);
    const shelfBottom = SHELF.center[1] - SHELF.half[1];
    let passThroughs = 0;
    for (let n = 0; n < swats; n++) {
      const m = physics.spawn('mug', { position: [range(rand, -0.6, 0.6), SHELF.center[1] + 0.3, range(rand, -0.12, 0.12)] });
      m.body.quaternion.setFromEuler(range(rand, -0.6, 0.6), range(rand, 0, 6.28), range(rand, -0.6, 0.6));
      m.body.angularVelocity.set(range(rand, -6, 6), range(rand, -6, 6), range(rand, -6, 6));
      m.body.aabbNeedsUpdate = true;
      swat(m.body, { x: range(rand, -0.18, 0.18), y: -1, z: range(rand, -0.18, 0.18) }, speed);
      let through = false;
      for (let i = 0; i < 36; i++) {
        physics.step();
        const p = m.body.position;
        // Well inside the footprint, so sliding off an edge never counts.
        if (Math.abs(p.x) < SHELF.half[0] - 0.1 && Math.abs(p.z) < SHELF.half[2] - 0.1 && p.y < shelfBottom) through = true;
      }
      if (through) passThroughs++;
      physics.remove(m);
    }
    return { passThroughs, clamps: physics.guard ? physics.guard.stats.clamps : 0 };
  }

  it('100 swats at 12 m/s: zero pass-throughs with the guard on', () => {
    const r = run({ guard: true });
    console.log("[swat] B's swat() and world, guard on @12 m/s:", r);
    expect(r.passThroughs).toBe(0);
    expect(r.clamps).toBeGreaterThan(0);
  });

  it('and it is still a real test: without the guard some tunnel', () => {
    const r = run({ guard: false });
    console.log("[swat] B's swat() and world, guard off @12 m/s:", r);
    expect(r.passThroughs).toBeGreaterThan(0);
  });
});
