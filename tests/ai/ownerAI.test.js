import { describe, expect, it } from 'vitest';
import { createOwnerAI, OWNER_STATES, OWNER_ACTIONS, createOwnerPlaceholder, evaluateBehaviorTree } from '../../src/ai/index.js';

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

  it('uses configured wake thresholds instead of hard-coded behavior tree values', () => {
    const decision = evaluateBehaviorTree(
      { currentState: 'standing', wakeLevel: 0.55, target: [2, 0, 0] },
      { loudness: 0.2, position: [2, 0, 0] },
      { thresholds: { standing: 0.5 } },
    );

    expect(decision.action).toBe('search');
  });

  it('keeps the bed position while tracking a noise target and cools down when the wake level drops', () => {
    const ai = createOwnerAI({
      bedPosition: [0, 0, 0],
      thresholds: {
        stirring: 0.2,
        sittingUp: 0.45,
        standing: 0.7,
      },
    });

    ai.onNoise({ loudness: 0.9, position: [5, 0, 0] });
    ai.update(0.1, 0.9);

    expect(ai.getPosition()).toEqual([0, 0, 0]);
    expect(ai.getTarget()).toEqual([5, 0, 0]);

    ai.update(0.1, 0.35);
    expect(ai.getState()).toBe('stirring');
  });

  it('keeps searching a last known target while the owner remains alert after the sound fades', () => {
    const decision = evaluateBehaviorTree(
      { currentState: 'standing', wakeLevel: 0.8, target: [4, 0, 0] },
      null,
      { thresholds: { standing: 0.5 } },
    );

    expect(decision.action).toBe('search');
    expect(decision.target).toEqual([4, 0, 0]);
  });

  it('remembers a recent noise as suspicion even after the sound is cleared', () => {
    const ai = createOwnerAI({ thresholds: { stirring: 0.2, sittingUp: 0.45, standing: 0.7, awake: 0.85 } });

    ai.onNoise({ loudness: 0.9, position: [6, 0, 0] });
    ai.update(0.1, 0.9);
    ai.clearNoise();
    ai.update(0.1, 0.8);

    expect(ai.getTarget()).toEqual([6, 0, 0]);
    expect(ai.getCurrentAction()).toBe('search');
  });

  it('tracks a real suspicion meter and stores the last seen cat position', () => {
    const ai = createOwnerAI({ thresholds: { stirring: 0.2, sittingUp: 0.45, standing: 0.7, awake: 0.85 } });

    ai.onNoise({ loudness: 0.9, position: [4, 0, 0] });
    ai.update(0.1, 0.75);

    expect(ai.getSuspicionMeter()).toBeGreaterThan(0.5);
    ai.trackLastSeenCat([1.5, 0, 0.5]);

    expect(ai.getLastSeenCat()).toEqual([1.5, 0, 0.5]);
    expect(ai.getTarget()).toEqual([1.5, 0, 0.5]);
  });

  it('starts lying in bed as a visual placeholder', () => {
    const owner = createOwnerPlaceholder({ bedPosition: [0, 0.5, 0] });

    expect(owner.state).toBe('asleep');
    expect(owner.pose).toBe('lying');
    expect(owner.position).toEqual([0, 0.5, 0]);
    expect(owner.bedPosition).toEqual([0, 0.5, 0]);
  });
});
