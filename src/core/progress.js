// What stars are for: they open the harder rooms and new looks for the cat.
//
// A room keeps the most stars the player has won in it (up to 3: one for
// winning the night, one for each of its two missions); the total over all
// rooms decides what is open. Easy is open from the start; Medium and Hard
// open at tuning.game.unlock stars. `unlockAll` (play.html?unlock=all) opens
// everything, for graders and demos.
//
// The looks are data: the colours of each coat (catMesh.js paints with them)
// and the collars. No Three.js: runs headless.

export const COATS = [
  { id: 'tabby', name: 'Tabby', stars: 0, colors: { base: 0xa67f4f, back: 0x7f5f3b, dark: 0x33241a, light: 0xf0dfbf, ear: 0x8a6841, sheen: 0xf6dfb4 } },
  { id: 'ginger', name: 'Ginger', stars: 3, colors: { base: 0xd98a3e, back: 0xc06d28, dark: 0x8f4515, light: 0xf6e2c2, ear: 0xc77a35, sheen: 0xffe0b0 } },
  { id: 'grey', name: 'Grey', stars: 8, colors: { base: 0x8d8f94, back: 0x6f7176, dark: 0x3a3c40, light: 0xe6e4df, ear: 0x7d7f84, sheen: 0xe8e8f0 } },
  { id: 'black', name: 'Black', stars: 14, colors: { base: 0x27231f, back: 0x1e1b18, dark: 0x100e0c, light: 0x2e2a26, ear: 0x221f1c, sheen: 0x8a8a9a } },
  { id: 'tuxedo', name: 'Tuxedo', stars: 22, colors: { base: 0x221f1c, back: 0x1a1816, dark: 0x0e0c0b, light: 0xf4f1ea, ear: 0x1e1b18, sheen: 0x9a9aaa } },
];

export const COLLARS = [
  { id: 'none', name: 'No collar', stars: 0 },
  { id: 'red', name: 'Red collar', stars: 5, color: 0xc8362e },
  { id: 'bell', name: 'Blue collar with a bell', stars: 12, color: 0x2f5fb5, bell: true },
];

/** All the stars won: the best of each room, added up. */
export function totalStars(best) {
  return Object.values(best ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** Stars still needed to open a difficulty (0 when it is open). */
export function starsToOpen(tier, stars, unlock) {
  return tier === 'easy' ? 0 : Math.max(0, (unlock[tier] ?? 0) - stars);
}

/** Is this difficulty open? */
export function tierOpen(tier, stars, unlock, { unlockAll = false } = {}) {
  return unlockAll || starsToOpen(tier, stars, unlock) === 0;
}

/** Is this coat or collar open? */
export function lookOpen(look, stars, { unlockAll = false } = {}) {
  return unlockAll || stars >= look.stars;
}

/**
 * What opened between two star totals, in the player's words.
 * @returns {string[]}  e.g. ['Medium rooms', 'Ginger coat']
 */
export function newlyUnlocked(before, after, unlock) {
  const out = [];
  for (const [tier, need] of Object.entries(unlock)) {
    if (before < need && after >= need) out.push(`${tier[0].toUpperCase()}${tier.slice(1)} rooms`);
  }
  for (const c of COATS) if (c.stars && before < c.stars && after >= c.stars) out.push(`${c.name} coat`);
  for (const c of COLLARS) if (c.stars && before < c.stars && after >= c.stars) out.push(c.name);
  return out;
}
