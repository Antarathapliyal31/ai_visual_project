// A private copy of tuning.js per test, so tests can change numbers freely.
import { tuning } from '../../src/core/tuning.js';

export function freshTuning(mutate) {
  const t = structuredClone(tuning);
  mutate?.(t);
  return t;
}
