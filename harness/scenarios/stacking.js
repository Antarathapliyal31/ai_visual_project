// Stacking proof scenario (owner: B).
//
// Five plates stacked on the desk, sleeping disabled, 60 s. Pass when the
// deepest penetration stays under 2 mm and no plate drifts more than 5 mm.
//
// Why this is a real test: with sleeping on, a stack that jitters still looks
// still because the bodies are frozen. With sleeping off the solver has to
// hold all five plates every one of the 7,200 steps.
//
// Measured every step of the 60 s window, which opens at the first step
// after spawning (no settle period is needed; `settleSeconds` can add one):
//   penetration  the larger of (a) the solver's own contact depth for every
//                contact inside the stack and (b) the overlap of neighbouring
//                plates along the stack axis, plus the bottom plate into the desk
//   drift        the furthest any plate moves sideways from where it was when
//                the window opened (stricter than the stack centroid, which
//                is reported too)
//   tilt, speed  diagnostics for tuning
//
// Scenario contract (D's harness): {name, setup, step, metrics, pass}.
//   setup()   builds the world
//   step()    advances one fixed 1/120 s substep; returns false when finished
//   metrics() current numbers for the overlay / log
//   pass(m)   true when the proof criterion holds
// Runs headless (Vitest) and in the browser; no Three.js.

import { tuning as defaultTuning } from '../../src/core/tuning.js';
import { SURFACES } from '../../src/collision/index.js';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { stackHeights } from '../../src/physics/props.js';
import { SLICE_LAYOUT } from '../../src/physics/sliceScene.js';

export const STACK_LIMITS = { penetration: 0.002, drift: 0.005 }; // m

// Where the stack stands on A's desk (top face at SURFACES.deskTop): the
// same spot as in the slice scene.
export const STACK_SPOT = SLICE_LAYOUT.stack;

/**
 * @param {object} [opts]
 * @param {'plate'|'book'} [opts.kind='plate']
 * @param {number} [opts.count=5]
 * @param {number} [opts.seconds=60]        measured window
 * @param {number} [opts.settleSeconds=0]   optional settle before the window opens
 * @param {boolean} [opts.guard=true]       A's swept guard on or off (the numbers must match)
 * @param {boolean} [opts.allowSleep=false] the proof runs with sleeping off
 * @param {object} [opts.tuning]            tuning object to run with (defaults to core/tuning.js)
 */
export function createStackingScenario(opts = {}) {
  const {
    kind = 'plate', count = 5, seconds = 60, settleSeconds = 0,
    guard: guardOn = true, allowSleep = false, tuning = defaultTuning,
  } = opts;
  const dt = tuning.physics.fixedStep;
  const settleSteps = Math.round(settleSeconds / dt);
  const measureSteps = Math.round(seconds / dt);
  const surfaceY = SURFACES.deskTop;

  let physics, stack, halfHeight, stepIndex, start, m;

  const fresh = () => ({
    maxPenetration: 0, contactPenetration: 0, overlapPenetration: 0,
    maxDrift: 0, centroidDrift: 0, maxTilt: 0, maxSpeed: 0, settlePenetration: 0,
  });

  /** Deepest penetration right now: solver contacts and neighbour overlap. */
  function penetrationNow() {
    const inStack = new Set(stack.map((p) => p.body));
    let contact = 0;
    for (const c of physics.world.contacts) {
      // Stack-stack and stack-desk contacts only.
      if (!inStack.has(c.bi) && !inStack.has(c.bj)) continue;
      const gx = c.bj.position.x + c.rj.x - c.bi.position.x - c.ri.x;
      const gy = c.bj.position.y + c.rj.y - c.bi.position.y - c.ri.y;
      const gz = c.bj.position.z + c.rj.z - c.bi.position.z - c.ri.z;
      const depth = -(gx * c.ni.x + gy * c.ni.y + gz * c.ni.z);
      if (depth > contact) contact = depth;
    }
    let overlap = Math.max(0, surfaceY + halfHeight - stack[0].body.position.y);
    for (let i = 0; i + 1 < stack.length; i++) {
      const gap = stack[i + 1].body.position.y - stack[i].body.position.y;
      overlap = Math.max(overlap, 2 * halfHeight - gap);
    }
    return { contact, overlap };
  }

  function measure() {
    const pen = penetrationNow();
    if (stepIndex < settleSteps) {
      m.settlePenetration = Math.max(m.settlePenetration, pen.contact, pen.overlap);
      return;
    }
    m.contactPenetration = Math.max(m.contactPenetration, pen.contact);
    m.overlapPenetration = Math.max(m.overlapPenetration, pen.overlap);
    m.maxPenetration = Math.max(m.contactPenetration, m.overlapPenetration);

    let cx = 0, cz = 0;
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i].body;
      const dx = b.position.x - start.positions[i].x, dz = b.position.z - start.positions[i].z;
      m.maxDrift = Math.max(m.maxDrift, Math.hypot(dx, dz));
      cx += b.position.x; cz += b.position.z;
      // Tilt: angle between the body's up axis and world up.
      const q = b.quaternion;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      m.maxTilt = Math.max(m.maxTilt, Math.acos(Math.min(1, Math.max(-1, upY))));
      m.maxSpeed = Math.max(m.maxSpeed, b.velocity.length());
    }
    cx /= stack.length; cz /= stack.length;
    m.centroidDrift = Math.max(m.centroidDrift, Math.hypot(cx - start.cx, cz - start.cz));
  }

  const scenario = {
    name: `stacking: ${count} ${kind}s, ${seconds} s, sleeping ${allowSleep ? 'on' : 'off'}, guard ${guardOn ? 'on' : 'off'}`,

    setup() {
      physics = createPhysicsWorld({ tuning, guard: guardOn, allowSleep, fracture: false });
      halfHeight = kind === 'book' ? tuning.props.book.half[1] : tuning.props[kind].height / 2;
      stack = stackHeights(surfaceY, halfHeight, count).map((y) =>
        physics.spawn(kind, { position: [STACK_SPOT.x, y, STACK_SPOT.z] }));
      stepIndex = 0;
      start = null;
      m = fresh();
      return physics.world;
    },

    step() {
      if (stepIndex >= settleSteps + measureSteps) return false;
      if (stepIndex === settleSteps) {
        // The window opens: remember where every plate is.
        const positions = stack.map((p) => ({ x: p.body.position.x, z: p.body.position.z }));
        start = {
          positions,
          cx: positions.reduce((s, p) => s + p.x, 0) / positions.length,
          cz: positions.reduce((s, p) => s + p.z, 0) / positions.length,
        };
      }
      physics.step();
      measure();
      stepIndex++;
      return stepIndex < settleSteps + measureSteps;
    },

    metrics() {
      const mm = (v) => +(v * 1000).toFixed(4);
      return {
        kind, count,
        seconds: +(Math.max(0, stepIndex - settleSteps) * dt).toFixed(3),
        sleeping: allowSleep,
        guard: guardOn,
        maxPenetrationMm: mm(m.maxPenetration),
        contactPenetrationMm: mm(m.contactPenetration),
        overlapPenetrationMm: mm(m.overlapPenetration),
        maxDriftMm: mm(m.maxDrift),
        centroidDriftMm: mm(m.centroidDrift),
        maxTiltDeg: +((m.maxTilt * 180) / Math.PI).toFixed(4),
        maxSpeedMmPerS: mm(m.maxSpeed),
        settlePenetrationMm: mm(m.settlePenetration),
        guardClamps: physics.guard ? physics.guard.stats.clamps : 0,
      };
    },

    pass(r = scenario.metrics()) {
      return r.seconds >= seconds &&
        r.maxPenetrationMm < STACK_LIMITS.penetration * 1000 &&
        r.maxDriftMm < STACK_LIMITS.drift * 1000;
    },

    get world() { return physics.world; },
    get physics() { return physics; },
    get stack() { return stack; },
  };
  return scenario;
}

/** Run a scenario to completion (headless helper). */
export function runStackingScenario(scenario, maxSteps = 1e7) {
  scenario.setup();
  for (let i = 0; i < maxSteps && scenario.step(); i++);
  const r = scenario.metrics();
  return { ...r, pass: scenario.pass(r) };
}
