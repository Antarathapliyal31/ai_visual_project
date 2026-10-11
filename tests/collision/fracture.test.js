import { describe, it, expect, vi, afterEach } from 'vitest';
import * as CANNON from 'cannon-es';
import { createFracture, makePrism, precut } from '../../src/collision/fracture.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { DEBRIS } from '../../src/core/groups.js';

const momentum = (bodies) => bodies.reduce((p, b) => p.vadd(b.velocity.scale(b.mass)), new CANNON.Vec3());
const plateBody = () => new CANNON.Body({ mass: 0.25, shape: new CANNON.Cylinder(0.18, 0.18, 0.025, 16), position: new CANNON.Vec3(0, 1, 0) });
const mugBody = () => new CANNON.Body({ mass: 0.3, shape: new CANNON.Cylinder(0.08, 0.07, 0.14, 12), position: new CANNON.Vec3(0, 1, 0) });

afterEach(() => vi.restoreAllMocks());

describe('pre-cut pieces', () => {
  it('builds convex wedges with outward faces (no cannon warnings)', () => {
    const warn = vi.spyOn(console, 'warn');
    const pieces = precut('plate', new CANNON.Cylinder(0.18, 0.18, 0.025, 16), 0.97);
    expect(pieces).toHaveLength(3);
    for (const p of pieces) {
      // Every face normal points away from the piece centre.
      const s = p.shape;
      s.faces.forEach((f, i) => {
        const fc = f.reduce((c, k) => c.vadd(s.vertices[k]), new CANNON.Vec3()).scale(1 / f.length);
        expect(s.faceNormals[i].dot(fc)).toBeGreaterThan(0);
      });
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives a mug 3 pieces and a plate 3 wedges, all within 2-4', () => {
    expect(precut('mug', new CANNON.Cylinder(0.08, 0.07, 0.14, 12), 0.97)).toHaveLength(3);
    expect(() => precut('vase', new CANNON.Cylinder(1, 1, 1, 8), 1)).toThrow();
  });

  it('makePrism makes a closed box from a square', () => {
    const p = makePrism([[-1, -1], [1, -1], [1, 1], [-1, 1]], 1);
    expect(p.faces).toHaveLength(6);
  });
});

describe('createFracture', () => {
  it('swaps a plate for 3 debris wedges, conserving mass and momentum', () => {
    const world = new CANNON.World();
    const plate = plateBody();
    plate.velocity.set(1, 2, -0.5);
    plate.angularVelocity.set(3, -1, 2);
    world.addBody(plate);
    const p0 = momentum([plate]);
    const broken = [];
    const fx = createFracture(world, { onBroken: (info) => broken.push(info) });
    fx.register(plate, { kind: 'plate', breakImpulse: 0.5 });

    fx.onImpact({ bodyA: plate, bodyB: null, impulse: 0.6 });
    fx.onImpact({ bodyA: null, bodyB: plate, impulse: 2.0 }); // same step: breaks once
    const results = fx.flush();

    expect(results).toHaveLength(1);
    expect(broken).toHaveLength(1);
    expect(world.bodies).not.toContain(plate);
    const pieces = broken[0].pieces.map((p) => p.body);
    expect(pieces).toHaveLength(3);
    expect(pieces.reduce((m, b) => m + b.mass, 0)).toBeCloseTo(0.25, 12);
    const p1 = momentum(pieces);
    expect(p1.vsub(p0).length()).toBeLessThan(1e-6);
    for (const b of pieces) {
      expect(b.angularVelocity.almostEquals(plate.angularVelocity, 1e-12)).toBe(true);
      expect(b.collisionFilterGroup).toBe(DEBRIS);
      expect(world.bodies).toContain(b);
    }
    // Pieces are not breakable again.
    expect(fx.flush()).toHaveLength(0);
  });

  it('gives each piece v + w x r', () => {
    const world = new CANNON.World();
    const mug = mugBody();
    mug.angularVelocity.set(0, 10, 0);
    world.addBody(mug);
    const fx = createFracture(world);
    fx.register(mug, { kind: 'mug', breakImpulse: 0.1 });
    fx.onImpact({ bodyA: mug, bodyB: null, impulse: 1 });
    const [info] = fx.flush();
    for (const { body } of info.pieces) {
      const r = body.position.vsub(mug.position);
      const want = mug.velocity.vadd(mug.angularVelocity.cross(r));
      expect(body.velocity.almostEquals(want, 1e-12)).toBe(true);
    }
  });

  it('conserves linear momentum for a mug without spin', () => {
    const world = new CANNON.World();
    const mug = mugBody();
    mug.velocity.set(-4, 1, 3);
    world.addBody(mug);
    const p0 = momentum([mug]);
    const fx = createFracture(world);
    fx.register(mug, { kind: 'mug' });
    fx.onImpact({ bodyA: mug, bodyB: null, impulse: 99 });
    const [info] = fx.flush();
    expect(momentum(info.pieces.map((p) => p.body)).vsub(p0).length()).toBeLessThan(1e-9);
  });

  it('ignores impacts below the break impulse and unregistered bodies', () => {
    const world = new CANNON.World();
    const plate = plateBody();
    const other = plateBody();
    world.addBody(plate);
    world.addBody(other);
    const fx = createFracture(world);
    fx.register(plate, { kind: 'plate', breakImpulse: 1 });
    fx.onImpact({ bodyA: plate, bodyB: other, impulse: 0.99 });
    expect(fx.flush()).toHaveLength(0);
    expect(world.bodies).toContain(plate);
    expect(world.bodies).toContain(other);
  });

  it('pieces settle on a floor without exploding (flush between steps)', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.broadphase = new UniformGridBroadphase();
    world.allowSleep = true;
    world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(2, 0.05, 2)), position: new CANNON.Vec3(0, -0.05, 0) }));
    const plate = plateBody();
    plate.position.set(0, 0.3, 0);
    world.addBody(plate);
    const fx = createFracture(world);
    fx.register(plate, { kind: 'plate', breakImpulse: 0.2 });
    // Fake the harvester: break on the first step with a big contact.
    let pieces = null;
    for (let i = 0; i < 240; i++) {
      world.step(1 / 120);
      if (!pieces && world.contacts.some((c) => c.bi === plate || c.bj === plate)) {
        fx.onImpact({ bodyA: plate, bodyB: null, impulse: 1 });
        pieces = fx.flush()[0].pieces.map((p) => p.body);
      }
    }
    expect(pieces).not.toBeNull();
    for (const b of pieces) {
      expect(b.position.y).toBeGreaterThan(0);
      expect(b.position.y).toBeLessThan(0.1);
      expect(b.velocity.length()).toBeLessThan(0.5);
    }
  });
});
