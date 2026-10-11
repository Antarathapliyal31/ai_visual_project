import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { UniformGridBroadphase, createSweptGuard, collisionDebugData, registerCollisionDebug, buildStaticGeometry } from '../../src/collision/index.js';

describe('overlay data', () => {
  it('reports cells, candidate and narrow-phase pairs', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const grid = new UniformGridBroadphase();
    world.broadphase = grid;
    buildStaticGeometry(world);
    const guard = createSweptGuard(world);
    for (let i = 0; i < 10; i++) {
      world.addBody(new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.05)), position: new CANNON.Vec3(0.2 * i - 1, 0.04, 1) }));
    }
    world.step(1 / 120);
    const { numbers, layers } = collisionDebugData({ world, broadphase: grid, guard });
    expect(numbers['occupied cells']).toBeGreaterThan(0);
    expect(numbers['narrow-phase pairs']).toBe(10); // each box on the floor
    expect(numbers['candidate pairs']).toBeGreaterThanOrEqual(numbers['broadphase pairs']);
    expect(layers.cells.length).toBe(numbers['occupied cells']);
    expect(layers.pairs).toHaveLength(10);
  });

  it('registers numbers, layers and tuning with debug.register()', () => {
    const world = new CANNON.World();
    const grid = new UniformGridBroadphase();
    world.broadphase = grid;
    const guard = createSweptGuard(world);
    let panel;
    registerCollisionDebug({ register: (p) => { panel = p; return p; } }, { world, broadphase: grid, guard });
    expect(panel.name).toBe('Collision');
    panel.tuning['grid cell size (m)'].set(0.75);
    expect(grid.cellSize).toBe(0.75);
    panel.tuning['swept guard'].set(false);
    expect(guard.enabled).toBe(false);
    expect(typeof panel.numbers()['candidate pairs']).toBe('number');
  });
});
