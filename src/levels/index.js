// Levels: the original room and the rooms built from the inventory.
//
// loadLevel() gives everything the game needs to play one:
//   boxes, occluders     the static room for createPhysicsWorld({ room })
//   hidingVolumes        where the cat can hide (hidingSpotAt, the owner's checks)
//   home                 where the owner sleeps, sits up, gets up and waits
//   waypoints, searchAnchors   where he walks and where he looks around
//   pieces               each piece and its transform, for the look
//   cat                  where the cat starts
//   spawnProps(physics)  the props
//
// The original level is special: it is played on A's constants and the
// hand-placed waypoints exactly as before, so nothing tested changes. Its
// description (ORIGINAL) is still written in the level format, and
// tests/levels/ checks that compiling it gives back A's room box for box.
//
// No Three.js: runs headless.

import { STATIC_BOXES, OCCLUDERS, HIDING_VOLUMES, ROOM } from '../collision/index.js';
import { WAYPOINTS } from '../ai/navigation.js';
import { BED_HEAD, BED_LIE, BED_SIT_EYE, IN_BED_FACING, BEDSIDE } from '../ai/home.js';
import { spawnRoomScene } from '../physics/roomScene.js';
import { INVENTORY } from './inventory.js';
import { compileLevel } from './compile.js';
import { spawnLevelProps } from './props.js';
import { DESIGNED_LEVELS } from './catalog.js';
import { EXAMPLE_LEVELS } from './examples.js';

const I = INVENTORY;
const wall = (id) => ({ item: id, wall: I[id].wall, at: I[id].canonicalAt });
const floor = (id) => ({ item: id, x: I[id].origin.x, z: I[id].origin.z, turn: 0 });

/** The original room, written as a level. */
export const ORIGINAL = {
  id: 'original',
  name: 'The original',
  blurb: 'The studio from the alpha: bed, desk, bookshelf and the couch corner.',
  designedBy: 'the team (by hand)',
  legacy: true,
  pieces: [
    wall('bed'), wall('nightstand'), wall('wallShelf'), wall('desk'), wall('windowSill'), wall('bookshelf'),
    wall('couch'), floor('coffeeTable'), wall('aquarium'), floor('chair'), floor('catTree'),
  ],
  cat: { x: 0.3, z: 0.9, heading: -0.6 },
};

/** Every level in the game, in menu order: the original, then the ones a model designed. */
export const LEVELS = [ORIGINAL, ...DESIGNED_LEVELS];

/** Rooms that show the level designer what a valid room looks like (not in the game). */
export { EXAMPLE_LEVELS };

/** The original level, on A's constants. */
function originalLevel(tuning) {
  const compiled = compileLevel(ORIGINAL, { tuning });
  return {
    ...compiled,
    legacy: true,
    boxes: STATIC_BOXES,
    occluders: OCCLUDERS,
    hidingVolumes: HIDING_VOLUMES,
    waypoints: WAYPOINTS,
    searchAnchors: undefined, // the owner's own (Antara's) anchors
    home: {
      ...compiled.home,
      head: BED_HEAD, lie: BED_LIE, sitEye: BED_SIT_EYE, facing: IN_BED_FACING,
      bedside: BEDSIDE, bedsideHeading: 0, waitLookAt: { x: 0, z: -1.0 },
    },
    decor: 'original',
    spawnProps: (physics) => spawnRoomScene(physics),
  };
}

/**
 * @param {object|string} specOrId  a level description, or a level's id
 * @param {{tuning?: object}} [opts]
 */
export function loadLevel(specOrId = ORIGINAL, opts = {}) {
  const spec = typeof specOrId === 'string' ? [...LEVELS, ...EXAMPLE_LEVELS].find((l) => l.id === specOrId) : specOrId;
  if (!spec) throw new Error(`no level "${specOrId}"`);
  if (spec.legacy) return originalLevel(opts.tuning);
  const level = compileLevel(spec, opts);
  level.spawnProps = (physics) => spawnLevelProps(physics, level);
  return level;
}

export { INVENTORY, ROOM };
export { compileLevel };
