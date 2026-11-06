import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { mulberry32, range } from '../helpers/rng.js';

function randomQuat(rand) {
  const q = new CANNON.Quaternion();
  q.setFromEuler(range(rand, 0, 6.28), range(rand, 0, 6.28), range(rand, 0, 6.28));
  return q;
}

/** A random scene: mixed shapes and sizes, some static, some sleeping, some filtered. */
export function randomScene(rand) {
  const world = new CANNON.World();
  const n = 2 + Math.floor(rand() * 59);
  for (let i = 0; i < n; i++) {
    const kind = rand();
    let shape;
    if (kind < 0.45) shape = new CANNON.Box(new CANNON.Vec3(range(rand, 0.02, 1.2), range(rand, 0.02, 1.2), range(rand, 0.02, 1.2)));
    else if (kind < 0.75) shape = new CANNON.Sphere(range(rand, 0.02, 0.9));
    else if (kind < 0.97) shape = new CANNON.Cylinder(range(rand, 0.03, 0.5), range(rand, 0.03, 0.5), range(rand, 0.02, 1.0), 8);
    else shape = new CANNON.Box(new CANNON.Vec3(range(rand, 3, 6), 0.05, range(rand, 3, 6))); // oversize
    const isStatic = rand() < 0.2;
    const body = new CANNON.Body({
      mass: isStatic ? 0 : range(rand, 0.1, 5),
      type: isStatic ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
      shape,
      position: new CANNON.Vec3(range(rand, -3, 3), range(rand, -3, 3), range(rand, -3, 3)),
    });
    body.quaternion.copy(randomQuat(rand));
    if (!isStatic && rand() < 0.1) body.sleepState = CANNON.Body.SLEEPING;
    if (rand() < 0.1) { body.collisionFilterGroup = 2; body.collisionFilterMask = ~2; }
    world.addBody(body);
  }
  if (rand() < 0.15) {
    const plane = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    plane.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    plane.position.y = range(rand, -3, 0);
    world.addBody(plane);
  }
  for (const b of world.bodies) b.updateAABB();
  return world;
}

const pairKeys = (p1, p2) => p1.map((a, i) => {
  const b = p2[i];
  return a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
});

describe('UniformGridBroadphase', () => {
  it('never misses a pair the naive broadphase finds (1,000 random scenes)', () => {
    const rand = mulberry32(549);
    let totalPairs = 0;
    for (let s = 0; s < 1000; s++) {
      const world = randomScene(rand);
      const naive = new CANNON.NaiveBroadphase();
      naive.useBoundingBoxes = true;
      const grid = new UniformGridBroadphase({ cellSize: [0.25, 0.5, 1.0][s % 3] });

      const n1 = [], n2 = [], g1 = [], g2 = [];
      naive.collisionPairs(world, n1, n2);
      grid.collisionPairs(world, g1, g2);

      const naiveSet = new Set(pairKeys(n1, n2));
      const gridKeys = pairKeys(g1, g2);
      const gridSet = new Set(gridKeys);
      // Unique output (owner-cell rule), and exactly the same set.
      expect(gridKeys.length).toBe(gridSet.size);
      for (const k of naiveSet) expect(gridSet.has(k), `scene ${s} missing ${k}`).toBe(true);
      expect(gridSet.size).toBe(naiveSet.size);
      totalPairs += naiveSet.size;
    }
    expect(totalPairs).toBeGreaterThan(1000); // the scenes actually had overlaps
  });

  it('aabbQuery returns exactly the bodies a brute-force scan finds', () => {
    const rand = mulberry32(7);
    for (let s = 0; s < 200; s++) {
      const world = randomScene(rand);
      const grid = new UniformGridBroadphase();
      world.broadphase = grid;
      for (let q = 0; q < 10; q++) {
        const aabb = new CANNON.AABB();
        const c = [range(rand, -3, 3), range(rand, -3, 3), range(rand, -3, 3)];
        const h = [range(rand, 0.01, 2), range(rand, 0.01, 2), range(rand, 0.01, 2)];
        aabb.lowerBound.set(c[0] - h[0], c[1] - h[1], c[2] - h[2]);
        aabb.upperBound.set(c[0] + h[0], c[1] + h[1], c[2] + h[2]);
        const got = grid.aabbQuery(world, aabb, []).map((b) => b.id).sort((a, b) => a - b);
        const want = world.bodies.filter((b) => b.aabb.overlaps(aabb)).map((b) => b.id).sort((a, b) => a - b);
        expect(got).toEqual(want);
      }
    }
  });

  it("keeps cannon-es's built-in raycasts working once plugged in", () => {
    const world = new CANNON.World();
    world.broadphase = new UniformGridBroadphase();
    const box = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), position: new CANNON.Vec3(3, 0, 0) });
    world.addBody(box);
    const result = new CANNON.RaycastResult();
    const hit = world.raycastClosest(new CANNON.Vec3(0, 0, 0), new CANNON.Vec3(10, 0, 0), {}, result);
    expect(hit).toBe(true);
    expect(result.body).toBe(box);
    expect(result.distance).toBeCloseTo(2.5, 6);
  });

  it('runs a real simulation: dynamic boxes land on a static floor', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.broadphase = new UniformGridBroadphase();
    world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(5, 0.05, 5)), position: new CANNON.Vec3(0, -0.05, 0) }));
    const boxes = [];
    for (let i = 0; i < 20; i++) {
      const b = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)), position: new CANNON.Vec3((i % 5) - 2, 0.5 + 0.3 * Math.floor(i / 5), 0) });
      world.addBody(b);
      boxes.push(b);
    }
    for (let i = 0; i < 360; i++) world.step(1 / 120);
    for (const b of boxes) expect(b.position.y).toBeGreaterThan(0.05);
  });
});
