// The leaderboard: players ranked by stars, then by rooms finished (players.js).
//
// Two kinds, the same to the game:
//   - localBoard: everyone who has played on this computer (localStorage);
//   - sharedBoard: everyone, everywhere, in a table online. It is a Supabase
//     table read and written through its REST API (PostgREST), set up as in
//     docs/leaderboard.md; harness/board-config.js turns it on.
// Both give top(n) and submit(entry). A shared board that can't be reached
// throws, and play.html falls back to the local one.
//
// No Three.js, no DOM; `fetch` can be handed in (the tests use a fake).

import { entryOf, rank, NAME_MAX } from './players.js';

/** This computer's players, best first. */
export function localBoard(players) {
  return {
    shared: false,
    async top(n = 10) { return rank(players.list().map(entryOf)).slice(0, n); },
    async submit() {}, // they are in it already
  };
}

/** A row from the table, as an entry, or null if it isn't one. */
function asEntry(row) {
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return { id: row.id, name: row.name.slice(0, NAME_MAX), stars: n(row.stars), finished: n(row.finished) };
}

/**
 * The shared board in a Supabase table:
 *   scores(id text primary key, name text, stars int, finished int, updated_at timestamptz)
 * @param {{url: string, key: string, table?: string, fetch?: typeof fetch, timeout?: number}} cfg
 *   url: the project's URL; key: its anon (public) key, never the service_role one
 */
export function sharedBoard({ url, key, table = 'scores', fetch: get = globalThis.fetch?.bind(globalThis), timeout = 8000 }) {
  const base = `${String(url).replace(/\/+$/, '')}/rest/v1/${table}`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await get(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout?.(timeout) });
    if (!res.ok) throw new Error(`leaderboard: ${res.status} ${res.statusText ?? ''}`.trim());
    return res;
  };
  return {
    shared: true,
    async top(n = 10) {
      const res = await call(`?select=id,name,stars,finished&order=stars.desc,finished.desc,name.asc&limit=${Math.max(1, Math.floor(n))}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rank(rows.map(asEntry).filter(Boolean)) : [];
    },
    /** This player's line, added or brought up to date (an upsert on the id). */
    async submit(entry) {
      const row = { id: entry.id, name: entry.name, stars: entry.stars, finished: entry.finished, updated_at: new Date().toISOString() };
      await call('?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
    },
  };
}
