// The rooms by difficulty, and which one to play next.
//
// Every room stores the difficulty validate.js measured for it, 1 (easy) to
// 5 (hard). The game groups them in three tiers, and after each round picks
// a room of the same tier the player has not played yet, at random. Once
// every room of a tier has been played, the tier starts over, though not
// with the room just played.
//
// No Three.js: runs headless.

export const TIERS = [
  { id: 'easy', name: 'Easy', blurb: 'Plenty of places to hide, close to the things you break.' },
  { id: 'medium', name: 'Medium', blurb: 'A few safe places, a little run from the plates.' },
  { id: 'hard', name: 'Hard', blurb: 'Few places to hide, far from the plates, and he sees a lot from bed.' },
];

/** The tier of a measured difficulty: 1-2 easy, 3 medium, 4-5 hard. */
export function tierOf(difficulty) {
  if (difficulty <= 2) return 'easy';
  if (difficulty === 3) return 'medium';
  return 'hard';
}

/** The rooms of a tier (a room without a stored difficulty counts as medium). */
export function roomsIn(tier, levels) {
  return levels.filter((l) => tierOf(l.difficulty ?? 3) === tier);
}

/**
 * The next room to play in a tier: one not played yet, at random.
 * @param {string} tier
 * @param {object[]} levels  every room in the game
 * @param {string[]} played  the ids of the rooms played so far
 * @param {{rng?: () => number, not?: string}} [opts]  not: the room just played, to avoid when starting over
 * @returns {{room: object|null, played: string[]}}  the room, and the played list to keep
 *   (without this tier's rooms when the tier starts over)
 */
export function nextRoom(tier, levels, played, { rng = Math.random, not } = {}) {
  const rooms = roomsIn(tier, levels);
  if (!rooms.length) return { room: null, played };
  let fresh = rooms.filter((r) => !played.includes(r.id));
  let keep = played;
  if (!fresh.length) {
    keep = played.filter((id) => !rooms.some((r) => r.id === id));
    fresh = rooms.length > 1 ? rooms.filter((r) => r.id !== not) : rooms;
  }
  return { room: fresh[Math.floor(rng() * fresh.length)], played: keep };
}
