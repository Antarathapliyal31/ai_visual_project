import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { rayVsAABB, rayVsBox, createRaycaster } from '../../src/collision/raycast.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { mulberry32, range } from '../helpers/rng.js';

const v = (x, y, z) => ({ x, y, z });

describe('rayVsAABB (slab test)', () => {
  const min = v(-1, -1, -1), max = v(1, 1, 1);
  it('hits the near face along an axis', () => {
    const h = rayVsAABB(v(-5, 0, 0), v(1, 0, 0), min, max);
    expect(h.t).toBeCloseTo(4);
    expect([h.axis, h.sign]).toEqual([0, -1]);
  });
  it('misses when parallel and outside a slab', () => {
    expect(rayVsAABB(v(-5, 2, 0), v(1, 0, 0), min, max)).toBeNull();
  });
  it('misses a box behind the ray', () => {
    expect(rayVsAABB(v(5, 0, 0), v(1, 0, 0), min, max)).toBeNull();
  });
  it('reports the exit face when the origin is inside', () => {
    const h = rayVsAABB(v(0, 0, 0), v(0, -1, 0), min, max);
    expect(h.t).toBeCloseTo(1);
    expect([h.axis, h.sign]).toEqual([1, -1]);
  });
  it('respects maxDist', () => {
    expect(rayVsAABB(v(-5, 0, 0), v(1, 0, 0), min, max, 3.9)).toBeNull();
    expect(rayVsAABB(v(-5, 0, 0), v(1, 0, 0), min, max, 4.1)).not.toBeNull();
  });
  it('hits diagonally', () => {
    const d = Math.SQRT1_2;
    const h = rayVsAABB(v(-3, -3, 0), v(d, d, 0), min, max);
    expect(h.t).toBeCloseTo(2 * Math.SQRT2);
  });
});

describe('rayVsBox (ray moved into the box frame)', () => {
  it('hits a box rotated 45 degrees about Y on its edge', () => {
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 4);
    const h = rayVsBox(v(-5, 0, 0), v(1, 0, 0), v(0, 0, 0), q, v(1, 1, 1));
    // The near edge is at x = -sqrt(2).
    expect(h.t).toBeCloseTo(5 - Math.SQRT2, 6);
    expect(Math.hypot(h.normal.x, h.normal.y, h.normal.z)).toBeCloseTo(1, 6);
    expect(h.normal.x).toBeLessThan(0);
  });
});

function randomRayScene(rand) {
  const world = new CANNON.World();
  const n = 5 + Math.floor(rand() * 25);
  for (let i = 0; i < n; i++) {
    const k = rand();
    const shape = k < 0.6
      ? new CANNON.Box(new CANNON.Vec3(range(rand, 0.02, 0.8), range(rand, 0.02, 0.8), range(rand, 0.02, 0.8)))
      : k < 0.85 ? new CANNON.Sphere(range(rand, 0.05, 0.6))
        : new CANNON.Cylinder(range(rand, 0.05, 0.4), range(rand, 0.05, 0.4), range(rand, 0.05, 0.6), 10);
    const isStatic = rand() < 0.4;
    const body = new CANNON.Body({
      mass: isStatic ? 0 : 1, type: isStatic ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC, shape,
      position: new CANNON.Vec3(range(rand, -4, 4), range(rand, -2, 2), range(rand, -4, 4)),
    });
    body.quaternion.setFromEuler(range(rand, 0, 6.28), range(rand, 0, 6.28), range(rand, 0, 6.28));
    // cannon-es doesn't flag the AABB when a quaternion is set directly; without
    // this its first raycast tests a stale, unrotated box.
    body.aabbNeedsUpdate = true;
    world.addBody(body);
  }
  return world;
}

describe('raycast() matches cannon-es raycastClosest', () => {
  it('agrees on 200 random scenes x 50 rays', () => {
    const rand = mulberry32(1234);
    let hits = 0, compared = 0;
    for (let s = 0; s < 200; s++) {
      const world = randomRayScene(rand);
      const grid = new UniformGridBroadphase({ cellSize: [0.25, 0.5, 1][s % 3] });
      const naive = new CANNON.NaiveBroadphase();
      const raycast = createRaycaster(world);
      for (let r = 0; r < 50; r++) {
        const o = new CANNON.Vec3(range(rand, -6, 6), range(rand, -3, 3), range(rand, -6, 6));
        // Half the rays are aimed at a body (with jitter) so plenty of them hit.
        const target = world.bodies[Math.floor(rand() * world.bodies.length)].position;
        const d = r % 2
          ? new CANNON.Vec3(range(rand, -1, 1), range(rand, -1, 1), range(rand, -1, 1))
          : target.vsub(o).vadd(new CANNON.Vec3(range(rand, -0.3, 0.3), range(rand, -0.3, 0.3), range(rand, -0.3, 0.3)));
        d.normalize();
        const maxDist = range(rand, 1, 15);

        world.broadphase = naive;
        const ref = new CANNON.RaycastResult();
        world.raycastClosest(o, o.vadd(d.scale(maxDist)), {}, ref);

        world.broadphase = grid;
        const got = raycast(o, d, maxDist);

        compared++;
        expect(got.hit, `scene ${s} ray ${r}`).toBe(ref.hasHit);
        if (!ref.hasHit) continue;
        hits++;
        expect(Math.abs(got.distance - ref.distance)).toBeLessThan(1e-6);
        // Same body unless two surfaces are hit at the same distance.
        if (got.body !== ref.body) {
          expect(Math.abs(got.distance - ref.distance)).toBeLessThan(1e-9);
        }
      }
    }
    expect(hits).toBeGreaterThan(compared * 0.25);
  });

  it('the grid walk finds the same hits as the aabbQuery fallback', () => {
    const rand = mulberry32(99);
    for (let s = 0; s < 50; s++) {
      const world = randomRayScene(rand);
      const raycast = createRaycaster(world);
      for (let r = 0; r < 40; r++) {
        const o = v(range(rand, -6, 6), range(rand, -3, 3), range(rand, -6, 6));
        const d = v(range(rand, -1, 1), range(rand, -1, 1), range(rand, -1, 1));
        world.broadphase = new CANNON.NaiveBroadphase();
        const a = raycast(o, d, 20);
        world.broadphase = new UniformGridBroadphase();
        const b = raycast(o, d, 20);
        expect(b.hit).toBe(a.hit);
        if (a.hit) expect(b.distance).toBeCloseTo(a.distance, 9);
      }
    }
  });
});

describe('raycast() masks and options', () => {
  const world = new CANNON.World();
  world.broadphase = new UniformGridBroadphase();
  const near = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.1, 1, 1)), position: new CANNON.Vec3(1, 0, 0), collisionFilterGroup: 2 });
  const far = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.1, 1, 1)), position: new CANNON.Vec3(3, 0, 0), collisionFilterGroup: 4 });
  // An occluder: never collides with anything, but blocks rays.
  const occluder = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.1, 1, 1)), position: new CANNON.Vec3(5, 0, 0), collisionFilterGroup: 8, collisionFilterMask: 0 });
  occluder.collisionResponse = false;
  world.addBody(near); world.addBody(far); world.addBody(occluder);
  const raycast = createRaycaster(world);
  const o = v(0, 0, 0), d = v(1, 0, 0);

  it('hits the closest body by default', () => {
    const h = raycast(o, d, 10);
    expect(h.body).toBe(near);
    expect(h.distance).toBeCloseTo(0.9);
    expect(h.point.x).toBeCloseTo(0.9);
    expect(h.normal.x).toBeCloseTo(-1);
  });
  it('filters by collision group', () => {
    expect(raycast(o, d, 10, 4).body).toBe(far);
    expect(raycast(o, d, 10, 1).hit).toBe(false);
  });
  it('can skip a body (e.g. the cat itself)', () => {
    expect(raycast(o, d, 10, -1, { skip: near }).body).toBe(far);
  });
  it('is blocked by occluders', () => {
    expect(raycast(o, d, 10, 8).body).toBe(occluder);
  });
  it('stops at maxDist', () => {
    expect(raycast(o, d, 0.5).hit).toBe(false);
  });
});
