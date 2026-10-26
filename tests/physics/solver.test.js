// B's contact solver: warm starting and Coulomb friction on top of cannon-es's
// Gauss-Seidel pass.
import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { WarmGSSolver } from '../../src/physics/solver.js';
import { mulberry32, range } from '../helpers/rng.js';

const G = 9.82;

/** A body resting on a big static slab, with one material pair. */
function restingWorld({ mu = 0.5, restitution = 0, solver, hz = 120, shape = 'box', mass = 0.4, stiffness = 3e4 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
  if (solver) world.solver = solver;
  world.solver.iterations = 20;
  const a = new CANNON.Material('a'), b = new CANNON.Material('b');
  world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction: mu, restitution, contactEquationStiffness: stiffness }));
  world.addBody(new CANNON.Body({ mass: 0, material: b, shape: new CANNON.Box(new CANNON.Vec3(50, 0.5, 50)), position: new CANNON.Vec3(0, -0.5, 0) }));
  const shapes = {
    box: [new CANNON.Box(new CANNON.Vec3(0.11, 0.025, 0.08)), 0.025],
    plate: [new CANNON.Cylinder(0.18, 0.18, 0.025, 12), 0.0125],
    mug: [new CANNON.Cylinder(0.08, 0.07, 0.14, 12), 0.07],
    sphere: [new CANNON.Sphere(0.05), 0.05],
  };
  const [s, halfHeight] = shapes[shape];
  const body = new CANNON.Body({ mass, material: a, shape: s, position: new CANNON.Vec3(0, halfHeight, 0), fixedRotation: shape === 'sphere' });
  world.addBody(body);
  const dt = 1 / hz;
  const settle = () => { for (let i = 0; i < hz / 2; i++) world.step(dt); };
  return { world, body, halfHeight, dt, hz, settle };
}

/** Push sideways through the contact plane (no tipping moment) for one second; metres moved. */
function pushFor1s(w, pushInWeights) {
  const F = new CANNON.Vec3(), at = new CANNON.Vec3(0, -w.halfHeight, 0);
  const x0 = w.body.position.x;
  for (let i = 0; i < w.hz; i++) {
    F.set(pushInWeights * w.body.mass * G, 0, 0);
    w.body.applyForce(F, at);
    w.world.step(w.dt);
  }
  return w.body.position.x - x0;
}

describe('WarmGSSolver vs the stock solver', () => {
  it('is step for step the stock GSSolver with every feature switched off', () => {
    const run = (solver) => {
      const rand = mulberry32(7);
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
      if (solver) world.solver = solver;
      world.solver.iterations = 10;
      world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(5, 0.5, 5)), position: new CANNON.Vec3(0, -0.5, 0) }));
      const bodies = [];
      for (let i = 0; i < 12; i++) {
        const shape = i % 3 === 0 ? new CANNON.Sphere(0.08) : i % 3 === 1 ? new CANNON.Box(new CANNON.Vec3(0.1, 0.05, 0.07)) : new CANNON.Cylinder(0.1, 0.1, 0.06, 8);
        const b = new CANNON.Body({ mass: range(rand, 0.2, 1), shape, position: new CANNON.Vec3(range(rand, -0.3, 0.3), 0.3 + i * 0.25, range(rand, -0.3, 0.3)) });
        b.quaternion.setFromEuler(range(rand, 0, 6), range(rand, 0, 6), range(rand, 0, 6));
        b.angularVelocity.set(range(rand, -3, 3), range(rand, -3, 3), range(rand, -3, 3));
        world.addBody(b);
        bodies.push(b);
      }
      for (let i = 0; i < 360; i++) world.step(1 / 120);
      return bodies.map((b) => [...b.position.toArray(), ...b.quaternion.toArray()]);
    };
    const stock = run(null);
    const off = run(new WarmGSSolver({ iterations: 10, warmStart: 0, coulombFriction: false, restitutionThreshold: 0, maxContactsPerPair: 0 }));
    expect(off).toEqual(stock);
  });

  it('documents the stock problem: cannon-es friction holds against 50 times the weight', () => {
    // mu * g * mass is applied to the per-step impulse, so at 120 Hz friction
    // is 120 times too strong. This is why the solver was replaced.
    const w = restingWorld({ mu: 0.5, shape: 'sphere' });
    w.settle();
    expect(pushFor1s(w, 50)).toBeLessThan(0.01);
  });
});

describe('Coulomb friction', () => {
  for (const shape of ['box', 'plate', 'mug', 'sphere']) {
    for (const mu of [0.2, 0.5, 0.7]) {
      it(`a ${shape} with mu ${mu} holds below mu*m*g and slides above it`, () => {
        const below = restingWorld({ mu, shape, solver: new WarmGSSolver() });
        below.settle();
        expect(pushFor1s(below, mu * 0.9)).toBeLessThan(0.002);

        const above = restingWorld({ mu, shape, solver: new WarmGSSolver() });
        above.settle();
        const push = mu * 1.5;
        // Net force (push - mu) m g for one second.
        expect(pushFor1s(above, push)).toBeCloseTo(((push - mu) * G) / 2, 1);
      });
    }
  }

  it('does not depend on the step rate or the mass', () => {
    for (const o of [{ hz: 60 }, { hz: 240 }, { mass: 4 }, { mass: 0.05 }]) {
      const w = restingWorld({ mu: 0.5, solver: new WarmGSSolver(), ...o });
      w.settle();
      expect(pushFor1s(w, 0.45)).toBeLessThan(0.002);
      expect(pushFor1s(w, 0.75)).toBeGreaterThan(0.5);
    }
  });

  for (const mu of [0.2, 0.5, 0.7]) {
    it(`a box sliding at 3 m/s with mu ${mu} stops after v^2 / (2 mu g)`, () => {
      const w = restingWorld({ mu, solver: new WarmGSSolver() });
      w.settle();
      w.body.velocity.x = 3;
      for (let i = 0; i < 600; i++) w.world.step(w.dt);
      const expected = 9 / (2 * mu * G);
      expect(Math.abs(w.body.position.x - expected) / expected).toBeLessThan(0.05);
      expect(w.body.velocity.length()).toBeLessThan(0.01);
      expect(w.body.position.y).toBeCloseTo(w.halfHeight, 3); // slid flat, didn't tumble
    });
  }

  it('gives a frictionless pair no grip at all', () => {
    const w = restingWorld({ mu: 0, solver: new WarmGSSolver() });
    w.settle();
    w.body.linearDamping = 0; // cannon-es bodies default to 1 % per second
    w.body.velocity.x = 1;
    for (let i = 0; i < 120; i++) w.world.step(w.dt);
    expect(w.body.position.x).toBeCloseTo(1, 6);
  });
});

describe('contact impulses', () => {
  it("a resting body's contact impulses add up to its weight (what D's harvester reads)", () => {
    for (const shape of ['box', 'plate', 'sphere']) {
      const w = restingWorld({ shape, solver: new WarmGSSolver() });
      for (let i = 0; i < 240; i++) w.world.step(w.dt);
      // multiplier * dt is the impulse of one contact this step, in N·s.
      const impulse = w.world.contacts.reduce((s, c) => s + c.multiplier * w.dt, 0);
      expect(impulse).toBeCloseTo(w.body.mass * G * w.dt, 4);
    }
  });

  it('starts every resting contact from its impulse of the last step', () => {
    const solver = new WarmGSSolver({ maxContactsPerPair: 0 });
    const w = restingWorld({ shape: 'plate', solver });
    for (let i = 0; i < 120; i++) w.world.step(w.dt);
    expect(w.world.contacts.length).toBe(12); // one per side of the plate
    expect(solver.stats.warmStarted).toBe(12);
    expect(solver.stats.equations).toBe(12 * 3); // one normal, two tangents each
    const cold = new WarmGSSolver({ warmStart: 0 });
    const c = restingWorld({ shape: 'plate', solver: cold });
    for (let i = 0; i < 120; i++) c.world.step(c.dt);
    expect(cold.stats.warmStarted).toBe(0);
  });

  it('keeps the outermost contact points of a pair and drops the spare ones', () => {
    const solver = new WarmGSSolver({ maxContactsPerPair: 6 });
    const w = restingWorld({ shape: 'plate', solver });
    for (let i = 0; i < 240; i++) w.world.step(w.dt);
    expect(w.world.contacts.length).toBe(12);
    expect(solver.stats.equations).toBe(6 * 3);
    expect(solver.stats.dropped).toBe(6 * 3);
    const carrying = w.world.contacts.filter((c) => c.multiplier > 0);
    expect(carrying).toHaveLength(6);
    // The six that stay still carry the whole weight, spread around the rim.
    const impulse = w.world.contacts.reduce((s, c) => s + c.multiplier * w.dt, 0);
    expect(impulse).toBeCloseTo(w.body.mass * G * w.dt, 4);
    const cx = carrying.reduce((s, c) => s + c.rj.x, 0) / 6, cz = carrying.reduce((s, c) => s + c.rj.z, 0) / 6;
    expect(Math.hypot(cx, cz)).toBeLessThan(0.02); // centred under the plate
    for (const c of carrying) expect(Math.hypot(c.rj.x, c.rj.z)).toBeGreaterThan(0.15);
    // The plate stays level and still.
    expect(w.body.velocity.length()).toBeLessThan(1e-3);
    expect(Math.abs(w.body.quaternion.x) + Math.abs(w.body.quaternion.z)).toBeLessThan(1e-4);
    // A box has only four points: nothing to drop.
    const boxSolver = new WarmGSSolver({ maxContactsPerPair: 6 });
    const b = restingWorld({ shape: 'box', solver: boxSolver });
    for (let i = 0; i < 60; i++) b.world.step(b.dt);
    expect(boxSolver.stats.dropped).toBe(0);
  });

  // Code review, Oct 22: odd limits kept 2 * floor(max / 2) points (1 kept 2, 3 kept 2, 5 kept 4).
  it('keeps exactly maxContactsPerPair points, odd limits included', () => {
    for (const max of [1, 2, 3, 4, 5, 6]) {
      // One step from rest: all 12 rim points touch, before a 1-point plate can tip.
      const solver = new WarmGSSolver({ maxContactsPerPair: max });
      const w = restingWorld({ shape: 'plate', solver });
      w.world.step(w.dt);
      expect(w.world.contacts.length, `limit ${max}`).toBe(12);
      expect(solver.stats.equations, `limit ${max}`).toBe(max * 3);
      expect(w.world.contacts.filter((c) => c.multiplier > 0).length, `limit ${max}`).toBeLessThanOrEqual(max);
    }
  });

  // Code review, Oct 22: the count read one low when the tolerance early-out fired.
  it('counts the pass that converged', () => {
    const solver = new WarmGSSolver({ iterations: 30, tolerance: 1e3 }); // so loose the first pass converges
    const w = restingWorld({ solver });
    w.settle();
    expect(solver.stats.iterations).toBe(1);
    const strict = new WarmGSSolver({ tolerance: 0 });
    const s = restingWorld({ solver: strict });
    strict.iterations = 7; // restingWorld sets 20
    s.settle();
    expect(strict.stats.iterations).toBe(7);
  });

  it('forgets its cache when nothing is in contact', () => {
    const solver = new WarmGSSolver();
    const w = restingWorld({ solver });
    w.settle();
    expect(solver.cache.size).toBe(1);
    w.body.position.y = 5;
    w.body.velocity.set(0, 0, 0);
    w.world.step(w.dt);
    expect(solver.cache.size).toBe(0);
  });
});

describe('restitution threshold', () => {
  const drop = (restitution, solver, height) => {
    const w = restingWorld({ shape: 'sphere', restitution, solver, mu: 0, stiffness: 1e7 });
    w.body.position.y = 0.05 + height;
    let touched = false, apex = 0;
    for (let i = 0; i < 480; i++) {
      w.world.step(w.dt);
      if (w.world.contacts.length) touched = true;
      else if (touched) apex = Math.max(apex, w.body.position.y - 0.05);
    }
    return apex;
  };

  it('still bounces a real impact by about e^2 of the drop height', () => {
    const apex = drop(0.5, new WarmGSSolver(), 1.0); // lands at 4.4 m/s
    expect(apex).toBeGreaterThan(0.15);
    expect(apex).toBeLessThan(0.3);
  });

  it('does not bounce a slow touch-down, where the stock solver does', () => {
    const height = 0.005; // lands at 0.31 m/s, under the 0.5 m/s threshold
    expect(drop(0.5, new WarmGSSolver(), height)).toBeLessThan(0.0002);
    expect(drop(0.5, new WarmGSSolver({ restitutionThreshold: 0 }), height)).toBeGreaterThan(0.0005);
  });
});
