export const OWNER_ACTIONS = [
  'idle',
  'investigate',
  'search',
  'checkHidingSpot',
  'returnToBed',
];

const DEFAULT_THRESHOLDS = {
  stirring: 0.2,
  sittingUp: 0.45,
  standing: 0.7,
  awake: 0.85,
  investigateLoudness: 0.5,
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roomAreaFor(pos) {
  if (!Array.isArray(pos) || pos.length < 3) return 'center';
  const [x, , z] = pos;
  if (z < -1.25) return x < -1 ? 'northWest' : 'northEast';
  if (z > 1.25) return x < 0 ? 'southWest' : 'southEast';
  if (x < -1.25) return 'west';
  if (x > 1.25) return 'east';
  return 'center';
}

export function createBehaviorTree(options = {}) {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds ?? {}),
  };

  const selector = (...nodes) => (blackboard) => {
    for (const node of nodes) {
      const result = node(blackboard);
      if (result) return result;
    }
    return null;
  };

  const blackboardFor = (state, noise) => ({
    currentState: state?.currentState ?? 'asleep',
    wakeLevel: clamp01(state?.wakeLevel ?? 0),
    target: state?.target ?? state?.lastKnownTarget ?? state?.lastSeenCat ?? noise?.position ?? null,
    loudness: clamp01(noise?.loudness ?? 0),
    suspicion: clamp01(state?.suspicion ?? 0),
    suspicionMeter: clamp01(state?.suspicionMeter ?? state?.suspicion ?? 0),
    hasNoise: !!noise,
    noisePosition: noise?.position ?? null,
    lastKnownTarget: state?.lastKnownTarget ?? null,
    lastSeenCat: state?.lastSeenCat ?? null,
    searchRoute: Array.isArray(state?.searchRoute) ? state.searchRoute : [],
    roomArea: roomAreaFor(state?.lastKnownTarget ?? state?.lastSeenCat ?? state?.target ?? noise?.position ?? null),
    thresholds,
  });

  const isAsleep = (bb) => (bb.currentState === 'asleep' ? { action: 'idle', target: null } : null);
  const hasNoNoise = (bb) => {
    if (!bb.hasNoise) {
      const target = bb.lastSeenCat ?? bb.lastKnownTarget ?? bb.target ?? bb.noisePosition ?? null;
      if (target && bb.suspicionMeter >= 0.18 && bb.wakeLevel >= bb.thresholds.stirring) {
        return { action: 'search', target, roomArea: roomAreaFor(target) };
      }
      if (target && (bb.currentState === 'standing' || bb.currentState === 'awake') && bb.wakeLevel >= bb.thresholds.standing) {
        return { action: 'search', target, roomArea: roomAreaFor(target) };
      }
      return {
        action: bb.currentState === 'standing' || bb.currentState === 'awake' ? 'returnToBed' : 'idle',
        target: null,
      };
    }
    return null;
  };
  const isInvestigating = (bb) => (
    (bb.currentState === 'stirring' || bb.currentState === 'sittingUp') && (bb.target || bb.lastSeenCat)
      ? { action: 'investigate', target: bb.lastSeenCat ?? bb.target, roomArea: roomAreaFor(bb.lastSeenCat ?? bb.target) }
      : null
  );
  const isSearching = (bb) => (
    bb.hasNoise && (bb.loudness > bb.thresholds.investigateLoudness || bb.suspicionMeter > 0.35 || bb.wakeLevel >= bb.thresholds.standing)
      ? { action: 'search', target: bb.lastSeenCat ?? bb.target, roomArea: roomAreaFor(bb.lastSeenCat ?? bb.target) }
      : null
  );
  const isCheckingHidingSpot = (bb) => (
    bb.hasNoise && bb.wakeLevel < bb.thresholds.standing && bb.target
      ? { action: 'checkHidingSpot', target: bb.target, roomArea: roomAreaFor(bb.target) }
      : null
  );

  const tree = selector(
    isAsleep,
    hasNoNoise,
    isInvestigating,
    isSearching,
    isCheckingHidingSpot,
  );

  return (state, noise = null) => tree(blackboardFor(state, noise)) ?? { action: 'idle', target: null };
}

export function evaluateBehaviorTree(state, noise = null, options = {}) {
  return createBehaviorTree(options)(state, noise);
}
