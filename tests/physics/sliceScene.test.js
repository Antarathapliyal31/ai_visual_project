import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { spawnSliceScene, SLICE_LAYOUT } from '../../src/physics/sliceScene.js';
import { physicsDebugData, registerPhysicsDebug } from '../../src/physics/overlay.js';
import { createCat } from '../../src/player/cat.js';
import { SURFACES, STATIC_BOXES } from '../../src/collision/index.js';
import { freshTuning } from '../helpers/tuning.js';
import { expectSameItems } from '../helpers/same.js';

const desk = STATIC_BOXES.find((b) => b.id === 'deskTop');
const onDesk = (p) =>
  Math.abs(p.x - desk.center[0]) < desk.half[0] && Math.abs(p.z - desk.center[2]) < desk.half[2] && p.y > SURFACES.deskTop;

describe('slice scene', () => {
  it("is five plates, two mugs and a book on A's desk", () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const scene = spawnSliceScene(physics);
    expect(scene.plates).toHaveLength(5);
    expect(scene.mugs).toHaveLength(2);
    expect(scene.book.kind).toBe('book');
    expect(scene.all).toHaveLength(8);
    expectSameItems(physics.props, scene.all, { ordered: true });
    for (const p of scene.all) expect(onDesk(p.body.position)).toBe(true);
    // The plates are one stack, bottom to top.
    for (let i = 0; i < 5; i++) {
      expect(scene.plates[i].body.position.x).toBe(SLICE_LAYOUT.stack.x);
      expect(scene.plates[i].body.position.z).toBe(SLICE_LAYOUT.stack.z);
      if (i) expect(scene.plates[i].body.position.y).toBeGreaterThan(scene.plates[i - 1].body.position.y);
    }
  });

  it('spawns nothing overlapping anything else', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const scene = spawnSliceScene(physics);
    const footprint = (p) => (p.kind === 'book' ? Math.hypot(...physics.tuning.props.book.half) : p.kind === 'mug' ? 0.08 : 0.18);
    const groups = [scene.plates[0], ...scene.mugs, scene.book]; // the stack counts once
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i].body.position, b = groups[j].body.position;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(footprint(groups[i]) + footprint(groups[j]));
      }
    }
  });

  it('sits still from the first step with sleeping off: nothing moves a millimetre in 10 s', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning(), allowSleep: false });
    const scene = spawnSliceScene(physics);
    const start = scene.all.map((p) => p.body.position.clone());
    let moved = 0, speed = 0;
    for (let i = 0; i < 1200; i++) {
      physics.step();
      scene.all.forEach((p, k) => {
        moved = Math.max(moved, p.body.position.distanceTo(start[k]));
        speed = Math.max(speed, p.body.velocity.length());
      });
    }
    expect(moved).toBeLessThan(0.001);
    expect(speed).toBeLessThan(0.05);
    expect(physics.guard.stats.clamps).toBe(0);
    expect(physics.debris).toHaveLength(0);
  });

  it('falls asleep within two seconds with sleeping on, so it costs nothing at rest', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const scene = spawnSliceScene(physics);
    for (let i = 0; i < 240; i++) physics.step();
    for (const p of scene.all) expect(p.body.sleepState).toBe(CANNON.Body.SLEEPING);
    expect(physicsDebugData(physics).numbers['awake bodies']).toBe(0);
  });

  it('wakes up and scatters when the cat swats the stack', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const scene = spawnSliceScene(physics);
    for (let i = 0; i < 240; i++) physics.step();
    // The cat stands on the desk beside the stack, facing it.
    const r = physics.tuning.cat.radius;
    const cat = createCat(physics, { position: [SLICE_LAYOUT.stack.x + 0.6, SURFACES.deskTop + r + 0.001, SLICE_LAYOUT.stack.z], heading: Math.PI });
    for (let i = 0; i < 30; i++) physics.step();
    const hits = cat.swat();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(physics.tuning.swat.maxTargets);
    for (const h of hits) expect(h.body.sleepState).toBe(CANNON.Body.AWAKE);
    for (let i = 0; i < 240; i++) physics.step();
    const off = scene.plates.filter((p) => !onDesk(p.body.position) || Math.abs(p.body.position.x - SLICE_LAYOUT.stack.x) > 0.1);
    expect(off.length).toBeGreaterThan(0); // plates left the stack
    for (const p of physics.props) expect(p.body.position.y).toBeGreaterThan(-0.01); // nothing through the floor
  });
});

describe('physics overlay data', () => {
  it('reports the numbers and contact points D draws', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning(), allowSleep: false });
    spawnSliceScene(physics);
    for (let i = 0; i < 10; i++) physics.step();
    const { numbers, layers } = physicsDebugData(physics);
    expect(numbers['dynamic bodies']).toBe(8);
    expect(numbers['awake bodies']).toBe(8);
    expect(numbers.props).toBe(8);
    expect(numbers.contacts).toBe(physics.world.contacts.length);
    expect(numbers['warm-started contacts']).toBeGreaterThan(0);
    expect(numbers['solver equations']).toBeGreaterThan(0);
    expect(layers.contacts).toHaveLength(physics.world.contacts.length);
    for (const c of layers.contacts) {
      expect(c.point[1]).toBeGreaterThan(SURFACES.deskTop - 0.01);
      expect(Math.hypot(...c.normal)).toBeCloseTo(1, 6);
    }
  });

  it('registers a panel whose tuning entries change the running world', () => {
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t });
    let panel;
    const debug = { register: (p) => { panel = p; return p; } };
    registerPhysicsDebug(debug, physics);
    expect(panel.name).toBe('Physics');
    expect(panel.numbers()).toHaveProperty('contacts');
    expect(panel.layers()).toHaveProperty('contacts');

    panel.tuning['solver iterations'].set(11);
    expect(t.physics.solverIterations).toBe(11);
    expect(physics.world.solver.iterations).toBe(11);
    expect(panel.tuning['solver iterations'].get()).toBe(11);

    panel.tuning['ceramic stiffness (N/m)'].set(2e5);
    expect(physics.materials.contact('ceramic', 'ceramic').contactEquationStiffness).toBe(2e5);
    panel.tuning['friction ceramic|wood'].set(0.3);
    expect(physics.materials.contact('ceramic', 'wood').friction).toBe(0.3);
    panel.tuning['warm start'].set(0);
    expect(physics.world.solver.warmStart).toBe(0);
    panel.tuning['body sleeping'].set(false);
    expect(physics.world.allowSleep).toBe(false);
    panel.tuning['plate sides (respawn)'].set(8);
    expect(physics.spawn('plate', { position: [0, 2, 0] }).body.shapes[0].numSegments).toBe(8);
  });
});
