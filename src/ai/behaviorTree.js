export const OWNER_ACTIONS = [
  'idle',
  'investigate',
  'search',
  'checkHidingSpot',
  'returnToBed',
];

export function evaluateBehaviorTree(state, noise = null) {
  const { currentState, wakeLevel, target } = state;

  if (currentState === 'asleep') {
    return { action: 'idle', target: null };
  }

  if (!noise) {
    return {
      action: currentState === 'standing' || currentState === 'awake' ? 'returnToBed' : 'idle',
      target: null,
    };
  }

  const nextTarget = noise.position ?? target ?? null;

  if (currentState === 'stirring' || currentState === 'sittingUp') {
    return { action: 'investigate', target: nextTarget };
  }

  if (noise.loudness > 0.5 || wakeLevel >= 0.7) {
    return { action: 'search', target: nextTarget };
  }

  return { action: 'checkHidingSpot', target: nextTarget };
}
