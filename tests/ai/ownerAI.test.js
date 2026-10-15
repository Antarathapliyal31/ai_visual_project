import { describe, expect, it } from 'vitest';
import { createOwnerAI, OWNER_STATES, OWNER_ACTIONS, createOwnerPlaceholder } from '../../src/ai/index.js';

describe('owner AI state machine', () => {
  it('starts asleep in bed and remains there before noise', () => {
    const ai = createOwnerAI({
      bedPosition: [0, 0, 0],
      thresholds: {
        stirring: 0.2,
        sittingUp: 0.45,
        standing: 0.7,
      },
    });

    expect(ai.getState()).toBe('asleep');
    expect(ai.getBedPosition()).toEqual([0, 0, 0]);
    expect(ai.getPosition()).toEqual([0, 0, 0]);
  });

  it('transitions from asleep to standing as wake level rises', () => {
    const ai = createOwnerAI({
      thresholds: {
        stirring: 0.2,
        sittingUp: 0.45,
        standing: 0.7,
      },
    });

    ai.onNoise({ loudness: 0.9, position: [2, 0, 0] });
    ai.update(0.1, 0.8);

    expect(OWNER_STATES.includes(ai.getState())).toBe(true);
    expect(ai.getState()).toBe('standing');
  });

  it('remembers the latest noise and selects a search target', () => {
    const ai = createOwnerAI();

    ai.onNoise({ loudness: 0.8, position: [2, 0, 0] });
    ai.update(0.1, 0.75);

    expect(ai.getTarget()).toEqual([2, 0, 0]);
    expect(OWNER_ACTIONS.includes(ai.getCurrentAction())).toBe(true);
    expect(ai.getCurrentAction()).toMatch(/investigate|search/i);
  });

  it('returns to bed when the noise fades', () => {
    const ai = createOwnerAI();

    ai.onNoise({ loudness: 0.9, position: [3, 0, 1] });
    ai.update(0.1, 0.9);
    ai.clearNoise();
    ai.update(0.1, 0.2);

    expect(ai.getState()).toBe('asleep');
    expect(ai.getTarget()).toBeNull();
  });

  it('starts lying in bed as a visual placeholder', () => {
    const owner = createOwnerPlaceholder({ bedPosition: [0, 0.5, 0] });

    expect(owner.state).toBe('asleep');
    expect(owner.pose).toBe('lying');
    expect(owner.position).toEqual([0, 0.5, 0]);
    expect(owner.bedPosition).toEqual([0, 0.5, 0]);
  });
});
