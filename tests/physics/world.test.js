import { describe, it, expect, vi } from 'vitest';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { WarmGSSolver } from '../../src/physics/solver.js';
import { UniformGridBroadphase, STATIC_BOXES, OCCLUDERS, SURFACES } from '../../src/collision/index.js';
import { STATIC, DEBRIS } from '../../src/core/groups.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';
import { expectSameItems, expectIncludes } from '../helpers/same.js';

describe('createPhysicsWorld', () => {
  it('reads gravity, solver and contact numbers from tuning.js', () => {
    const t = freshTuning((x) => {
      x.physics.gravity = -5;
      x.physics.solverIterations = 13;
      x.physics.contactStiffness = 2e5;
      x.physics.contactRelaxation = 4;
      x.physics.warmStart = 0.5;
    });
    const { world } = createPhysicsWorld({ tuning: t });
    expect(world.gravity.toArray()).toEqual([0, -5, 0]);
    expect(world.solver).toBeInstanceOf(WarmGSSolver);
    expect(world.solver.iterations).toBe(13);
    expect(world.solver.warmStart).toBe(0.5);
    expect(world.solver.coulombFriction).toBe(t.physics.coulombFriction);
    expect(world.defaultContactMaterial.contactEquationStiffness).toBe(2e5);
    expect(world.defaultContactMaterial.contactEquationRelaxation).toBe(4);
    expect(world.allowSleep).toBe(t.physics.allowSleep);
  });

  it('applies live tuning changes with applyTuning()', () => {
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t });
    t.physics.solverIterations = 7;
    t.physics.gravity = -1;
    t.materials.ceramic.stiffness = 1e6;
    t.materialPairs['ceramic|wood'].friction = 0.9;
    physics.applyTuning();
    expect(physics.world.solver.iterations).toBe(7);
    expect(physics.world.gravity.y).toBe(-1);
    expect(physics.materials.contact('ceramic', 'wood').friction).toBe(0.9);
    expect(physics.materials.contact('ceramic', 'wood').contactEquationStiffness).toBe(1e6);
  });

  it("installs A's grid broadphase, swept guard and static room, once", () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const { world } = physics;
    expect(world.broadphase).toBeInstanceOf(UniformGridBroadphase);
    expect(physics.guard).toBeTruthy();
    expect(physics.guard.enabled).toBe(true);
    expect(world.bodies).toHaveLength(STATIC_BOXES.length + OCCLUDERS.length);
    expect(physics.staticGeometry.solids).toHaveLength(STATIC_BOXES.length);
    expect(physics.staticGeometry.occluders).toHaveLength(OCCLUDERS.length);
  });

  it("gives the static room B's materials, so furniture uses the pair table", () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    for (const spec of [...STATIC_BOXES, ...OCCLUDERS]) {
      const body = physics.staticGeometry.byId.get(spec.id);
      expect(body.material).toBe(physics.materials.get(spec.material));
      expect(body.collisionFilterGroup).toBe(STATIC);
    }
  });

  it('can build an empty world, other static geometry, or use the naive broadphase', () => {
    const empty = createPhysicsWorld({ tuning: freshTuning(), room: false, guard: false, fracture: false });
    expect(empty.world.bodies).toHaveLength(0);
    expect(empty.staticGeometry).toBeNull();
    expect(empty.guard).toBeNull();
    expect(empty.fracture).toBeNull();

    const slab = { id: 'slab', center: [0, -0.5, 0], half: [5, 0.5, 5], material: 'wood', role: 'solid' };
    const custom = createPhysicsWorld({ tuning: freshTuning(), room: { boxes: [slab], occluders: [] } });
    expect(custom.world.bodies).toHaveLength(1);
    expect(custom.staticGeometry.byId.get('slab')).toBeTruthy();

    const naive = createPhysicsWorld({ tuning: freshTuning(), broadphase: 'naive' });
    expect(naive.world.broadphase).toBeInstanceOf(CANNON.NaiveBroadphase);
  });

  it('step() advances exactly one fixed substep', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const spy = vi.spyOn(physics.world, 'step');
    physics.step();
    physics.step();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(tuning.physics.fixedStep);
    expect(physics.world.stepnumber).toBe(2);
    expect(physics.stepCount).toBe(2);
    expect(physics.time).toBeCloseTo(2 / 120, 12);
    expect(physics.dt).toBe(1 / 120);
  });

  it('runs hooks in order: before, world.step, after, then the fracture flush', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const order = [];
    const offBefore = physics.onBeforeStep((dt) => order.push(`before ${physics.world.stepnumber} ${dt}`));
    physics.onAfterStep(() => order.push(`after ${physics.world.stepnumber}`));
    const flush = vi.spyOn(physics.fracture, 'flush').mockImplementation(() => { order.push('flush'); return []; });
    physics.world.addEventListener('postStep', () => order.push('cannon postStep'));
    physics.step();
    expect(order).toEqual([`before 0 ${1 / 120}`, 'cannon postStep', 'after 1', 'flush']);
    offBefore();
    order.length = 0;
    physics.step();
    expect(order).toEqual(['cannon postStep', 'after 2', 'flush']);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('spawns props, tracks them, and removes them cleanly', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const n = physics.world.bodies.length;
    const mug = physics.spawn('mug', { base: [0.6, SURFACES.deskTop, -2.6] });
    const book = physics.spawn('book', { base: [1.0, SURFACES.deskTop, -2.6] });
    expectSameItems(physics.props, [mug, book], { ordered: true });
    expect([mug.serial, book.serial]).toEqual([0, 1]); // spawn order, for a renderer to seed looks with
    expect(physics.world.bodies).toHaveLength(n + 2);
    expect(physics.fracture.isBreakable(mug.body)).toBe(true);
    expect(physics.fracture.isBreakable(book.body)).toBe(false);
    physics.remove(mug);
    expectSameItems(physics.props, [book]);
    expectIncludes(physics.world.bodies, mug.body, false);
    expect(physics.fracture.isBreakable(mug.body)).toBe(false);
    physics.remove(book.body); // by body works too
    expect(physics.props).toHaveLength(0);
  });

  it('swaps a broken plate for debris between steps and updates its lists', () => {
    const broken = [];
    const physics = createPhysicsWorld({ tuning: freshTuning(), onBroken: (info) => broken.push(info) });
    const plate = physics.spawn('plate', { base: [0.6, SURFACES.deskTop, -2.6] });
    const mug = physics.spawn('mug', { base: [1.0, SURFACES.deskTop, -2.6] });
    // D's harvester would do this from an afterStep hook.
    physics.onAfterStep(() => {
      if (physics.stepCount === 3) {
        physics.fracture.onImpact({ bodyA: plate.body, bodyB: mug.body, impulse: 0.8 }); // over the plate's 0.7, under the mug's 0.9
      }
    });
    for (let i = 0; i < 2; i++) physics.step();
    expect(physics.props).toHaveLength(2);
    physics.step(); // impact arrives in the hook, flush runs after world.step() returned
    expect(broken).toHaveLength(1);
    expect(broken[0].kind).toBe('plate');
    expectSameItems(physics.props, [mug]);
    expect(physics.debris).toHaveLength(3);
    expect(physics.debris.map((d) => d.index)).toEqual([0, 1, 2]);
    for (const d of physics.debris) {
      expect(d.parentSerial).toBe(plate.serial);
      expect(d.debrisOf).toBe('plate');
      expect(d.body.collisionFilterGroup).toBe(DEBRIS);
      expect(d.body.material).toBe(physics.materials.get('ceramic'));
      expect(d.visual.type).toBe('prism');
      expectIncludes(physics.world.bodies, d.body);
    }
    // The world keeps stepping with the pieces in it.
    expect(() => { for (let i = 0; i < 120; i++) physics.step(); }).not.toThrow();
    for (const d of physics.debris) expect(d.body.position.y).toBeGreaterThan(SURFACES.deskTop - 0.01);
  });

  it('wakes everything when sleeping is switched off', () => {
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t });
    const mug = physics.spawn('mug', { base: [0.6, SURFACES.deskTop, -2.6] });
    for (let i = 0; i < 240; i++) physics.step();
    expect(mug.body.sleepState).toBe(CANNON.Body.SLEEPING);
    t.physics.allowSleep = false;
    physics.applyTuning();
    expect(mug.body.sleepState).toBe(CANNON.Body.AWAKE);
  });

  // Code review, Oct 22: the toggle did nothing on a world built with allowSleep.
  it('lets the sleep toggle work on a world built with its own allowSleep', () => {
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t, allowSleep: false });
    expect(physics.world.allowSleep).toBe(false);
    physics.applyTuning(); // another number changed: the creation-time choice stays
    expect(physics.world.allowSleep).toBe(false);
    t.physics.allowSleep = false;
    physics.applyTuning();
    expect(physics.world.allowSleep).toBe(false);
    t.physics.allowSleep = true; // the overlay switches it back on
    physics.applyTuning();
    expect(physics.world.allowSleep).toBe(true);
  });

  // Code review, Oct 22: fracture pieces kept cannon's default sleep limits.
  it('gives debris the tuned sleep limits, when it is made and when tuning changes', () => {
    const t = freshTuning((x) => { x.physics.sleepSpeedLimit = 0.03; x.physics.sleepTimeLimit = 0.6; });
    const physics = createPhysicsWorld({ tuning: t });
    const plate = physics.spawn('plate', { base: [0.6, SURFACES.deskTop, -2.6] });
    physics.onAfterStep(() => { if (physics.stepCount === 2) physics.fracture.onImpact({ bodyA: plate.body, bodyB: null, impulse: 5 }); });
    for (let i = 0; i < 3; i++) physics.step();
    expect(physics.debris).toHaveLength(3);
    for (const d of physics.debris) {
      expect(d.body.sleepSpeedLimit).toBe(0.03);
      expect(d.body.sleepTimeLimit).toBe(0.6);
    }
    t.physics.sleepSpeedLimit = 0.08;
    physics.applyTuning();
    for (const d of physics.debris) expect(d.body.sleepSpeedLimit).toBe(0.08);
  });
});
