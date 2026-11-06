import { evaluateBehaviorTree } from './behaviorTree.js';

export const OWNER_STATES = ['asleep', 'stirring', 'sittingUp', 'standing', 'awake'];

const DEFAULT_THRESHOLDS = {
  stirring: 0.2,
  sittingUp: 0.45,
  standing: 0.7,
  awake: 0.85,
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clonePosition(pos) {
  if (!Array.isArray(pos)) return null;
  return [...pos];
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

export function createOwnerAI(options = {}) {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds ?? {}),
  };

  const state = {
    currentState: 'asleep',
    wakeLevel: 0,
    action: 'idle',
    target: null,
    lastKnownTarget: null,
    lastSeenCat: null,
    suspicion: 0,
    suspicionMeter: 0,
    searchRoute: [],
    noise: null,
    bedPosition: options.bedPosition ?? [0, 0, 0],
    homePosition: options.homePosition ?? options.bedPosition ?? [0, 0, 0],
    position: options.position ?? options.bedPosition ?? [0, 0, 0],
  };

  function updateCurrentState() {
    if (state.wakeLevel <= thresholds.stirring) {
      state.currentState = 'asleep';
    } else if (state.wakeLevel < thresholds.sittingUp) {
      state.currentState = 'stirring';
    } else if (state.wakeLevel < thresholds.standing) {
      state.currentState = 'sittingUp';
    } else if (state.wakeLevel < thresholds.awake) {
      state.currentState = 'standing';
    } else {
      state.currentState = 'awake';
    }
  }

  function updateSearchRoute(pos) {
    if (!Array.isArray(pos) || pos.length < 3) {
      state.searchRoute = ['center'];
      return state.searchRoute;
    }
    state.searchRoute = [roomAreaFor(pos), 'focused'];
    return state.searchRoute;
  }

  const api = {
    update(dt, wakeLevel) {
      const incomingWake = typeof wakeLevel === 'number' ? clamp01(wakeLevel) : state.wakeLevel;
      state.wakeLevel = incomingWake;

      if (state.noise && Array.isArray(state.noise.position)) {
        state.lastKnownTarget = [...state.noise.position];
        state.target = [...state.noise.position];
        state.suspicionMeter = clamp01(Math.max(state.suspicionMeter, state.noise.loudness * 0.75 + 0.25));
      } else if (state.suspicionMeter > 0) {
        state.suspicionMeter = clamp01(state.suspicionMeter - dt * 0.2);
      }

      state.suspicion = state.suspicionMeter;
      if (state.suspicionMeter <= 0.05) {
        state.lastKnownTarget = null;
      }
      if (state.lastSeenCat && state.suspicionMeter <= 0.08) {
        state.lastSeenCat = null;
      }
      updateCurrentState();

      const decision = evaluateBehaviorTree(
        {
          currentState: state.currentState,
          wakeLevel: state.wakeLevel,
          target: state.lastSeenCat ?? state.lastKnownTarget ?? state.target,
          suspicion: state.suspicionMeter,
          suspicionMeter: state.suspicionMeter,
          lastKnownTarget: state.lastKnownTarget,
          lastSeenCat: state.lastSeenCat,
          searchRoute: state.searchRoute,
        },
        state.noise,
        { thresholds },
      );

      state.action = decision.action;
      state.target = decision.target ?? state.lastSeenCat ?? state.lastKnownTarget ?? state.target;
      if (state.target) updateSearchRoute(state.target);

      if (!state.noise && state.target && state.suspicionMeter >= 0.15) {
        state.lastKnownTarget = clonePosition(state.target);
      } else if (!state.noise && state.suspicionMeter < 0.05) {
        state.target = null;
        state.lastKnownTarget = null;
      }

      if (state.action === 'returnToBed') {
        state.position = [...state.homePosition];
        state.target = null;
        state.lastKnownTarget = null;
        state.suspicionMeter = 0;
        state.suspicion = 0;
      }

      if (state.currentState === 'asleep') {
        state.position = [...state.homePosition];
        state.target = null;
        state.lastKnownTarget = null;
        state.lastSeenCat = null;
        state.suspicionMeter = 0;
        state.suspicion = 0;
      }

      return {
        state: state.currentState,
        action: state.action,
        wakeLevel: state.wakeLevel,
        target: state.target,
        position: [...state.position],
        bedPosition: [...state.homePosition],
      };
    },

    getState() {
      return state.currentState;
    },

    getCurrentAction() {
      return state.action;
    },

    getWakeLevel() {
      return state.wakeLevel;
    },

    getTarget() {
      return state.target ? [...state.target] : null;
    },

    getPosition() {
      return [...state.position];
    },

    getBedPosition() {
      return [...state.homePosition];
    },

    getSuspicionMeter() {
      return state.suspicionMeter;
    },

    getSearchRoute() {
      return [...state.searchRoute];
    },

    getLastSeenCat() {
      return state.lastSeenCat ? [...state.lastSeenCat] : null;
    },

    trackLastSeenCat(pos) {
      if (!Array.isArray(pos)) return null;
      state.lastSeenCat = [...pos];
      state.lastKnownTarget = [...pos];
      state.target = [...pos];
      state.suspicionMeter = clamp01(Math.max(state.suspicionMeter, 0.55));
      state.suspicion = state.suspicionMeter;
      updateSearchRoute(pos);
      return [...state.lastSeenCat];
    },

    onNoise(noiseEvent) {
      if (!noiseEvent || typeof noiseEvent !== 'object') {
        return null;
      }

      const nextNoise = {
        loudness: clamp01(noiseEvent.loudness ?? 0),
        position: noiseEvent.position ?? null,
      };

      state.noise = nextNoise;
      if (Array.isArray(nextNoise.position)) {
        state.lastKnownTarget = [...nextNoise.position];
        state.target = [...nextNoise.position];
        updateSearchRoute(nextNoise.position);
      }
      state.suspicionMeter = clamp01(Math.max(state.suspicionMeter, nextNoise.loudness * 0.8 + 0.2));
      state.suspicion = state.suspicionMeter;

      return nextNoise;
    },

    clearNoise() {
      state.noise = null;
      state.action = 'idle';

      if (state.lastSeenCat && state.suspicionMeter > 0.1) {
        state.target = [...state.lastSeenCat];
      } else if (state.lastKnownTarget && state.suspicionMeter > 0.15) {
        state.target = [...state.lastKnownTarget];
      } else {
        state.target = null;
      }

      updateCurrentState();
      return true;
    },

    setWakeLevel(level) {
      state.wakeLevel = clamp01(level);
      return state.wakeLevel;
    },
  };

  return api;
}
