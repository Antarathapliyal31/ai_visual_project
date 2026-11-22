// The furniture a level is built from.
//
// Every piece is defined where it stands in the original room (its
// "canonical" placement): the original pieces are A's boxes, occluders and
// hiding volumes from staticGeometry.js, unchanged. A level places a piece by
// moving it and turning it in quarter turns from there, so its colliders, its
// hiding place, its look and its props all move together (compile.js).
//
//   mount 'wall'   stands with its back against a wall: placed by wall + `at`
//   mount 'floor'  free-standing: placed by centre x, z and quarter turns
//   visibleWall    only on the north or west wall: tall pieces would hide the
//                  room from the camera, and the window and the wall shelf
//                  need a wall that is drawn
//
// The new pieces add hiding places of different kinds: under a dining table's
// short tablecloth (hidden from a standing look, found from a crouch), under a
// skirted armchair (safe even from a crouch, like the bed), inside an open
// cardboard box (found only from in front of it), and a wardrobe that blocks
// his line of sight.
//
// No Three.js: data only, runs headless.

import { STATIC_BOXES, OCCLUDERS, HIDING_VOLUMES, ROOM } from '../collision/index.js';
import { BED_HEAD, BED_LIE, BED_SIT_EYE, IN_BED_FACING, BEDSIDE } from '../ai/home.js';

/** The room's shell: in every level, never part of a piece. */
export const SHELL_IDS = ['floor', 'wallWest', 'wallNorth', 'boundaryEast', 'boundarySouth'];

const pick = (list, ids) => ids.map((id) => {
  const b = list.find((s) => s.id === id);
  if (!b) throw new Error(`no static box "${id}" in the original room`);
  return b;
});
const startsWith = (prefix) => STATIC_BOXES.filter((b) => b.id.startsWith(prefix)).map((b) => b.id);
const solid = (id, center, half, material, extra = {}) => ({ id, center, half, material, role: 'solid', ...extra });
const occluder = (id, center, half, material = 'fabric') => ({ id, center, half, material, role: 'occluder' });

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} name
 * @property {string} about        one line for the level designer (the LLM prompt)
 * @property {'wall'|'floor'} mount
 * @property {'north'|'west'} [wall] the wall it stands against in its canonical placement
 * @property {boolean} [visibleWall]
 * @property {number} [maxCount=1]
 * @property {object[]} boxes      canonical solid boxes (world coordinates)
 * @property {object[]} [occluders]
 * @property {object[]} [hiding]   canonical hiding volumes; `checks` lists places he can crouch to look in, best first
 * @property {object} [home]       the bed only: where the owner sleeps, sits and gets up
 */

/** @type {Record<string, Item>} */
const ITEMS = {
  // ------------------------------------------------- the original room's pieces
  bed: {
    id: 'bed', name: 'Bed',
    about: 'Double bed, 2.0 x 1.6 m, headboard against the wall. The owner sleeps in it. The skirt hides a cat underneath even when he crouches.',
    mount: 'wall', wall: 'west',
    boxes: pick(STATIC_BOXES, startsWith('bed')),
    occluders: pick(OCCLUDERS, ['bedSkirtFoot', 'bedSkirtFront', 'bedSkirtBack']),
    hiding: pick(HIDING_VOLUMES, ['underBed']).map((v) => ({ ...v, checks: [v.checkFrom] })),
    home: {
      head: BED_HEAD, lie: BED_LIE, sitEye: BED_SIT_EYE, facing: IN_BED_FACING,
      // Where he gets out: the north side first (the original room), else the south side.
      bedsides: [
        { at: BEDSIDE, heading: 0, lookAt: { x: 0, z: -1.0 } },
        { at: { x: BEDSIDE.x, z: 1.2 }, heading: 0, lookAt: { x: 0, z: 1.6 } },
      ],
    },
  },
  nightstand: {
    id: 'nightstand', name: 'Nightstand',
    about: 'Small bedside table, 0.5 x 0.5 m, 0.6 m high, with a lamp and an alarm clock on it.',
    mount: 'wall', wall: 'west',
    boxes: pick(STATIC_BOXES, ['nightstand']),
  },
  wallShelf: {
    id: 'wallShelf', name: 'Wall shelf',
    about: 'A 1 m shelf on the wall at 1.4 m (it takes no floor space), with books and a small plant.',
    mount: 'wall', wall: 'west', visibleWall: true,
    boxes: pick(STATIC_BOXES, ['wallShelf']),
  },
  desk: {
    id: 'desk', name: 'Desk',
    about: 'Desk, 2.4 x 0.8 m, with a stack of plates, mugs, a monitor and a lamp on it. The space under it is a hiding place the owner checks by crouching.',
    mount: 'wall', wall: 'north',
    boxes: pick(STATIC_BOXES, ['deskTop', 'deskSideLeft', 'deskPedestal', 'deskModesty']),
    hiding: pick(HIDING_VOLUMES, ['underDesk']).map((v) => ({ ...v, checks: [v.checkFrom] })),
  },
  windowSill: {
    id: 'windowSill', name: 'Window',
    about: 'A window with a sill and a potted plant; moonlight falls in at night.',
    mount: 'wall', wall: 'north', visibleWall: true,
    boxes: pick(STATIC_BOXES, ['windowSill']),
  },
  bookshelf: {
    id: 'bookshelf', name: 'Bookshelf',
    about: 'Tall bookshelf, 0.9 x 0.35 m and 2 m high, full of books, with a plant on top.',
    mount: 'wall', wall: 'north', visibleWall: true,
    boxes: pick(STATIC_BOXES, startsWith('bookshelf')),
  },
  couch: {
    id: 'couch', name: 'Couch',
    about: 'Leather couch, 1.8 m long and 0.9 m deep, back against the wall, with a cushion.',
    mount: 'wall', wall: 'west',
    boxes: pick(STATIC_BOXES, startsWith('couch')),
  },
  coffeeTable: {
    id: 'coffeeTable', name: 'Coffee table',
    about: 'Low table, 0.6 x 1.1 m, with a mug and books on it and on its shelf.',
    mount: 'floor',
    boxes: pick(STATIC_BOXES, startsWith('coffeeTable')),
  },
  aquarium: {
    id: 'aquarium', name: 'Aquarium',
    about: 'Fish tank on a cabinet, 1.2 x 0.5 m, 1.25 m high, against the wall.',
    mount: 'wall', wall: 'north',
    boxes: pick(STATIC_BOXES, startsWith('aquarium')),
  },
  chair: {
    id: 'chair', name: 'Desk chair',
    about: 'Office chair, 0.55 m across. Put it in front of the desk, leaving room to walk.',
    mount: 'floor',
    boxes: pick(STATIC_BOXES, startsWith('chair')),
  },
  catTree: {
    id: 'catTree', name: 'Cat tree',
    about: 'Cat tree, 0.6 x 0.6 m, with a cubby and a perch at 1 m.',
    mount: 'floor',
    boxes: pick(STATIC_BOXES, startsWith('catTree')),
  },

  // --------------------------------------------------------------- new pieces
  diningTable: {
    id: 'diningTable', name: 'Dining table',
    about: 'Table, 1.1 x 0.9 m, with a short tablecloth, plates and mugs. Under it is a hiding place: hidden from a standing look, but the owner finds the cat if he crouches beside it. Leave 1 m clear in front (the +z side at turn 0).',
    mount: 'floor', maxCount: 1,
    boxes: [
      solid('diningTableTop', [0, 0.74, 0], [0.55, 0.02, 0.45], 'wood'),
      ...[[-0.49, -0.39], [-0.49, 0.39], [0.49, -0.39], [0.49, 0.39]].map(([x, z], i) =>
        solid(`diningTableLeg${i}`, [x, 0.36, z], [0.025, 0.36, 0.025], 'wood')),
    ],
    // The cloth hangs to 30 cm above the floor: a crouched eye (20 cm) sees under it.
    occluders: [
      occluder('diningClothFront', [0, 0.52, 0.47], [0.57, 0.22, 0.005]),
      occluder('diningClothBack', [0, 0.52, -0.47], [0.57, 0.22, 0.005]),
      occluder('diningClothLeft', [-0.57, 0.52, 0], [0.005, 0.22, 0.47]),
      occluder('diningClothRight', [0.57, 0.52, 0], [0.005, 0.22, 0.47]),
    ],
    hiding: [{ id: 'underTable', min: [-0.5, 0, -0.4], max: [0.5, 0.7, 0.4], checks: [[0, 0, 1.15], [0, 0, -1.15], [1.25, 0, 0], [-1.25, 0, 0]] }],
  },
  armchair: {
    id: 'armchair', name: 'Armchair',
    about: 'Skirted armchair, 0.85 x 0.9 m. The cat can hide under it; the skirt hides it even when the owner crouches. Faces +x at turn 0.',
    mount: 'floor', maxCount: 2,
    boxes: [
      solid('armchairBack', [-0.32, 0.58, 0], [0.08, 0.28, 0.42], 'fabric'),
      solid('armchairSeat', [0.04, 0.38, 0], [0.32, 0.08, 0.32], 'fabric'),
      solid('armchairArmL', [0.04, 0.48, -0.36], [0.32, 0.12, 0.06], 'fabric'),
      solid('armchairArmR', [0.04, 0.48, 0.36], [0.32, 0.12, 0.06], 'fabric'),
      ...[[-0.33, -0.36], [-0.33, 0.36], [0.33, -0.36], [0.33, 0.36]].map(([x, z], i) =>
        solid(`armchairLeg${i}`, [x, 0.15, z], [0.025, 0.15, 0.025], 'wood')),
    ],
    occluders: [
      occluder('armchairSkirtFront', [0.37, 0.16, 0], [0.005, 0.14, 0.43]),
      occluder('armchairSkirtBack', [-0.41, 0.16, 0], [0.005, 0.14, 0.43]),
      occluder('armchairSkirtLeft', [-0.02, 0.16, -0.43], [0.39, 0.14, 0.005]),
      occluder('armchairSkirtRight', [-0.02, 0.16, 0.43], [0.39, 0.14, 0.005]),
    ],
    hiding: [{ id: 'underArmchair', min: [-0.36, 0, -0.38], max: [0.33, 0.28, 0.38], checks: [[1.0, 0, 0], [0, 0, 1.05], [0, 0, -1.05], [-1.1, 0, 0]] }],
  },
  cardboardBox: {
    id: 'cardboardBox', name: 'Open cardboard box',
    about: 'Moving box lying open on its side, 0.56 x 0.44 m, 0.4 m high: the cat can sit inside. The owner sees in only from in front of the opening (the +z side at turn 0).',
    mount: 'floor', maxCount: 3,
    boxes: [
      solid('boxTop', [0, 0.394, 0], [0.28, 0.006, 0.22], 'paper'),
      solid('boxBack', [0, 0.2, -0.214], [0.28, 0.194, 0.006], 'paper'),
      solid('boxLeft', [-0.274, 0.2, 0.003], [0.006, 0.194, 0.217], 'paper'),
      solid('boxRight', [0.274, 0.2, 0.003], [0.006, 0.194, 0.217], 'paper'),
    ],
    hiding: [{ id: 'inBox', min: [-0.26, 0, -0.2], max: [0.26, 0.38, 0.2], checks: [[0, 0, 0.95]] }],
  },
  boxStack: {
    id: 'boxStack', name: 'Stacked boxes',
    about: 'Two closed moving boxes stacked, 0.6 x 0.5 m and 0.66 m high: a step up for the cat and something to hide behind.',
    mount: 'floor', maxCount: 3,
    boxes: [
      solid('boxStackLow', [0, 0.2, 0], [0.3, 0.2, 0.25], 'paper'),
      solid('boxStackHigh', [0.03, 0.53, 0.01], [0.24, 0.13, 0.2], 'paper'),
    ],
  },
  wardrobe: {
    id: 'wardrobe', name: 'Wardrobe',
    about: 'Tall wardrobe, 1.0 x 0.6 m and 2 m high, against the wall. It blocks the owner\'s line of sight to whatever is behind it.',
    mount: 'wall', wall: 'north', visibleWall: true,
    boxes: [solid('wardrobeBody', [0, 1.0, -2.7], [0.5, 1.0, 0.3], 'wood')],
  },
};

// ------------------------------------------------------------- derived facts

/** The corners of a box's footprint on the floor, turned with it. */
export function footprintCorners(b) {
  const c = Math.cos(b.rotY ?? 0), s = Math.sin(b.rotY ?? 0);
  const [hx, , hz] = b.half;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => ({
    x: b.center[0] + x * c + z * s, z: b.center[2] - x * s + z * c,
  }));
}

/** Floor rectangle covering boxes (their turned footprints). */
export function footprint(boxes) {
  const pts = boxes.flatMap(footprintCorners);
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minZ = Math.min(...pts.map((p) => p.z)), maxZ = Math.max(...pts.map((p) => p.z));
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

const WALL_FACE = { west: ROOM.minX, east: ROOM.maxX, north: ROOM.minZ, south: ROOM.maxZ };

for (const item of Object.values(ITEMS)) {
  item.maxCount ??= 1;
  item.occluders ??= [];
  item.hiding ??= [];
  const fp = footprint([...item.boxes, ...item.occluders]);
  item.origin = { x: fp.cx, z: fp.cz };
  item.size = { w: fp.w, d: fp.d, h: Math.max(...item.boxes.map((b) => b.center[1] + b.half[1])) };
  item.tall = item.size.h > 1.3;
  if (item.mount === 'wall') {
    // How far its centre stands from the wall, and its length along the wall.
    item.depth = item.wall === 'west' ? fp.cx - WALL_FACE.west : fp.cz - WALL_FACE.north;
    item.length = item.wall === 'west' ? fp.d : fp.w;
    item.canonicalAt = item.wall === 'west' ? fp.cz : fp.cx;
  }
}

export const INVENTORY = ITEMS;
export const ITEM_IDS = Object.keys(ITEMS);
export { WALL_FACE };
