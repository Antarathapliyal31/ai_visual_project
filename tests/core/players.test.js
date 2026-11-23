import { describe, it, expect } from 'vitest';
import { createPlayers, cleanName, entryOf, rank, NAME_MAX } from '../../src/core/players.js';
import { localBoard, sharedBoard } from '../../src/core/board.js';

/** localStorage, as JSON values in a Map. */
const memory = () => {
  const m = new Map();
  return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)), m };
};
let n = 0;
const ids = () => `player-${++n}`;

describe('players', () => {
  it('tidies a name, and refuses one with nothing in it', () => {
    expect(cleanName('  Rushi   Patel ')).toBe('Rushi Patel');
    expect(cleanName('x'.repeat(40))).toHaveLength(NAME_MAX);
    expect(cleanName('   ')).toBe('');
    const players = createPlayers(memory(), { newId: ids });
    expect(players.choose('  ')).toBeNull();
    expect(players.current).toBeNull();
  });

  it('gives each name its own stars, and finds the same player again whatever the case', () => {
    const store = memory();
    const players = createPlayers(store, { newId: ids });
    const a = players.choose('Rushi');
    players.record('original', 2);
    players.record('original', 1); // a room keeps its best
    const b = players.choose('Dharm');
    expect(b.id).not.toBe(a.id);
    expect(b.stars).toEqual({});
    players.record('kitchen-diner', 3);
    expect(players.choose('rUSHI').id).toBe(a.id);
    expect(players.current.stars).toEqual({ original: 2 });
    // And it is all there after a reload.
    const again = createPlayers(store, { newId: ids });
    expect(again.current.id).toBe(a.id);
    expect(again.list().map((p) => p.name).sort()).toEqual(['Dharm', 'rUSHI']);
  });

  it('gives the stars won before there were names to the first player only', () => {
    const players = createPlayers(memory(), { newId: ids, legacyStars: { original: 3, 'reading-den': 1 } });
    expect(players.choose('First').stars).toEqual({ original: 3, 'reading-den': 1 });
    expect(players.choose('Second').stars).toEqual({});
  });

  it('counts a room finished when it has a star (a won night), and ranks by stars, then rooms finished', () => {
    expect(entryOf({ id: 'a', name: 'A', stars: { x: 3, y: 1, z: 0 } })).toEqual({ id: 'a', name: 'A', stars: 4, finished: 2 });
    const ranked = rank([
      { name: 'Low', stars: 2, finished: 2 },
      { name: 'Wide', stars: 6, finished: 4 },
      { name: 'Deep', stars: 6, finished: 2 },
      { name: 'Also wide', stars: 6, finished: 4 },
    ]);
    expect(ranked.map((e) => e.name)).toEqual(['Also wide', 'Wide', 'Deep', 'Low']);
  });
});

describe('the leaderboard', () => {
  it('on this computer: everyone who has played here, best first', async () => {
    const players = createPlayers(memory(), { newId: ids });
    players.choose('Ann');
    players.record('original', 1);
    players.choose('Bo');
    players.record('original', 3);
    players.record('reading-den', 2);
    const top = await localBoard(players).top(10);
    expect(top.map((e) => [e.name, e.stars, e.finished])).toEqual([['Bo', 5, 2], ['Ann', 1, 1]]);
  });

  /** A fetch that answers from `reply` and keeps the requests. */
  const fakeFetch = (reply) => {
    const calls = [];
    const f = async (url, init) => {
      calls.push({ url, init });
      return reply(url, init);
    };
    f.calls = calls;
    return f;
  };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  it('shared online: reads the top of the Supabase table, best first, and keeps only proper rows', async () => {
    const f = fakeFetch(() => ok([
      { id: 'b', name: 'Bo', stars: 5, finished: 2 },
      { id: 'a', name: 'Ann', stars: '7', finished: 3 },
      { name: 'no id' },
    ]));
    const board = sharedBoard({ url: 'https://example.supabase.co/', key: 'anon-key', fetch: f });
    const top = await board.top(5);
    expect(board.shared).toBe(true);
    expect(top).toEqual([{ id: 'a', name: 'Ann', stars: 7, finished: 3 }, { id: 'b', name: 'Bo', stars: 5, finished: 2 }]);
    const { url, init } = f.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/scores?select=id,name,stars,finished&order=stars.desc,finished.desc,name.asc&limit=5');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
  });

  it('shared online: adds or updates the player\'s row by its id', async () => {
    const f = fakeFetch(() => ({ ok: true, status: 201 }));
    await sharedBoard({ url: 'https://example.supabase.co', key: 'k', fetch: f }).submit({ id: 'a', name: 'Ann', stars: 7, finished: 3 });
    const { url, init } = f.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/scores?on_conflict=id');
    expect(init.method).toBe('POST');
    expect(init.headers.Prefer).toMatch(/resolution=merge-duplicates/);
    expect(JSON.parse(init.body)).toMatchObject({ id: 'a', name: 'Ann', stars: 7, finished: 3 });
  });

  it('shared online: says so when the table can\'t be reached', async () => {
    const f = fakeFetch(() => ({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(sharedBoard({ url: 'https://example.supabase.co', key: 'k', fetch: f }).top()).rejects.toThrow(/401/);
  });
});
