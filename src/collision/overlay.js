// Collision numbers and drawing layers for D's debug overlay (Workstream A).
//
// Pure data, no Three.js: D's overlay turns the layers into line boxes and
// segments. Shapes assumed for debug.register() (D, ships Oct 12):
//   debug.register({ name, numbers: () => ({...}), layers: () => ({...}), tuning: {...} })
// Adjust registerCollisionDebug() if D's final signature differs.

/** Unique body pairs among the narrowphase contacts this step. */
export function narrowPairCount(world) {
  const seen = new Set();
  for (const c of world.contacts) {
    const a = c.bi.id, b = c.bj.id;
    seen.add(a < b ? a * 1e6 + b : b * 1e6 + a);
  }
  return seen.size;
}

/**
 * @param {{world: import('cannon-es').World, broadphase?: import('./gridBroadphase.js').UniformGridBroadphase, guard?: object}} deps
 */
export function collisionDebugData({ world, broadphase, guard }) {
  const bp = broadphase ?? world.broadphase;
  const s = bp.stats ?? {};
  const numbers = {
    'grid cell (m)': bp.cellSize,
    'occupied cells': s.occupiedCells,
    'candidate pairs': s.candidatePairs,
    'broadphase pairs': s.pairs,
    'narrow-phase pairs': narrowPairCount(world),
    'broadphase ms': s.lastStepMs,
  };
  if (guard) {
    numbers['guard checked'] = guard.stats.checked;
    numbers['guard clamps'] = guard.stats.clamps;
  }

  const layers = {
    cells: typeof bp.occupiedCellBounds === 'function' ? bp.occupiedCellBounds('dynamic') : [],
    // One segment per narrow-phase pair, centre to centre.
    pairs: [...new Map(world.contacts.map((c) => [`${c.bi.id}-${c.bj.id}`, c])).values()].map((c) => [
      [c.bi.position.x, c.bi.position.y, c.bi.position.z],
      [c.bj.position.x, c.bj.position.y, c.bj.position.z],
    ]),
    lastClamp: guard?.stats.lastClamp ?? null,
  };
  return { numbers, layers };
}

/** Register the collision panel with D's overlay. */
export function registerCollisionDebug(debug, deps) {
  const { broadphase, guard } = deps;
  return debug.register({
    name: 'Collision',
    numbers: () => collisionDebugData(deps).numbers,
    layers: () => collisionDebugData(deps).layers,
    tuning: {
      'grid cell size (m)': {
        get: () => broadphase.cellSize, set: (v) => broadphase.setCellSize(v), min: 0.1, max: 2, step: 0.05,
      },
      ...(guard && {
        'swept guard': { get: () => guard.enabled, set: (v) => { guard.enabled = v; } },
        'guard gate (m/substep)': { get: () => guard.minDisplacement, set: (v) => { guard.minDisplacement = v; }, min: 0.001, max: 0.05, step: 0.001 },
      }),
    },
  });
}
