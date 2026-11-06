import { describe, it, expect } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { createImpactHarvester, impactLoudness, falloff, createWakeMeter, createNoise } from '../../src/noise/index.js';
import { BED_HEAD } from '../../src/ai/home.js';
import { createCouplingScenario, runCouplingScenario } from '../../harness/scenarios/coupling.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';

const cfg = tuning.noise;

function world(t = freshTuning()) {
  const physics = createPhysicsWorld({ tuning: t });
  const events = [];
  const harvester = createImpactHarvester(physics, { onImpact: (e) => events.push(e) });
  const run = (seconds) => { for (let i = 0, n = Math.round(seconds / physics.dt); i < n; i++) physics.step(); };
  run((cfg.settleSteps + 1) * physics.dt);
  return { physics, events, harvester, run };
}

describe('impact harvester', () => {
  it('hears a mug land once, with the impulse the solver applied', () => {
    const w = world();
    const mug = w.physics.spawn('mug', { position: [0.5, 0.57, 1.0] }); // 50 cm drop to the floor
    w.run(1.5);
    const landing = w.events.filter((e) => e.bodyA === mug.body || e.bodyB === mug.body);
    expect(landing.length).toBeGreaterThanOrEqual(1);
    // It falls 0.5 m: about 3.1 m/s, 0.3 kg; a little bounce at most.
    const v = Math.sqrt(2 * 9.82 * 0.5);
    expect(landing[0].impulse).toBeGreaterThan(0.3 * v * 0.9);
    expect(landing[0].impulse).toBeLessThan(0.3 * v * 1.3);
    expect(Math.hypot(landing[0].point.x - 0.5, landing[0].point.z - 1.0)).toBeLessThan(0.12);
    expect(landing[0].point.y).toBeLessThan(0.05);
    expect([landing[0].matA, landing[0].matB]).toContain('ceramic');
  });

  it('is silent while things rest or slide, and while the room settles at the start', () => {
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t });
    const events = [];
    createImpactHarvester(physics, { onImpact: (e) => events.push(e) });
    physics.spawn('book', { base: [0.5, 0, 1.0] });
    for (let i = 0; i < t.noise.settleSteps; i++) physics.step();
    expect(events).toHaveLength(0);
    for (let i = 0; i < 240; i++) physics.step();
    expect(events).toHaveLength(0);
  });

  it('feeds every impact to fracture: a mug thrown at a wall breaks with no other help', () => {
    const w = world();
    const mug = w.physics.spawn('mug', { base: [3.0, 0, 2.3] });
    mug.body.velocity.set(6, 0, 0);
    w.run(1);
    expect(w.physics.debris.length).toBeGreaterThan(0);
    expect(w.physics.props.includes(mug)).toBe(false);
  });
});

describe('loudness and distance', () => {
  const { materials } = createPhysicsWorld({ tuning: freshTuning() });
  const e = (impulse, matA, matB) => ({ impulse, matA, matB });

  it('grows with the log of the impulse: louder, but never pinned by one crash', () => {
    const quiet = impactLoudness(e(0.3, 'ceramic', 'wood'), materials, cfg);
    const loud = impactLoudness(e(3, 'ceramic', 'wood'), materials, cfg);
    const huge = impactLoudness(e(30, 'ceramic', 'wood'), materials, cfg);
    expect(loud).toBeGreaterThan(quiet);
    expect(huge - loud).toBeCloseTo(Math.log((1 + 30 / cfg.impulseScale) / (1 + 3 / cfg.impulseScale)) * materials.loudness('ceramic', 'wood'), 6);
    expect(huge / loud).toBeLessThan(2); // ten times the impulse, well under twice the sound
  });

  it('scales by the material pair: ceramic rings, paper thuds, the cat is padded', () => {
    const ceramic = impactLoudness(e(1, 'ceramic', 'wood'), materials, cfg);
    const paper = impactLoudness(e(1, 'paper', 'wood'), materials, cfg);
    expect(ceramic).toBeGreaterThan(2 * paper);
    const cat = impactLoudness(e(1, 'cat', 'wood'), materials, cfg);
    expect(cat).toBeCloseTo(materials.loudness('cat', 'wood') * cfg.catFactor * Math.log(1 + 1 / cfg.impulseScale), 9);
  });

  it('halves at the falloff distance', () => {
    expect(falloff(0, cfg)).toBe(1);
    expect(falloff(cfg.falloff, cfg)).toBeCloseTo(0.5, 9);
    expect(falloff(3 * cfg.falloff, cfg)).toBeCloseTo(0.1, 9);
  });
});

describe('wake meter', () => {
  it('adds what he hears, caps at 1, and waits before it drains', () => {
    const m = createWakeMeter(cfg);
    m.hear(0.5);
    expect(m.level).toBeCloseTo(0.5 * cfg.wakeGain, 9);
    m.hear(100);
    expect(m.level).toBe(1);
    m.update(cfg.decayDelay);
    expect(m.level).toBe(1);
    m.update(1);
    expect(m.level).toBeCloseTo(1 - cfg.wakeDecay, 9);
    m.hear(0.01); // any new sound restarts the wait
    m.update(cfg.decayDelay);
    expect(m.level).toBeCloseTo(1 - cfg.wakeDecay + 0.01 * cfg.wakeGain, 9);
  });

  it('drains to zero and stays there', () => {
    const m = createWakeMeter(cfg);
    m.raise(0.3);
    for (let i = 0; i < 400; i++) m.update(0.1);
    expect(m.level).toBe(0);
    m.reset();
    expect(m.level).toBe(0);
  });
});

describe('noise: harvester, loudness and meter together', () => {
  it('a crash near his head wakes him more than the same crash across the room', () => {
    const levels = [];
    for (const at of [[-2.6, -1.6], [2.8, 2.4]]) {
      const physics = createPhysicsWorld({ tuning: freshTuning() });
      const noise = createNoise(physics, { listener: () => BED_HEAD });
      for (let i = 0; i <= cfg.settleSteps; i++) physics.step();
      physics.spawn('plate', { position: [at[0], 0.8, at[1]] });
      for (let i = 0; i < 120; i++) physics.step();
      levels.push(noise.wake);
    }
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[0]).toBeGreaterThan(3 * levels[1]);
  });
});

// The mid-term Coupling proof: the same swat reaches "sitting up" from beside
// the bed and goes no further than "stirring" from the far wall.
describe('coupling proof', () => {
  it('beside the bed, the swat takes the owner to sitting up', () => {
    const r = runCouplingScenario(createCouplingScenario({ spot: 'besideBed' }));
    expect(r.pass).toBe(true);
    expect(r.peakWake).toBeGreaterThanOrEqual(tuning.owner.thresholds.sittingUp);
  });

  it('from the far wall, the same swat goes no further than stirring', () => {
    const r = runCouplingScenario(createCouplingScenario({ spot: 'farWall' }));
    expect(r.pass).toBe(true);
    expect(r.peakWake).toBeLessThan(tuning.owner.thresholds.sittingUp);
  });
});
