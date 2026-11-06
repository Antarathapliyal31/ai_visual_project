// Physics world wrapper (Workstream B).
//
// One cannon-es world set up from tuning.js: gravity, solver iterations,
// contact stiffness and relaxation, and the material table. It installs B's
// warm-started solver and A's grid broadphase and swept guard once, builds
// the static room with B's materials, and exposes one step().
//
// step() advances exactly one fixed substep and is the only place
// world.step() is called. D's loop owns time and decides how many substeps a
// frame gets; nobody else calls it.
//
//   beforeStep hooks  (cat controller: sets velocities the solver then corrects)
//   world.step(dt)
//   afterStep hooks   (D's impact harvester, AI)
//   fracture.flush()  (between steps, as A's fracture requires)
//
// Controllers must run *before* world.step(): cannon-es fires its own
// `preStep` event after the solver, so a velocity set there skips contact
// resolution for that step.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';
import {
  UniformGridBroadphase, createSweptGuard, createRaycaster, createFracture, buildStaticGeometry,
} from '../collision/index.js';
import { createMaterialTable } from './materials.js';
import { WarmGSSolver } from './solver.js';
import { buildProp, registerBreakable } from './props.js';

/**
 * @param {object} [opts]
 * @param {object} [opts.tuning]            defaults to core/tuning.js (read live)
 * @param {boolean | {boxes?: object[], occluders?: object[]}} [opts.room=true]
 *   build A's static room; pass specs to build other static geometry; false for an empty world
 * @param {'grid'|'naive'} [opts.broadphase='grid']
 * @param {boolean} [opts.guard=true]       install A's swept guard
 * @param {boolean} [opts.fracture=true]    create A's fracture and register plates and mugs on spawn
 * @param {boolean} [opts.allowSleep]       overrides tuning.physics.allowSleep
 * @param {(info: object) => void} [opts.onBroken]  called after a prop is swapped for its pieces
 */
export function createPhysicsWorld(opts = {}) {
  const tuning = opts.tuning ?? defaultTuning;
  const ph = tuning.physics;

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, ph.gravity, 0) });
  world.solver = new WarmGSSolver();
  world.broadphase = opts.broadphase === 'naive' ? new CANNON.NaiveBroadphase() : new UniformGridBroadphase();
  const materials = createMaterialTable(world, tuning);

  const room = opts.room ?? true;
  const staticGeometry = room === false
    ? null
    : buildStaticGeometry(world, { materialFor: materials.get, ...(room === true ? {} : room) });
  const guard = opts.guard === false ? null : createSweptGuard(world, { tuning: tuning.collision.guard });
  const raycast = createRaycaster(world);

  const props = [];   // live Prop records
  const debris = [];  // {kind: 'debris', debrisOf, body, visual, index, parentSerial} from broken props
  const beforeStep = [];
  const afterStep = [];
  let stepCount = 0;
  let serial = 0;

  const fracture = opts.fracture === false ? null : createFracture(world, {
    tuning: tuning.collision.fracture,
    onBroken(info) {
      const i = props.findIndex((p) => p.body === info.parent);
      const parent = i >= 0 ? props.splice(i, 1)[0] : null;
      // `index` is the piece's place in A's pre-cut (which half of the mug, which wedge of
      // the plate) and `parentSerial` the prop it came from: a renderer needs both to draw
      // the pieces as parts of that one object.
      info.pieces.forEach((piece, index) => {
        tuneSleep(piece.body);
        debris.push({ kind: 'debris', debrisOf: info.kind, body: piece.body, visual: piece.spec, index, parentSerial: parent ? parent.serial : null });
      });
      opts.onBroken?.(info);
    },
  });

  /** Props and debris sleep at the tuned thresholds, not cannon's defaults. */
  function tuneSleep(body) {
    body.sleepSpeedLimit = ph.sleepSpeedLimit;
    body.sleepTimeLimit = ph.sleepTimeLimit;
  }

  // opts.allowSleep is a choice made when the world is built (the stacking
  // proof runs with sleeping off). Once tuning.js's value changes, e.g. from
  // the overlay's toggle, the world follows tuning.js instead.
  let sleepOverride = opts.allowSleep;
  const sleepTunedAtStart = ph.allowSleep;

  /** Re-read tuning.js into the world. Call after the overlay changes a number. */
  function applyTuning() {
    world.gravity.set(0, ph.gravity, 0);
    world.solver.iterations = ph.solverIterations;
    world.solver.tolerance = ph.solverTolerance;
    world.solver.warmStart = ph.warmStart;
    world.solver.coulombFriction = ph.coulombFriction;
    world.solver.restitutionThreshold = ph.restitutionThreshold;
    world.solver.maxContactsPerPair = ph.maxContactsPerPair;
    if (sleepOverride !== undefined && ph.allowSleep !== sleepTunedAtStart) sleepOverride = undefined;
    world.allowSleep = sleepOverride ?? ph.allowSleep;
    materials.refresh();
    for (const p of props) tuneSleep(p.body);
    for (const d of debris) tuneSleep(d.body);
    if (!world.allowSleep) for (const b of world.bodies) if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
  }
  applyTuning();

  /** Advance one fixed substep. Only D's loop (and headless scenarios) call this. */
  function step() {
    const dt = ph.fixedStep;
    for (let i = 0; i < beforeStep.length; i++) beforeStep[i](dt);
    world.step(dt);
    stepCount++;
    for (let i = 0; i < afterStep.length; i++) afterStep[i](dt);
    // Bodies may only be swapped between steps (cannon's sleep loop crashes otherwise).
    fracture?.flush();
  }

  const hook = (list) => (fn) => {
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };

  /** Add an already built prop to the world. */
  function add(prop) {
    world.addBody(prop.body);
    // Its place in spawn order: the same in every run, unlike the body id.
    prop.serial = serial++;
    props.push(prop);
    if (fracture) registerBreakable(fracture, prop);
    return prop;
  }

  /** Build a prop from tuning.js and add it. */
  function spawn(kind, propOpts = {}) {
    return add(buildProp(kind, propOpts, { materials, tuning }));
  }

  /** Remove a prop or debris record (or its body) from the world. */
  function remove(item) {
    const body = item.body ?? item;
    for (const list of [props, debris]) {
      const i = list.findIndex((p) => p.body === body);
      if (i >= 0) list.splice(i, 1);
    }
    fracture?.unregister(body);
    if (world.bodies.includes(body)) world.removeBody(body);
  }

  return {
    world, tuning, materials, staticGeometry, guard, raycast, fracture,
    props, debris,
    step, applyTuning,
    /** Run fn(dt) before every world.step(); returns an unsubscribe function. */
    onBeforeStep: hook(beforeStep),
    /** Run fn(dt) after every world.step(), before fracture is flushed. */
    onAfterStep: hook(afterStep),
    add, spawn, remove,
    get dt() { return ph.fixedStep; },
    get stepCount() { return stepCount; },
    get time() { return world.time; },
  };
}
