// Coupling scenario (owner: D, with C's thresholds): the mid-term proof that
// physics and AI share one data path.
//
// The same swat, a mug knocked into a wall at the cat's gameplay swat speed,
// once beside the bed and once from the far wall. The owner hears it through
// the real chain: solver impulses -> ImpactEvents -> loudness -> distance ->
// wake meter. Beside the bed it must take him to "sitting up"; from the far
// wall it must not take him past "stirring".
//
// Scenario contract: {name, setup, step, metrics, pass}. No Three.js.

import { tuning as defaultTuning } from '../../src/core/tuning.js';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { swat } from '../../src/player/swat.js';
import { createNoise } from '../../src/noise/index.js';
import { BED_HEAD } from '../../src/ai/home.js';

/** Both swats knock a mug standing on the floor into plaster 0.5 m away. */
export const COUPLING_SPOTS = {
  besideBed: { at: [-3.0, -2.0], direction: { x: -1, y: 0, z: 0 } }, // into the west wall, by the nightstand
  farWall: { at: [3.0, 2.3], direction: { x: 1, y: 0, z: 0 } },     // into the open east side's wall
};

/**
 * @param {object} [opts]
 * @param {'besideBed' | 'farWall'} [opts.spot='besideBed']
 * @param {number} [opts.seconds=3]  listened for after the swat
 * @param {object} [opts.tuning]
 */
export function createCouplingScenario(opts = {}) {
  const { spot = 'besideBed', seconds = 3, tuning = defaultTuning } = opts;
  const where = COUPLING_SPOTS[spot];
  const settle = tuning.noise.settleSteps + 30;
  let physics, noise, mug, steps, total, peak;
  const th = tuning.owner.thresholds;
  const stageOf = (w) => (w >= th.awake ? 'awake' : w >= th.standing ? 'standing' : w >= th.sittingUp ? 'sittingUp' : w >= th.stirring ? 'stirring' : 'asleep');

  return {
    name: `coupling: swat ${spot === 'besideBed' ? 'beside the bed' : 'from the far wall'}`,
    setup() {
      physics = createPhysicsWorld({ tuning });
      noise = createNoise(physics, { listener: () => BED_HEAD });
      mug = physics.spawn('mug', { base: [where.at[0], 0, where.at[1]] });
      steps = 0;
      total = settle + Math.round(seconds / physics.dt);
      peak = 0;
    },
    step() {
      if (steps >= total) return false;
      if (steps === settle) swat(mug.body, where.direction, tuning.swat.speed, { tuning: tuning.swat });
      physics.step();
      peak = Math.max(peak, noise.wake);
      steps++;
      return steps < total;
    },
    metrics() {
      return { spot, wake: noise.wake, peakWake: peak, stage: stageOf(peak), impacts: noise.stats.events, broken: physics.debris.length > 0 };
    },
    pass(m = this.metrics()) {
      const rank = ['asleep', 'stirring', 'sittingUp', 'standing', 'awake'];
      return spot === 'besideBed' ? rank.indexOf(m.stage) >= rank.indexOf('sittingUp') : rank.indexOf(m.stage) <= rank.indexOf('stirring');
    },
  };
}

export function runCouplingScenario(scenario, maxSteps = 1e6) {
  scenario.setup();
  for (let i = 0; i < maxSteps && scenario.step(); i++);
  const m = scenario.metrics();
  return { ...m, pass: scenario.pass(m) };
}
