// Physics numbers and tuning for D's debug overlay (Workstream B).
//
// Pure data, no Three.js. Same shape A's collision panel assumes for
// debug.register() (D, ships Oct 12):
//   debug.register({ name, numbers: () => ({...}), layers: () => ({...}), tuning: {...} })
// Adjust registerPhysicsDebug() if D's final signature differs.
//
// Every tuning entry writes tuning.js and calls physics.applyTuning(), so the
// stack can be tuned while it runs.

import * as CANNON from 'cannon-es';

/** @param {ReturnType<import('./world.js').createPhysicsWorld>} physics */
export function physicsDebugData(physics) {
  const { world } = physics;
  let dynamic = 0, awake = 0;
  for (const b of world.bodies) {
    if (b.type !== CANNON.Body.DYNAMIC) continue;
    dynamic++;
    if (b.sleepState !== CANNON.Body.SLEEPING) awake++;
  }
  const s = world.solver.stats ?? {};
  const numbers = {
    'dynamic bodies': dynamic,
    'awake bodies': awake,
    'props': physics.props.length,
    'debris': physics.debris.length,
    'contacts': world.contacts.length,
    'solver equations': s.equations ?? world.contacts.length + world.frictionEquations.length,
    'equations dropped': s.dropped ?? 0,
    'warm-started contacts': s.warmStarted ?? 0,
    'solver passes used': s.iterations ?? world.solver.iterations,
  };
  const layers = {
    // One point and normal per contact, for the overlay's contact dots.
    contacts: world.contacts.map((c) => ({
      point: [c.bi.position.x + c.ri.x, c.bi.position.y + c.ri.y, c.bi.position.z + c.ri.z],
      normal: [c.ni.x, c.ni.y, c.ni.z],
    })),
  };
  return { numbers, layers };
}

/** Register the physics panel with D's overlay. */
export function registerPhysicsDebug(debug, physics) {
  const ph = physics.tuning.physics;
  const pairs = physics.tuning.materialPairs;
  const entry = (obj, key, range = {}) => ({
    get: () => obj[key],
    set: (v) => { obj[key] = v; physics.applyTuning(); },
    ...range,
  });
  return debug.register({
    name: 'Physics',
    numbers: () => physicsDebugData(physics).numbers,
    layers: () => physicsDebugData(physics).layers,
    tuning: {
      'solver iterations': entry(ph, 'solverIterations', { min: 1, max: 80, step: 1 }),
      'warm start': entry(ph, 'warmStart', { min: 0, max: 1, step: 0.05 }),
      'coulomb friction': entry(ph, 'coulombFriction'),
      'restitution threshold (m/s)': entry(ph, 'restitutionThreshold', { min: 0, max: 2, step: 0.05 }),
      'max contacts per pair': entry(ph, 'maxContactsPerPair', { min: 0, max: 12, step: 1 }),
      'ceramic stiffness (N/m)': entry(physics.tuning.materials.ceramic, 'stiffness', { min: 1e3, max: 1e7, step: 1e3 }),
      'contact relaxation (steps)': entry(ph, 'contactRelaxation', { min: 1, max: 10, step: 0.5 }),
      'friction ceramic|ceramic': entry(pairs['ceramic|ceramic'], 'friction', { min: 0, max: 1.5, step: 0.05 }),
      'friction ceramic|wood': entry(pairs['ceramic|wood'], 'friction', { min: 0, max: 1.5, step: 0.05 }),
      'body sleeping': entry(ph, 'allowSleep'),
      'sleep speed (m/s)': entry(ph, 'sleepSpeedLimit', { min: 0.005, max: 0.5, step: 0.005 }),
      'sleep time (s)': entry(ph, 'sleepTimeLimit', { min: 0.1, max: 3, step: 0.1 }),
      // Read when a plate is built: respawn the stack to see a change.
      'plate sides (respawn)': { get: () => physics.tuning.props.plate.segments, set: (v) => { physics.tuning.props.plate.segments = v; }, min: 6, max: 24, step: 1 },
    },
  });
}
