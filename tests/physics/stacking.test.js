// Mid-term proof: Stacking (owner B).
import { describe, it, expect } from 'vitest';
import { createStackingScenario, runStackingScenario, STACK_LIMITS } from '../../harness/scenarios/stacking.js';
import { mulberry32, range } from '../helpers/rng.js';
import { freshTuning } from '../helpers/tuning.js';

const LIMIT = { pen: STACK_LIMITS.penetration * 1000, drift: STACK_LIMITS.drift * 1000 }; // mm

describe('Stacking proof', () => {
  it('five plates, sleeping off, 60 s: penetration under 2 mm, drift under 5 mm', () => {
    const r = runStackingScenario(createStackingScenario());
    console.log('[stacking] five plates, 60 s:', r);
    expect(r.seconds).toBe(60);
    expect(r.sleeping).toBe(false);
    expect(r.count).toBe(5);
    expect(r.maxPenetrationMm).toBeLessThan(LIMIT.pen);
    expect(r.maxDriftMm).toBeLessThan(LIMIT.drift);
    expect(r.pass).toBe(true);
  });

  it("is a real test: cannon-es's stock solver settings fail the same scenario", () => {
    const stock = freshTuning((t) => {
      t.physics.warmStart = 0;
      t.physics.coulombFriction = false;
      t.physics.restitutionThreshold = 0;
      t.physics.maxContactsPerPair = 0;
      t.physics.solverIterations = 20;
      for (const m of Object.values(t.materials)) m.stiffness = 1e7; // the cannon-es default
    });
    const r = runStackingScenario(createStackingScenario({ tuning: stock }));
    console.log('[stacking] stock cannon-es solver:', r);
    expect(r.pass).toBe(false);
    expect(r.maxDriftMm).toBeGreaterThan(LIMIT.drift);
  });

  it("gives identical numbers with A's swept guard on and off", () => {
    const on = runStackingScenario(createStackingScenario({ guard: true }));
    const off = runStackingScenario(createStackingScenario({ guard: false }));
    expect(on.guardClamps).toBe(0);
    expect({ ...on, guard: null }).toEqual({ ...off, guard: null });
  });

  it('keeps its margin when the stack is built by a messy hand (10 seeds)', () => {
    const worst = { pen: 0, drift: 0 };
    for (let seed = 1; seed <= 10; seed++) {
      const rand = mulberry32(seed);
      const sc = createStackingScenario({ seconds: 20 });
      sc.setup();
      for (const p of sc.stack) {
        // Up to 1 cm off centre and any yaw.
        p.body.position.x += range(rand, -0.01, 0.01);
        p.body.position.z += range(rand, -0.01, 0.01);
        p.body.quaternion.setFromEuler(0, range(rand, 0, 2 * Math.PI), 0);
        p.body.aabbNeedsUpdate = true;
      }
      while (sc.step());
      const r = sc.metrics();
      expect(sc.pass({ ...r, seconds: 60 }), `seed ${seed}: ${JSON.stringify(r)}`).toBe(true);
      worst.pen = Math.max(worst.pen, r.maxPenetrationMm);
      worst.drift = Math.max(worst.drift, r.maxDriftMm);
    }
    console.log('[stacking] worst of 10 messy stacks (20 s each):', worst);
  });

  it('holds across the solver settings around the default', () => {
    for (const iterations of [15, 20, 40]) {
      const r = runStackingScenario(createStackingScenario({ seconds: 20, tuning: freshTuning((t) => { t.physics.solverIterations = iterations; }) }));
      expect(r.maxPenetrationMm, `iterations ${iterations}`).toBeLessThan(LIMIT.pen);
      expect(r.maxDriftMm, `iterations ${iterations}`).toBeLessThan(LIMIT.drift);
    }
    for (const segments of [8, 10]) {
      const r = runStackingScenario(createStackingScenario({ seconds: 20, tuning: freshTuning((t) => { t.props.plate.segments = segments; }) }));
      expect(r.maxPenetrationMm, `segments ${segments}`).toBeLessThan(LIMIT.pen);
      expect(r.maxDriftMm, `segments ${segments}`).toBeLessThan(LIMIT.drift);
    }
  });

  it('logs the fallback: five books pass too', () => {
    const r = runStackingScenario(createStackingScenario({ kind: 'book' }));
    console.log('[stacking] five books, 60 s:', r);
    expect(r.pass).toBe(true);
  });

  it('is quiet: half a second after spawning, no plate moves faster than 2 mm/s', () => {
    // D's silent-stack check needs this: a stack that buzzes would make noise.
    const r = runStackingScenario(createStackingScenario({ seconds: 20, settleSeconds: 0.5 }));
    expect(r.maxSpeedMmPerS).toBeLessThan(2);
  });
});
