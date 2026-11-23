import { describe, it, expect } from 'vitest';
import { COATS, COLLARS, totalStars, starsToOpen, tierOpen, lookOpen, newlyUnlocked } from '../../src/core/progress.js';
import { tuning } from '../../src/core/tuning.js';

const unlock = tuning.game.unlock;

describe('what stars open', () => {
  it('adds up the best stars of every room', () => {
    expect(totalStars({ a: 3, b: 1, c: 0 })).toBe(4);
    expect(totalStars(undefined)).toBe(0);
  });

  it('opens Easy from the start, Medium and Hard at their stars, everything with unlockAll', () => {
    expect(tierOpen('easy', 0, unlock)).toBe(true);
    expect(tierOpen('medium', unlock.medium - 1, unlock)).toBe(false);
    expect(starsToOpen('medium', unlock.medium - 1, unlock)).toBe(1);
    expect(tierOpen('medium', unlock.medium, unlock)).toBe(true);
    expect(tierOpen('hard', unlock.medium, unlock)).toBe(false);
    expect(tierOpen('hard', 0, unlock, { unlockAll: true })).toBe(true);
  });

  it('opens coats and collars as stars come in, the tabby and no collar from the start', () => {
    expect(COATS[0]).toMatchObject({ id: 'tabby', stars: 0 });
    expect(COLLARS[0]).toMatchObject({ id: 'none', stars: 0 });
    const ginger = COATS.find((c) => c.id === 'ginger');
    expect(lookOpen(ginger, ginger.stars - 1)).toBe(false);
    expect(lookOpen(ginger, ginger.stars)).toBe(true);
    expect(lookOpen(COATS.at(-1), 0, { unlockAll: true })).toBe(true);
    // Each look asks for more stars than the one before.
    for (const list of [COATS, COLLARS]) for (let i = 1; i < list.length; i++) expect(list[i].stars).toBeGreaterThan(list[i - 1].stars);
  });

  it('says what a night opened', () => {
    expect(newlyUnlocked(2, 3, unlock)).toEqual(['Ginger coat']);
    expect(newlyUnlocked(4, 6, unlock)).toEqual(['Medium rooms', 'Red collar']);
    expect(newlyUnlocked(6, 6, unlock)).toEqual([]);
  });
});
