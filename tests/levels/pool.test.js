import { describe, it, expect } from 'vitest';
import { TIERS, tierOf, roomsIn, nextRoom } from '../../src/levels/pool.js';
import { LEVELS } from '../../src/levels/index.js';

const rooms = [
  { id: 'a', difficulty: 1 }, { id: 'b', difficulty: 2 }, { id: 'c', difficulty: 3 },
  { id: 'd', difficulty: 4 }, { id: 'e', difficulty: 5 }, { id: 'f', difficulty: 2 },
];
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('the room pool', () => {
  it('groups difficulty 1-2 as easy, 3 as medium, 4-5 as hard', () => {
    expect([1, 2, 3, 4, 5].map(tierOf)).toEqual(['easy', 'easy', 'medium', 'hard', 'hard']);
    expect(TIERS.map((t) => t.id)).toEqual(['easy', 'medium', 'hard']);
    expect(roomsIn('easy', rooms).map((r) => r.id)).toEqual(['a', 'b', 'f']);
    expect(roomsIn('hard', rooms).map((r) => r.id)).toEqual(['d', 'e']);
  });

  it('picks a room of the tier not played yet', () => {
    const { room, played } = nextRoom('easy', rooms, ['a', 'f'], { rng: () => 0.99 });
    expect(room.id).toBe('b');
    expect(played).toEqual(['a', 'f']);
    // At random among the fresh ones.
    expect(nextRoom('easy', rooms, [], { rng: () => 0 }).room.id).toBe('a');
    expect(nextRoom('easy', rooms, [], { rng: () => 0.5 }).room.id).toBe('b');
  });

  it('starts a tier over once all of it is played, not with the room just played', () => {
    const picks = new Set();
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const { room, played } = nextRoom('easy', rooms, ['a', 'b', 'f', 'd'], { rng: seq(r), not: 'f' });
      picks.add(room.id);
      expect(played).toEqual(['d']); // the other tiers' history stays
    }
    expect([...picks].sort()).toEqual(['a', 'b']);
  });

  it('copes with a tier of one room, or none', () => {
    expect(nextRoom('medium', rooms, ['c'], { not: 'c' }).room.id).toBe('c');
    expect(nextRoom('medium', [], []).room).toBeNull();
  });

  it('has rooms of every tier in the game', () => {
    for (const t of TIERS) expect(roomsIn(t.id, LEVELS).length, t.id).toBeGreaterThan(0);
  });
});
