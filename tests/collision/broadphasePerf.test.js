// W3-W4: 200-400 bodies. Logs the numbers used to tune the cell size; asserts
// only things that don't depend on machine speed.
import { describe, it, expect } from 'vitest';
import { createBroadphasePerfScenario } from '../../harness/scenarios/broadphasePerf.js';
import { runScenario } from '../../harness/scenarios/tunneling.js';

const row = (r) => {
  const f = (w) => `${w.stepMs.toFixed(2)} ms step, ${w.broadphaseMs.toFixed(2)} ms bp, ${w.broadphasePairs} pairs, ${w.narrowPairs} narrow (max ${w.maxNarrowPairs}), ${w.awake} awake`;
  return `${r.bodies} bodies ${r.broadphase}${r.cellSize ? ` @${r.cellSize}m` : ''} | active: ${f(r.active)} | settled: ${f(r.settled)}`;
};

describe('broadphase at 200-400 bodies', () => {
  for (const bodies of [200, 400]) {
    it(`${bodies} bodies: grid stays stable and narrows the pairs vs naive`, () => {
      const grid = runScenario(createBroadphasePerfScenario({ bodies, broadphase: 'grid', cellSize: 0.5 }));
      const naive = runScenario(createBroadphasePerfScenario({ bodies, broadphase: 'naive' }));
      console.log(`[perf] ${row(grid)}`);
      console.log(`[perf] ${row(naive)}`);
      expect(grid.pass).toBe(true);           // nothing fell out of the room
      expect(grid.escaped).toBe(0);
      expect(grid.active.broadphasePairs).toBeLessThan(naive.active.broadphasePairs);
      // Same physics, so the same number of real contacts (within chaos).
      expect(Math.abs(grid.active.narrowPairs - naive.active.narrowPairs)).toBeLessThan(0.1 * naive.active.narrowPairs + 5);
    });
  }
});
