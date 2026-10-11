// Broadphase performance scenario (owner: A).
//
// Drops 200-400 small props into the static room and measures, per step:
// world.step() time, broadphase candidate pairs, pairs handed to the
// narrowphase, and narrow-phase pairs (unique body pairs in contact). Run it
// with the uniform grid at several cell sizes and with cannon-es's Naive and
// SAP broadphases as references.
//
// Expected: at ~60 bodies the grid isn't faster than the built-ins; it earns
// its keep at the 200-400 bodies fracture debris creates. The naive
// broadphase stays available as a switchable reference.
//
// Scenario contract: {name, setup, step, metrics, pass}. No Three.js.

import * as CANNON from 'cannon-es';
import { tuning } from '../../src/core/tuning.js';
import { PROP } from '../../src/core/groups.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { buildStaticGeometry, STATIC_BOXES, ROOM } from '../../src/collision/staticGeometry.js';
import { createSweptGuard } from '../../src/collision/sweptGuard.js';
import { narrowPairCount } from '../../src/collision/overlay.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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

function makeBroadphase(kind, cellSize) {
  if (kind === 'grid') return new UniformGridBroadphase({ cellSize });
  if (kind === 'naive') return new CANNON.NaiveBroadphase();
  if (kind === 'sap') return null; // SAP needs the world in its constructor
  throw new Error(`unknown broadphase ${kind}`);
}

/** Props the size of mugs, plates, books and debris. */
function randomProp(rand) {
  const k = rand();
  if (k < 0.35) return new CANNON.Box(new CANNON.Vec3(0.04 + rand() * 0.07, 0.012 + rand() * 0.03, 0.04 + rand() * 0.05)); // books, shards
  if (k < 0.7) return new CANNON.Cylinder(0.05 + rand() * 0.1, 0.05 + rand() * 0.1, 0.025 + rand() * 0.12, 10); // plates, mugs
  return new CANNON.Sphere(0.03 + rand() * 0.06);
}

/**
 * Free spawn slots on a jittered lattice, outside every static box.
 * @returns {{x,y,z}[]}
 */
function spawnSlots(rand, spacing = 0.3) {
  const slots = [];
  const clearance = 0.18;
  for (let x = ROOM.minX + 0.25; x < ROOM.maxX - 0.2; x += spacing) {
    for (let z = ROOM.minZ + 0.25; z < ROOM.maxZ - 0.2; z += spacing) {
      for (let y = 0.25; y < 2.4; y += spacing) {
        const p = { x: x + (rand() - 0.5) * 0.05, y, z: z + (rand() - 0.5) * 0.05 };
        const blocked = STATIC_BOXES.some((b) =>
          Math.abs(p.x - b.center[0]) < b.half[0] + clearance &&
          Math.abs(p.y - b.center[1]) < b.half[1] + clearance &&
          Math.abs(p.z - b.center[2]) < b.half[2] + clearance);
        if (!blocked) slots.push(p);
      }
    }
  }
  // Shuffle.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.bodies=400]
 * @param {'grid'|'naive'|'sap'} [opts.broadphase='grid']
 * @param {number} [opts.cellSize]       grid only; defaults to tuning
 * @param {boolean} [opts.allowSleep=true]
 * @param {boolean} [opts.guard=true]
 * @param {number} [opts.activeSteps=120]  steps measured while props fall and collide
 * @param {number} [opts.settleSteps=360]  steps before the "settled" window
 * @param {number} [opts.seed=400]
 */
export function createBroadphasePerfScenario(opts = {}) {
  const {
    bodies: count = 400, broadphase: kind = 'grid', cellSize = tuning.collision.grid.cellSize,
    allowSleep = true, guard: guardOn = true, activeSteps = 120, settleSteps = 360, seed = 400,
  } = opts;
  const settledSteps = activeSteps;
  const total = activeSteps + settleSteps + settledSteps;
  const dt = tuning.physics.fixedStep;

  let world, props, stepIndex, lastPairs, lastBroadphaseMs;
  const windows = { active: null, settled: null };
  const fresh = () => ({ steps: 0, ms: 0, bpMs: 0, maxMs: 0, candidates: 0, pairs: 0, narrow: 0, maxNarrow: 0, awake: 0 });

  const scenario = {
    name: `broadphase perf: ${count} bodies, ${kind}${kind === 'grid' ? ` @ ${cellSize} m` : ''}`,

    setup() {
      const rand = mulberry32(seed);
      world = new CANNON.World({ gravity: new CANNON.Vec3(0, tuning.physics.gravity, 0) });
      world.allowSleep = allowSleep;
      world.broadphase = kind === 'sap' ? new CANNON.SAPBroadphase(world) : makeBroadphase(kind, cellSize);
      world.broadphase.setWorld(world);
      // Count the pairs any broadphase hands to the narrowphase.
      const original = world.broadphase.collisionPairs.bind(world.broadphase);
      world.broadphase.collisionPairs = (w, p1, p2) => {
        const t = now();
        original(w, p1, p2);
        lastBroadphaseMs = now() - t;
        lastPairs = p1.length;
      };
      buildStaticGeometry(world);
      if (guardOn) createSweptGuard(world);

      const slots = spawnSlots(rand);
      if (slots.length < count) throw new Error(`only ${slots.length} spawn slots for ${count} bodies`);
      props = [];
      for (let i = 0; i < count; i++) {
        const shape = randomProp(rand);
        const b = new CANNON.Body({ mass: 0.1 + rand() * 0.4, shape, collisionFilterGroup: PROP, linearDamping: 0.05, angularDamping: 0.1 });
        b.position.set(slots[i].x, slots[i].y, slots[i].z);
        b.quaternion.setFromEuler(rand() * 6.28, rand() * 6.28, rand() * 6.28);
        b.velocity.set((rand() - 0.5) * 2, 0, (rand() - 0.5) * 2);
        b.aabbNeedsUpdate = true;
        b.sleepSpeedLimit = 0.1;
        b.sleepTimeLimit = 0.5;
        world.addBody(b);
        props.push(b);
      }
      stepIndex = 0;
      windows.active = fresh();
      windows.settled = fresh();
      return world;
    },

    step() {
      if (stepIndex >= total) return false;
      const t0 = now();
      world.step(dt);
      const ms = now() - t0;
      const w = stepIndex < activeSteps ? windows.active : stepIndex >= activeSteps + settleSteps ? windows.settled : null;
      if (w) {
        const narrow = narrowPairCount(world);
        w.steps++;
        w.ms += ms;
        w.bpMs += lastBroadphaseMs;
        w.maxMs = Math.max(w.maxMs, ms);
        w.candidates += world.broadphase.stats?.candidatePairs ?? lastPairs;
        w.pairs += lastPairs;
        w.narrow += narrow;
        w.maxNarrow = Math.max(w.maxNarrow, narrow);
        w.awake += props.reduce((n, b) => n + (b.sleepState !== CANNON.Body.SLEEPING ? 1 : 0), 0);
      }
      stepIndex++;
      return stepIndex < total;
    },

    metrics() {
      const avg = (w) => w && w.steps ? {
        stepMs: +(w.ms / w.steps).toFixed(3),
        broadphaseMs: +(w.bpMs / w.steps).toFixed(3),
        maxStepMs: +w.maxMs.toFixed(3),
        candidatePairs: Math.round(w.candidates / w.steps),
        broadphasePairs: Math.round(w.pairs / w.steps),
        narrowPairs: Math.round(w.narrow / w.steps),
        maxNarrowPairs: w.maxNarrow,
        awake: Math.round(w.awake / w.steps),
      } : null;
      const escaped = props.filter((b) => !(b.position.y > -0.2 && b.position.y < 3 &&
        b.position.x > ROOM.minX - 0.3 && b.position.x < ROOM.maxX + 1 && b.position.z > ROOM.minZ - 0.3 && b.position.z < ROOM.maxZ + 1)).length;
      return { bodies: count, broadphase: kind, cellSize: kind === 'grid' ? cellSize : null, active: avg(windows.active), settled: avg(windows.settled), escaped };
    },

    /** Pass: the simulation stayed sane. The numbers themselves are for tuning. */
    pass(m = scenario.metrics()) {
      return m.escaped === 0;
    },

    get world() { return world; },
  };
  return scenario;
}
