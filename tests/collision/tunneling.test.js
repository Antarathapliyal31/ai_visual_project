// Mid-term proof: Tunneling (owner A).
import { describe, it, expect } from 'vitest';
import { createTunnelingScenario, runScenario, findFailureSpeed } from '../../harness/scenarios/tunneling.js';

describe('Tunneling proof', () => {
  it('100 swats at 12 m/s into a 2 cm shelf: zero pass-throughs with the guard on', () => {
    const r = runScenario(createTunnelingScenario({ speed: 12, swats: 100, guard: true }));
    console.log('[tunneling] guard on  @12 m/s:', r);
    expect(r.swats).toBe(100);
    expect(r.passThroughs).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('is a real test: without the guard the same swats tunnel', () => {
    const r = runScenario(createTunnelingScenario({ speed: 12, swats: 100, guard: false }));
    console.log('[tunneling] guard off @12 m/s:', r);
    expect(r.passThroughs).toBeGreaterThan(0);
  });

  it('logs the failure speed with the guard on and off', () => {
    const off = findFailureSpeed({ guard: false, from: 4, to: 40, stepBy: 2 });
    const on = findFailureSpeed({ guard: true, from: 12, to: 100, stepBy: 4 });
    console.log(`[tunneling] failure speed, guard off: ${off.failureSpeed ?? '> 40'} m/s`);
    console.log(`[tunneling] failure speed, guard on:  ${on.failureSpeed ?? '> 100'} m/s`);
    expect(on.failureSpeed === null || on.failureSpeed > 12).toBe(true);
  });
});
