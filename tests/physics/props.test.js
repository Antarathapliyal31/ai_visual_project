import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { buildProp, isBreakable, registerBreakable, stackHeights, PROP_KINDS, REST_GAP } from '../../src/physics/props.js';
import { createMaterialTable } from '../../src/physics/materials.js';
import { createFracture, SURFACES } from '../../src/collision/index.js';
import { PROP } from '../../src/core/groups.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';
import { expectIncludes } from '../helpers/same.js';

const ctx = () => ({ materials: createMaterialTable(new CANNON.World()), tuning });

describe('prop factories', () => {
  it('builds a plate as a low, coarse convex cylinder from tuning.js', () => {
    const d = tuning.props.plate;
    const p = buildProp('plate', {}, ctx());
    const s = p.body.shapes[0];
    expect(p.body.shapes).toHaveLength(1);
    expect(s).toBeInstanceOf(CANNON.Cylinder);
    expect(s.radiusTop).toBe(d.radius);
    expect(s.radiusBottom).toBe(d.radius);
    expect(s.height).toBe(d.height);
    expect(s.numSegments).toBe(d.segments);
    expect(d.segments).toBeGreaterThanOrEqual(8);
    expect(d.segments).toBeLessThanOrEqual(12); // coarse collider, round mesh
    expect(d.height).toBeLessThan(d.radius / 4); // low-sided
    expect(p.body.mass).toBe(d.mass);
    expect(p.halfHeight).toBe(d.height / 2);
  });

  it('builds the room-cluster kinds as single convex shapes from tuning.js', () => {
    const t = tuning.props;
    const lamp = buildProp('lamp', {}, ctx()), pot = buildProp('pot', {}, ctx());
    for (const [p, d] of [[lamp, t.lamp], [pot, t.pot]]) {
      expect(p.body.shapes).toHaveLength(1);
      expect(p.body.shapes[0]).toBeInstanceOf(CANNON.Cylinder);
      expect(p.body.shapes[0].radiusTop).toBe(d.radiusTop);
      expect(p.body.shapes[0].radiusBottom).toBe(d.radiusBottom);
      expect(p.halfHeight).toBe(d.height / 2);
      expect(p.body.mass).toBe(d.mass);
    }
    const pillow = buildProp('pillow', {}, ctx()), clock = buildProp('clock', {}, ctx());
    for (const [p, d] of [[pillow, t.pillow], [clock, t.clock]]) {
      expect(p.body.shapes[0]).toBeInstanceOf(CANNON.Box);
      expect(p.body.shapes[0].halfExtents.toArray()).toEqual(d.half);
      expect(p.halfHeight).toBe(d.half[1]);
    }
    expect(pillow.material).toBe('fabric');
    const ball = buildProp('ball', { tag: 'yarn' }, ctx());
    expect(ball.body.shapes[0]).toBeInstanceOf(CANNON.Sphere);
    expect(ball.body.shapes[0].radius).toBe(t.ball.sphere);
    expect(ball.halfHeight).toBe(t.ball.sphere);
    // A tag is a label for the renderer and nothing else.
    expect(ball.tag).toBe('yarn');
    expect(ball.body.userData.tag).toBe('yarn');
    expect(pillow.tag).toBeNull();
    // Only plates and mugs have pre-cut pieces: a ceramic pot is not handed to fracture.
    expect(pot.material).toBe('ceramic');
    expect(isBreakable(pot)).toBe(false);
    expect(isBreakable(lamp)).toBe(false);
  });

  it('builds a mug as a tapered cylinder and a book as a box', () => {
    const m = buildProp('mug', {}, ctx());
    expect(m.body.shapes[0]).toBeInstanceOf(CANNON.Cylinder);
    expect(m.body.shapes[0].radiusTop).toBe(tuning.props.mug.radiusTop);
    expect(m.body.shapes[0].radiusBottom).toBe(tuning.props.mug.radiusBottom);
    const b = buildProp('book', {}, ctx());
    expect(b.body.shapes[0]).toBeInstanceOf(CANNON.Box);
    expect(b.body.shapes[0].halfExtents.toArray()).toEqual(tuning.props.book.half);
  });

  it("makes each visual spec from its collider's own dimensions", () => {
    for (const kind of PROP_KINDS) {
      const p = buildProp(kind, {}, ctx());
      const s = p.body.shapes[0];
      if (p.visual.type === 'cylinder') {
        expect(p.visual).toEqual({ type: 'cylinder', radiusTop: s.radiusTop, radiusBottom: s.radiusBottom, height: s.height });
      } else if (p.visual.type === 'sphere') {
        expect(p.visual).toEqual({ type: 'sphere', radius: s.radius });
      } else {
        expect(p.visual).toEqual({ type: 'box', half: s.halfExtents.toArray() });
      }
    }
    // Still true when a prop is built with other dimensions.
    const big = buildProp('plate', { dims: { radius: 0.25, height: 0.04 } }, ctx());
    expect(big.visual).toEqual({ type: 'cylinder', radiusTop: 0.25, radiusBottom: 0.25, height: 0.04 });
    expect(big.body.shapes[0].radiusTop).toBe(0.25);
  });

  it('puts every prop in the PROP group with its table material and sleep limits', () => {
    const c = ctx();
    for (const kind of PROP_KINDS) {
      const p = buildProp(kind, {}, c);
      expect(p.body.collisionFilterGroup).toBe(PROP);
      expect(p.body.type).toBe(CANNON.Body.DYNAMIC);
      expect(p.body.material).toBe(c.materials.get(tuning.props[kind].material));
      expect(p.material).toBe(tuning.props[kind].material);
      expect(p.body.userData).toMatchObject({ kind, material: p.material, prop: true });
      expect(p.body.sleepSpeedLimit).toBe(tuning.physics.sleepSpeedLimit);
      expect(p.body.sleepTimeLimit).toBe(tuning.physics.sleepTimeLimit);
    }
  });

  it('takes break impulses from the material table: plates and mugs break, books never', () => {
    const plate = buildProp('plate', {}, ctx()), mug = buildProp('mug', {}, ctx()), book = buildProp('book', {}, ctx());
    expect(plate.breakImpulse).toBeCloseTo(0.7, 9);
    expect(mug.breakImpulse).toBeCloseTo(0.9, 9);
    expect(book.breakImpulse).toBe(Infinity);
    expect(isBreakable(plate)).toBe(true);
    expect(isBreakable(mug)).toBe(true);
    expect(isBreakable(book)).toBe(false);
  });

  it("registers breakables with A's fracture at the table's impulse", () => {
    const world = new CANNON.World();
    const fx = createFracture(world);
    const c = { materials: createMaterialTable(world), tuning };
    const plate = buildProp('plate', { position: [0, 1, 0] }, c);
    const book = buildProp('book', { position: [1, 1, 0] }, c);
    world.addBody(plate.body);
    world.addBody(book.body);
    expect(registerBreakable(fx, plate)).toBe(true);
    expect(registerBreakable(fx, book)).toBe(false);
    fx.onImpact({ bodyA: plate.body, bodyB: book.body, impulse: plate.breakImpulse - 0.01 });
    expect(fx.flush()).toHaveLength(0);
    fx.onImpact({ bodyA: plate.body, bodyB: book.body, impulse: plate.breakImpulse });
    expect(fx.flush()).toHaveLength(1);
    expectIncludes(world.bodies, plate.body, false);
    expectIncludes(world.bodies, book.body);
  });

  it('places a prop by its centre or resting on a surface point, with a fresh AABB', () => {
    const c = ctx();
    const a = buildProp('mug', { position: [1, 2, 3] }, c);
    expect(a.body.position.toArray()).toEqual([1, 2, 3]);
    const b = buildProp('mug', { base: [0.5, SURFACES.deskTop, -2.5], rotY: 1 }, c);
    expect(b.body.position.y).toBeCloseTo(SURFACES.deskTop + b.halfHeight + REST_GAP, 12);
    // README integration rule 2: the AABB follows a body moved by hand.
    expect(b.body.aabbNeedsUpdate).toBe(false);
    expect(b.body.aabb.lowerBound.y).toBeCloseTo(b.body.position.y - b.halfHeight, 9);
    expect(b.body.aabb.lowerBound.x).toBeLessThan(0.5);
    expect(b.body.aabb.upperBound.x).toBeGreaterThan(0.5);
  });

  it('throws for a kind it has no factory for', () => {
    expect(() => buildProp('vase', {}, ctx())).toThrow(/no prop factory/);
  });

  it('stacks heights so neighbours touch from the first step', () => {
    const ys = stackHeights(1, 0.0125, 5);
    expect(ys).toHaveLength(5);
    expect(ys[0]).toBeCloseTo(1 + 0.0125 + REST_GAP, 12);
    for (let i = 1; i < 5; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(0.025 + REST_GAP, 12);
    expect(REST_GAP).toBeLessThanOrEqual(0);
    expect(REST_GAP).toBeGreaterThan(-1e-4);
  });
});

describe('props at rest', () => {
  for (const kind of PROP_KINDS) {
    it(`a ${kind} placed on the desk stays put from the first step`, () => {
      const physics = createPhysicsWorld({ tuning: freshTuning(), allowSleep: false });
      const p = physics.spawn(kind, { base: [0.6, SURFACES.deskTop, -2.6] });
      const y0 = SURFACES.deskTop + p.halfHeight;
      let maxSpeed = 0, maxOff = 0;
      for (let i = 0; i < 240; i++) {
        physics.step();
        maxSpeed = Math.max(maxSpeed, p.body.velocity.length());
        maxOff = Math.max(maxOff, Math.abs(p.body.position.y - y0), Math.hypot(p.body.position.x - 0.6, p.body.position.z + 2.6));
      }
      expect(maxOff).toBeLessThan(0.0005);   // within half a millimetre of where it was put
      expect(maxSpeed).toBeLessThan(0.02);
    });
  }

  it('falls asleep within two seconds when sleeping is on', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    // A row along the open floor, 55 cm apart: inside the room however many kinds there are.
    const props = PROP_KINDS.map((kind, i) => physics.spawn(kind, { base: [-2.0 + (i % 10) * 0.55, SURFACES.floor, 1.5 + Math.floor(i / 10) * 0.7] }));
    for (let i = 0; i < 240; i++) physics.step();
    for (const p of props) expect(p.body.sleepState).toBe(CANNON.Body.SLEEPING);
  });
});
