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
    noise: null,
    bedPosition: options.bedPosition ?? [0, 0, 0],
    homePosition: options.homePosition ?? options.bedPosition ?? [0, 0, 0],
    position: options.position ?? options.bedPosition ?? [0, 0, 0],
  };

  const api = {
    update(dt, wakeLevel) {
      const incomingWake = typeof wakeLevel === 'number' ? clamp01(wakeLevel) : state.wakeLevel;
      state.wakeLevel = incomingWake;

      const wakeFloor = thresholds.stirring * 0.75;

      if (!state.noise && state.wakeLevel <= thresholds.stirring) {
        state.currentState = 'asleep';
      } else {
        let advanced = true;
        while (advanced) {
          advanced = false;

          if (state.currentState === 'asleep' && state.wakeLevel >= thresholds.stirring) {
            state.currentState = 'stirring';
            advanced = true;
          } else if (state.currentState === 'stirring' && state.wakeLevel >= thresholds.sittingUp) {
            state.currentState = 'sittingUp';
            advanced = true;
          } else if (state.currentState === 'sittingUp' && state.wakeLevel >= thresholds.standing) {
            state.currentState = 'standing';
            advanced = true;
          } else if (state.currentState === 'standing' && state.wakeLevel >= thresholds.awake) {
            state.currentState = 'awake';
            advanced = true;
          } else if (state.currentState === 'awake' && state.wakeLevel < wakeFloor) {
            state.currentState = 'asleep';
            advanced = true;
          }
        }
      }

      const decision = evaluateBehaviorTree(
        { currentState: state.currentState, wakeLevel: state.wakeLevel, target: state.target },
        state.noise,
      );

      state.action = decision.action;
      state.target = decision.target ?? state.target;

      if (!state.noise) {
        state.target = null;
      }

      if (state.action === 'returnToBed') {
        state.position = [...state.homePosition];
      }

      if (state.currentState === 'asleep') {
        state.position = [...state.homePosition];
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
      return state.target;
    },

    getPosition() {
      return [...state.position];
    },

    getBedPosition() {
      return [...state.homePosition];
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
      state.target = Array.isArray(nextNoise.position) ? [...nextNoise.position] : null;
      state.position = Array.isArray(nextNoise.position) ? [...nextNoise.position] : state.position;
      return nextNoise;
    },

    clearNoise() {
      state.noise = null;
      state.target = null;
      state.action = 'idle';

      if (state.wakeLevel <= thresholds.stirring) {
        state.currentState = 'asleep';
      }

      return true;
    },

    setWakeLevel(level) {
      state.wakeLevel = clamp01(level);
      return state.wakeLevel;
    },
  };

  return api;
}
