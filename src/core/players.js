// Players: everyone who plays on this computer, under the name they type in
// before playing. Each has their own stars (the best of each room, as
// progress.js counts them), so each opens the harder rooms and the cat's
// looks for themselves, and a leaderboard ranks them (board.js).
//
// A room with a star in it is a room finished: the first star is for winning
// the night, and missions only count on a won night.
//
// Each player has a random id as well as a name, so that two people with the
// same name on different computers stay apart on a shared board.
//
// No Three.js, no DOM: the storage is handed in (localStorage in play.html, a
// Map in the tests).

import { totalStars } from './progress.js';

export const NAME_MAX = 16;
const PLAYERS_KEY = 'loa.players', CURRENT_KEY = 'loa.player';

/** A name as typed, tidied: trimmed, inner spaces single, at most NAME_MAX characters. '' if nothing is left. */
export function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

const randomId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/**
 * @param {{get: (key: string) => any, set: (key: string, value: any) => void}} store  JSON values by key
 * @param {object} [opts]
 * @param {() => string} [opts.newId]
 * @param {Record<string, number> | null} [opts.legacyStars]  stars won before there were names: the first player gets them
 */
export function createPlayers(store, { newId = randomId, legacyStars = null } = {}) {
  let all = Array.isArray(store.get(PLAYERS_KEY)) ? store.get(PLAYERS_KEY) : [];
  let currentId = store.get(CURRENT_KEY) ?? null;
  const save = () => { store.set(PLAYERS_KEY, all); store.set(CURRENT_KEY, currentId); };
  const current = () => all.find((p) => p.id === currentId) ?? null;

  return {
    /** Who is playing now (null until a name is given). */
    get current() { return current(); },
    /** Everyone who has played here. */
    list: () => all.slice(),
    /**
     * Play as this name: the same player as before if the name has played here
     * (whatever its case), otherwise a new one. Null for a name with nothing in it.
     */
    choose(name) {
      const clean = cleanName(name);
      if (!clean) return null;
      let p = all.find((q) => q.name.toLowerCase() === clean.toLowerCase());
      if (!p) {
        p = { id: newId(), name: clean, stars: !all.length && legacyStars ? { ...legacyStars } : {} };
        all.push(p);
      } else p.name = clean; // their spelling of it this time
      currentId = p.id;
      save();
      return p;
    },
    /** A night ended in a room with these stars: the room keeps its best. Returns the player's stars. */
    record(roomId, stars) {
      const p = current();
      if (!p) return {};
      if (stars > (p.stars[roomId] ?? 0)) {
        p.stars = { ...p.stars, [roomId]: stars };
        save();
      }
      return p.stars;
    },
  };
}

/** A player's line on a leaderboard: total stars, and rooms finished (a night won in them). */
export function entryOf(p) {
  return { id: p.id, name: p.name, stars: totalStars(p.stars), finished: Object.values(p.stars ?? {}).filter((n) => n >= 1).length };
}

/** Best first: most stars, then most rooms finished, then by name. */
export function rank(entries) {
  return [...entries].sort((a, b) => b.stars - a.stars || b.finished - a.finished || a.name.localeCompare(b.name));
}
