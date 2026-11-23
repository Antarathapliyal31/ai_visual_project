// Example rooms for the level designer's prompt: they show a model what a
// valid room looks like, with the new pieces used the way they work (the
// chair clear of the desk's crouch spot, open boxes facing a wall). They are
// not in the game; the game's rooms are the ones a model designed
// (catalog.js).
//
// These three were placed by hand in a Claude Code session and checked with
// validate.js (tests/levels/levels.test.js checks them too).

const BY_HAND = 'Claude Code (Claude Opus 5.5) by hand in a coding session, checked by validate.js';

export const EXAMPLE_LEVELS = [
  {
    id: 'dinner-party',
    name: 'Dinner party',
    blurb: 'The bed is under the north wall now, and a dining table with a tablecloth takes the middle of the room.',
    designedBy: BY_HAND,
    difficulty: 2,
    pieces: [
      { item: 'bed', wall: 'north', at: -1.9 },
      { item: 'nightstand', wall: 'north', at: -3.15 },
      { item: 'wallShelf', wall: 'north', at: -3.0 },
      { item: 'bookshelf', wall: 'west', at: -0.8 },
      { item: 'aquarium', wall: 'west', at: 1.2 },
      { item: 'windowSill', wall: 'north', at: -0.4 },
      { item: 'desk', wall: 'north', at: 1.9 },
      { item: 'chair', x: 2.35, z: -1.72 },
      { item: 'diningTable', x: 0.2, z: 0.6 },
      { item: 'armchair', x: 2.7, z: 1.6, turn: 2 },
      { item: 'catTree', x: 3.05, z: -0.4 },
      { item: 'cardboardBox', x: -2.4, z: 2.5, turn: 3 },
    ],
    cat: { x: 1.2, z: 2.2 },
  },
  {
    id: 'moving-day',
    name: 'Moving day',
    blurb: 'Half unpacked: a wardrobe, stacks of boxes, and open ones a cat can climb into.',
    designedBy: BY_HAND,
    difficulty: 4,
    pieces: [
      { item: 'bed', wall: 'west', at: 0.9 },
      { item: 'nightstand', wall: 'west', at: -0.4 },
      { item: 'wardrobe', wall: 'west', at: -1.6 },
      { item: 'desk', wall: 'north', at: 0.0 },
      { item: 'chair', x: 0.45, z: -1.72 },
      { item: 'windowSill', wall: 'north', at: 1.9 },
      { item: 'bookshelf', wall: 'north', at: 2.95 },
      { item: 'cardboardBox', x: 2.2, z: -0.6, turn: 1 },
      { item: 'cardboardBox', x: 1.4, z: 1.5, turn: 0 },
      { item: 'boxStack', x: 1.2, z: 0.2 },
      { item: 'boxStack', x: 2.9, z: 2.4 },
      { item: 'boxStack', x: -0.9, z: 2.5, turn: 1 },
    ],
    cat: { x: 0.2, z: 1.3 },
  },
  {
    id: 'reading-room',
    name: 'Reading room',
    blurb: 'Two armchairs and the couch round the coffee table, the desk and books along the north wall.',
    designedBy: BY_HAND,
    difficulty: 3,
    pieces: [
      { item: 'bed', wall: 'east', at: -1.6 },
      { item: 'nightstand', wall: 'east', at: 0.1 },
      { item: 'desk', wall: 'north', at: -2.1 },
      { item: 'chair', x: -1.65, z: -1.72 },
      { item: 'bookshelf', wall: 'north', at: 0.0 },
      { item: 'windowSill', wall: 'north', at: 1.0 },
      { item: 'wallShelf', wall: 'west', at: -0.6 },
      { item: 'couch', wall: 'west', at: 1.4 },
      { item: 'coffeeTable', x: -1.6, z: 1.4 },
      { item: 'armchair', x: -0.4, z: 0.9, turn: 2 },
      { item: 'armchair', x: -1.6, z: 2.5, turn: 1 },
      { item: 'catTree', x: 1.2, z: 2.4 },
    ],
    cat: { x: 0.6, z: 1.6 },
  },
];
