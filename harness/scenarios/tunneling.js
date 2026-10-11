// Tunneling proof scenario (owner: A).
//
// 100 swats at 12 m/s into a 2 cm shelf must give zero pass-throughs. Then the
// speed is raised until the shelf fails, with the guard on and with it off,
// and the failure speeds are logged.
//
// Why this is a real test: at 120 Hz a 12 m/s mug moves 10 cm per substep,
// five times the shelf's thickness, so discrete collision alone can miss it.
//
// Scenario contract (D's harness): {name, setup, step, metrics, pass}.
//   setup()   builds the world
//   step()    advances one fixed 1/120 s substep; returns false when finished
//   metrics() current numbers for the overlay / log
//   pass(m)   true when the proof criterion holds
// Runs headless (Vitest) and in the browser; no Three.js.

import * as CANNON from 'cannon-es';
import { tuning } from '../../src/core/tuning.js';
import { PROP } from '../../src/core/groups.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { makeStaticBox } from '../../src/collision/staticGeometry.js';
import { createSweptGuard } from '../../src/collision/sweptGuard.js';

const SWAT_CAP = 12; // m/s, swat() contract

// The proof shelf: 2.0 m x 2 cm x 0.6 m, top face at y = 1.41.
export const SHELF = { id: 'proofShelf', center: [0, 1.4, 0], half: [1.0, 0.01, 0.3], material: 'wood', role: 'solid' };

// Mug collider as in B's props (until B's factory exists).
const MUG = { radiusTop: 0.08, radiusBottom: 0.07, height: 0.14, mass: 0.3 };

/**
 * Day-one stub of B's swat(target, direction, speed): sets the velocity
 * directly, capped at 12 m/s. Replace with B's swat() once it lands.
 */
export function stubSwat(target, direction, speed) {
  const s = Math.min(speed, SWAT_CAP);
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  target.wakeUp();
  target.velocity.set((direction.x / len) * s, (direction.y / len) * s, (direction.z / len) * s);
}

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

/**
 * @param {object} [opts]
 * @param {number} [opts.speed=12]      m/s. Above the 12 m/s swat cap the velocity is set directly (ramp only).
 * @param {number} [opts.swats=100]
 * @param {boolean} [opts.guard=true]   swept guard on or off
 * @param {number} [opts.seed=549]
 * @param {number} [opts.stepsPerSwat=36] 0.3 s per swat
 */
export function createTunnelingScenario(opts = {}) {
  const { speed = 12, swats = 100, guard: guardOn = true, seed = 549, stepsPerSwat = 36 } = opts;
  const dt = tuning.physics.fixedStep;
  const shelfBottom = SHELF.center[1] - SHELF.half[1];
  // Count a pass-through only well inside the footprint, so a mug that slides
  // off an edge and drops past it never counts.
  const inset = 0.1;

  let world, guard, rand, mug, stepInSwat, done, passThroughs, swatCount, tunnelledThisSwat;

  const spawnAndSwat = () => {
    if (mug) world.removeBody(mug);
    mug = new CANNON.Body({
      mass: MUG.mass,
      shape: new CANNON.Cylinder(MUG.radiusTop, MUG.radiusBottom, MUG.height, 12),
      collisionFilterGroup: PROP,
      linearDamping: 0.01,
    });
    const x = (rand() * 2 - 1) * 0.6, z = (rand() * 2 - 1) * 0.12;
    mug.position.set(x, SHELF.center[1] + 0.3, z);
    mug.quaternion.setFromEuler((rand() * 2 - 1) * 0.6, rand() * 6.28, (rand() * 2 - 1) * 0.6);
    mug.angularVelocity.set((rand() * 2 - 1) * 6, (rand() * 2 - 1) * 6, (rand() * 2 - 1) * 6);
    mug.aabbNeedsUpdate = true;
    world.addBody(mug);

    // Mostly downward, up to ~10 degrees off vertical, always into the shelf.
    const dir = { x: (rand() * 2 - 1) * 0.18, y: -1, z: (rand() * 2 - 1) * 0.18 };
    if (speed <= SWAT_CAP) {
      stubSwat(mug, dir, speed);
    } else {
      // Ramp beyond the swat cap: set the velocity directly to find the failure speed.
      const len = Math.hypot(dir.x, dir.y, dir.z);
      mug.velocity.set((dir.x / len) * speed, (dir.y / len) * speed, (dir.z / len) * speed);
    }
    stepInSwat = 0;
    tunnelledThisSwat = false;
    swatCount++;
  };

  const scenario = {
    name: `tunneling ${speed} m/s, guard ${guardOn ? 'on' : 'off'}`,

    setup() {
      rand = mulberry32(seed);
      world = new CANNON.World({ gravity: new CANNON.Vec3(0, tuning.physics.gravity, 0) });
      world.broadphase = new UniformGridBroadphase();
      world.allowSleep = false;
      world.addBody(makeStaticBox(SHELF));
      guard = createSweptGuard(world);
      guard.enabled = guardOn;
      world.addEventListener('postStep', () => {
        if (!mug || tunnelledThisSwat) return;
        const p = mug.position;
        const inFootprint = Math.abs(p.x - SHELF.center[0]) < SHELF.half[0] - inset && Math.abs(p.z - SHELF.center[2]) < SHELF.half[2] - inset;
        if (inFootprint && p.y < shelfBottom) {
          tunnelledThisSwat = true;
          passThroughs++;
        }
      });
      mug = null;
      passThroughs = 0;
      swatCount = 0;
      done = false;
      spawnAndSwat();
      return world;
    },

    step() {
      if (done) return false;
      world.step(dt);
      stepInSwat++;
      if (stepInSwat >= stepsPerSwat) {
        if (swatCount >= swats) {
          done = true;
          return false;
        }
        spawnAndSwat();
      }
      return true;
    },

    metrics() {
      return {
        speed,
        guard: guardOn,
        swats: swatCount,
        passThroughs,
        guardChecked: guard.stats.checked,
        guardClamps: guard.stats.clamps,
      };
    },

    pass(m = scenario.metrics()) {
      return m.swats >= swats && m.passThroughs === 0;
    },

    get world() { return world; },
    get guard() { return guard; },
  };
  return scenario;
}

/** Run a scenario to completion (headless helper). */
export function runScenario(scenario, maxSteps = 1e7) {
  scenario.setup();
  for (let i = 0; i < maxSteps && scenario.step(); i++);
  const m = scenario.metrics();
  return { ...m, pass: scenario.pass(m) };
}

/**
 * Raise the speed until the shelf fails. Returns the first speed with any
 * pass-through (or null if none up to maxSpeed) and the per-speed results.
 */
export function findFailureSpeed({ guard = true, from = 12, to = 100, stepBy = 4, swats = 30, seed = 549 } = {}) {
  const results = [];
  for (let speed = from; speed <= to; speed += stepBy) {
    const r = runScenario(createTunnelingScenario({ speed, swats, guard, seed }));
    results.push(r);
    if (r.passThroughs > 0) return { failureSpeed: speed, results };
  }
  return { failureSpeed: null, results };
}
