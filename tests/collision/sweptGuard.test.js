import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { sweepSphereVsBox, sweepSphereVsPlane, createSweptGuard, innerRadius } from '../../src/collision/sweptGuard.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { makeStaticBox } from '../../src/collision/staticGeometry.js';

const I = { x: 0, y: 0, z: 0, w: 1 };
const shelfHalf = { x: 1, y: 0.01, z: 0.3 };

describe('sweepSphereVsBox', () => {
  it('finds the first contact and flags a mid-plane crossing', () => {
    // Centre goes from 0.3 above to 0.1 below a 2 cm shelf.
    const h = sweepSphereVsBox({ x: 0, y: 0.3, z: 0 }, { x: 0, y: -1, z: 0 }, 0.4, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf);
    expect(h.inside).toBe(false);
    expect(h.t).toBeCloseTo(0.3 - 0.06, 9); // stops when the sphere touches the top face
    expect(h.normal.y).toBeCloseTo(1);
    expect(h.crossed).toBe(true);
  });
  it('misses when the path stays clear', () => {
    expect(sweepSphereVsBox({ x: 2, y: 0.3, z: 0 }, { x: 0, y: -1, z: 0 }, 0.4, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf)).toBeNull();
  });
  it('does not flag a grazing slide along the top face', () => {
    // Just above the expanded face, sliding sideways with a hint of downward motion.
    const d = { x: 1, y: -0.01, z: 0 }; // dips 0.25 mm into the expanded face over 2.5 cm
    const l = Math.hypot(d.x, d.y);
    const h = sweepSphereVsBox({ x: 0, y: 0.0601, z: 0 }, { x: d.x / l, y: d.y / l, z: 0 }, 0.025, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf);
    expect(h).not.toBeNull();
    expect(h.crossed).toBe(false);
    expect(h.deep).toBe(false);
  });
  it('reports a body already touching, and whether it crosses', () => {
    const resting = sweepSphereVsBox({ x: 0, y: 0.059, z: 0 }, { x: 1, y: 0, z: 0 }, 0.02, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf);
    expect(resting.inside).toBe(true);
    expect(resting.crossed).toBe(false);
    const through = sweepSphereVsBox({ x: 0, y: 0.059, z: 0 }, { x: 0, y: -1, z: 0 }, 0.1, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf);
    expect(through.inside).toBe(true);
    expect(through.crossed).toBe(true);
  });
  it('treats passing out the far side as crossing', () => {
    const h = sweepSphereVsBox({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -1, z: 0 }, 1.0, 0.05, { x: 0, y: 0, z: 0 }, I, shelfHalf);
    expect(h.crossed).toBe(true);
  });
});

describe('sweepSphereVsPlane', () => {
  const q = new CANNON.Quaternion();
  q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // floor facing +Y
  it('hits a floor plane and flags crossing below it', () => {
    const h = sweepSphereVsPlane({ x: 0, y: 0.2, z: 0 }, { x: 0, y: -1, z: 0 }, 0.3, 0.05, { x: 0, y: 0, z: 0 }, q);
    expect(h.t).toBeCloseTo(0.15, 9);
    expect(h.crossed).toBe(true);
  });
});

describe('innerRadius', () => {
  it('is the distance from the centre to the nearest face', () => {
    const b = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.2, 0.05, 0.1)) });
    expect(innerRadius(b)).toBeCloseTo(0.05);
  });
});

function shelfWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new UniformGridBroadphase();
  world.addBody(makeStaticBox({ id: 'shelf', center: [0, 1.4, 0], half: [1, 0.01, 0.3], material: 'wood', role: 'solid' }));
  return world;
}

describe('createSweptGuard', () => {
  it('keeps a 12 m/s mug above a 2 cm shelf and removes its inward velocity', () => {
    const world = shelfWorld();
    const guard = createSweptGuard(world);
    const mug = new CANNON.Body({ mass: 0.3, shape: new CANNON.Cylinder(0.08, 0.07, 0.14, 12), position: new CANNON.Vec3(0, 1.7, 0) });
    mug.velocity.set(0, -12, 0);
    world.addBody(mug);
    for (let i = 0; i < 60; i++) world.step(1 / 120);
    expect(guard.stats.clamps).toBeGreaterThan(0);
    expect(mug.position.y).toBeGreaterThan(1.41);
    expect(Math.abs(mug.velocity.y)).toBeLessThan(1);
  });

  it('never touches a slow body', () => {
    const world = shelfWorld();
    const guard = createSweptGuard(world);
    const box = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.05)), position: new CANNON.Vec3(0, 1.6, 0) });
    world.addBody(box);
    // Falls 0.14 m: ~1.7 m/s at contact, the guard checks it but sees no tunneling risk.
    for (let i = 0; i < 120; i++) world.step(1 / 120);
    expect(guard.stats.clamps).toBe(0);
    expect(box.position.y).toBeGreaterThan(1.41);
  });

  it('stops working once disposed', () => {
    const world = shelfWorld();
    const guard = createSweptGuard(world);
    guard.dispose();
    const mug = new CANNON.Body({ mass: 0.3, shape: new CANNON.Sphere(0.05), position: new CANNON.Vec3(0, 1.7, 0) });
    mug.velocity.set(0, -12, 0);
    world.addBody(mug);
    for (let i = 0; i < 30; i++) world.step(1 / 120);
    expect(guard.stats.checked).toBe(0);
  });
});

// Stand-in for B's stacking scenario until it lands: five plates on a desk
// top, sleeping off, 60 s. The guard must not change a single number.
function runStack(guardOn) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new UniformGridBroadphase();
  world.allowSleep = false;
  world.solver.iterations = 20;
  world.addBody(makeStaticBox({ id: 'desk', center: [0, 0.9, 0], half: [1.2, 0.04, 0.4], material: 'wood', role: 'solid' }));
  const guard = createSweptGuard(world);
  guard.enabled = guardOn;
  const plates = [];
  for (let i = 0; i < 5; i++) {
    const p = new CANNON.Body({ mass: 0.25, shape: new CANNON.Cylinder(0.18, 0.18, 0.025, 12), position: new CANNON.Vec3(0, 0.97 + i * 0.03, 0) });
    world.addBody(p);
    plates.push(p);
  }
  for (let i = 0; i < 7200; i++) world.step(1 / 120);
  return { positions: plates.map((p) => [p.position.x, p.position.y, p.position.z]), clamps: guard.stats.clamps };
}

describe('guard vs a resting stack', () => {
  it('gives identical stack numbers with the guard on and off', () => {
    const off = runStack(false);
    const on = runStack(true);
    expect(on.clamps).toBe(0);
    expect(on.positions).toEqual(off.positions);
  });
});
