// The game's rooms after the original, in menu order: each one designed by a
// model with scripts/generate-level.mjs (a local model through Ollama by
// default), from the furniture inventory, and kept only once it passed
// validate.js. The script adds them between the markers below, with a
// comment saying which model made it, when, and on which round it passed;
// `designedBy` is what the menu shows.
//
// tests/levels/levels.test.js validates every room here and plays the owner
// through it.

export const DESIGNED_LEVELS = [
  // generated levels: begin
  // Generated 2026-11-22 by qwen3.5:9b (theme: an artist's studio: a big table in the middle and boxes of supplies), passed validate.js
  // on round 6: 6 hiding places, 21.1 m² open floor, difficulty 2.
  {
    id: 'artist-studio',
    name: 'Artist\'s studio',
    blurb: 'An artist\'s studio: a big table in the middle and boxes of supplies.',
    designedBy: 'qwen3.5:9b (a local model, through Ollama), checked by validate.js',
    pieces: [
      { item: 'bed', wall: 'west', at: 1.2 },
      { item: 'nightstand', wall: 'west', at: 2.6 },
      { item: 'wardrobe', wall: 'west', at: -1.4 },
      { item: 'desk', wall: 'north', at: 0.5 },
      { item: 'diningTable', x: 0, z: 0, turn: 0 },
      { item: 'cardboardBox', x: 2.8, z: -1.2, turn: 0 },
      { item: 'cardboardBox', x: -1, z: -1, turn: 0 },
      { item: 'armchair', x: 0.8, z: 1.6, turn: 2 },
      { item: 'catTree', x: 2.4, z: 0.9, turn: 0 },
      { item: 'bookshelf', wall: 'north', at: -2.5 },
      { item: 'windowSill', wall: 'north', at: 2.8 },
      { item: 'aquarium', wall: 'east', at: 0.5 },
      { item: 'chair', x: -0.6, z: -1.72, turn: 0 },
    ],
    cat: { x: -0.3, z: 1.8 },
  },
  // Generated 2026-11-22 by qwen3.5:9b (theme: a student flat the morning after a dinner party, plates everywhere), passed validate.js
  // on round 7: 6 hiding places, 18.4 m² open floor, difficulty 2.
  {
    id: 'student-flat-mess',
    name: 'Student flat the morning after a dinner party',
    blurb: 'A student flat: wardrobe, desk and dining table cluttered with plates.',
    designedBy: 'qwen3.5:9b (a local model, through Ollama), checked by validate.js',
    pieces: [
      { item: 'bed', wall: 'west', at: 0.5 },
      { item: 'nightstand', wall: 'south', at: 0.5 },
      { item: 'wardrobe', wall: 'north', at: -1.4 },
      { item: 'desk', wall: 'east', at: -1.4 },
      { item: 'diningTable', x: -0.2, z: 0.5, turn: 0 },
      { item: 'cardboardBox', x: 2, z: -0.5, turn: 0 },
      { item: 'cardboardBox', x: -2.4, z: 2.2, turn: 3 },
      { item: 'armchair', x: 1.6, z: 1.8, turn: 2 },
      { item: 'catTree', x: 2.5, z: 1.5, turn: 0 },
      { item: 'bookshelf', wall: 'north', at: 0 },
      { item: 'windowSill', wall: 'north', at: 2 },
      { item: 'aquarium', wall: 'east', at: 0.5 },
      { item: 'chair', x: 1, z: -0.8, turn: 0 },
      { item: 'couch', wall: 'west', at: -2.02 },
    ],
    cat: { x: 0.8, z: 0.4 },
  },
  // Generated 2026-11-22 by qwen3.5:9b (theme: a tidy, sparse bedroom where the hiding places are few and far apart), passed validate.js
  // on round 1: 3 hiding places, 28.4 m² open floor, difficulty 3.
  {
    id: 'sparse-bedroom',
    name: 'Sparse Bedroom',
    blurb: 'A tidy, sparse bedroom where the bed is on the north wall and hiding places are few and far apart.',
    designedBy: 'qwen3.5:9b (a local model, through Ollama), checked by validate.js',
    pieces: [
      { item: 'bed', wall: 'north', at: -0.5 },
      { item: 'nightstand', wall: 'west', at: 1.2 },
      { item: 'desk', wall: 'east', at: 0.8 },
      { item: 'armchair', x: -1.2, z: 0.5, turn: 2 },
      { item: 'catTree', x: -2.2, z: 0.2, turn: 0 },
    ],
    cat: { x: -0.3, z: -0.4 },
  },
  // Generated 2026-11-22 by qwen3.5:9b (theme: a cozy reading den: armchairs, lots of books, a soft corner to hide in), passed validate.js
  // on round 8: 7 hiding places, 19.4 m² open floor, difficulty 2.
  {
    id: 'reading-den',
    name: 'Cozy Reading Den',
    blurb: 'A quiet corner with armchairs and bookshelves where the cat can hide under soft seats.',
    designedBy: 'qwen3.5:9b (a local model, through Ollama), checked by validate.js',
    pieces: [
      { item: 'bed', wall: 'west', at: 2 },
      { item: 'nightstand', wall: 'west', at: -1 },
      { item: 'wardrobe', wall: 'north', at: -2.5 },
      { item: 'desk', wall: 'north', at: 0.5 },
      { item: 'diningTable', x: -0.2, z: 1.8, turn: 0 },
      { item: 'cardboardBox', x: 3, z: 1.25, turn: 0 },
      { item: 'cardboardBox', x: -2.2, z: -0.5, turn: 3 },
      { item: 'armchair', x: 0.6, z: 0.9, turn: 2 },
      { item: 'armchair', x: 2, z: 1.4, turn: 2 },
      { item: 'catTree', x: -2.8, z: 0.5, turn: 0 },
      { item: 'bookshelf', wall: 'north', at: 2.8 },
      { item: 'windowSill', wall: 'west', at: 0.6 },
      { item: 'aquarium', wall: 'east', at: -1 },
      { item: 'chair', x: -1.5, z: -1.72, turn: 0 },
    ],
    cat: { x: 0.8, z: 2.5 },
  },
  // generated levels: end
];
