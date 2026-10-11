// Static geometry store (Workstream A).
//
// Everything that never moves: the room shell and the furniture the props sit
// on. Built once into cannon-es STATIC bodies and never re-inserted per step;
// the grid broadphase bins these a single time.
//
// The same data drives the broadphase, the swept guard, C's hiding checks and
// (later) D's room meshes, so render and physics can't drift apart.
//
// Units m, Y up, origin at the floor centre. The room is a cut-away with two
// walls, laid out after docs/concept/ref3d.png:
//   west wall  (inner face x = -3.5): bed, nightstand, 2 cm wall shelf
//   north wall (inner face z = -3.0): desk, window sill, bookshelf
//
// No Three.js here: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { STATIC, ALL } from '../core/groups.js';

/**
 * @typedef {object} StaticBoxSpec
 * @property {string} id
 * @property {[number, number, number]} center  world position of the box centre
 * @property {[number, number, number]} half    half extents
 * @property {number} [rotY]                    rotation about Y, radians
 * @property {string} material                  material name for B's table
 * @property {'solid'|'occluder'} role          occluders block sight but not bodies
 * @property {boolean} [visible=true]            false: collider only, not rendered
 */

// Room extents, also handy for the overlay and for scenario spawns.
export const ROOM = { minX: -3.5, maxX: 3.5, minZ: -3.0, maxZ: 3.0, wallHeight: 2.8 };

/** @type {StaticBoxSpec[]} */
export const STATIC_BOXES = [
  // --- Shell ---
  { id: 'floor', center: [0, -0.05, 0], half: [3.5, 0.05, 3.0], material: 'wood', role: 'solid' },
  { id: 'wallWest', center: [-3.6, 1.4, 0], half: [0.1, 1.4, 3.0], material: 'plaster', role: 'solid' },
  { id: 'wallNorth', center: [-0.1, 1.4, -3.1], half: [3.6, 1.4, 0.1], material: 'plaster', role: 'solid' },
  // The cut-away sides have no wall to render, but props must not roll off
  // the edge of the floor. Invisible: D's renderer skips `visible: false`.
  { id: 'boundaryEast', center: [3.6, 1.4, 0], half: [0.1, 1.4, 3.0], material: 'plaster', role: 'solid', visible: false },
  { id: 'boundarySouth', center: [0, 1.4, 3.1], half: [3.7, 1.4, 0.1], material: 'plaster', role: 'solid', visible: false },

  // --- Bed (headboard on the west wall). Platform is raised so the cat can
  // crawl underneath; the skirt below hides it. ---
  { id: 'bedHeadboard', center: [-3.45, 0.55, -0.1], half: [0.05, 0.55, 0.8], material: 'wood', role: 'solid' },
  { id: 'bedPlatform', center: [-2.4, 0.39, -0.1], half: [1.0, 0.11, 0.8], material: 'wood', role: 'solid' },
  { id: 'bedMattress', center: [-2.4, 0.61, -0.1], half: [0.98, 0.11, 0.78], material: 'fabric', role: 'solid' },
  { id: 'bedLegHeadBack', center: [-3.37, 0.14, -0.87], half: [0.03, 0.14, 0.03], material: 'wood', role: 'solid' },
  { id: 'bedLegHeadFront', center: [-3.37, 0.14, 0.67], half: [0.03, 0.14, 0.03], material: 'wood', role: 'solid' },
  { id: 'bedLegFootBack', center: [-1.43, 0.14, -0.87], half: [0.03, 0.14, 0.03], material: 'wood', role: 'solid' },
  { id: 'bedLegFootFront', center: [-1.43, 0.14, 0.67], half: [0.03, 0.14, 0.03], material: 'wood', role: 'solid' },

  // --- Nightstand and the 2 cm wall shelf above it ---
  { id: 'nightstand', center: [-3.25, 0.3, -1.25], half: [0.25, 0.3, 0.25], material: 'wood', role: 'solid' },
  { id: 'wallShelf', center: [-3.35, 1.4, -1.3], half: [0.15, 0.01, 0.5], material: 'wood', role: 'solid' },

  // --- Desk on the north wall. Left end is a side panel, right end a drawer
  // pedestal; the front modesty panel leaves a 26 cm gap at the floor, enough
  // for the cat (B: keep its collider under 26 cm tall) and low enough that a
  // standing owner can't see under it from across the room. ---
  { id: 'deskTop', center: [0.6, 0.9, -2.6], half: [1.2, 0.04, 0.4], material: 'wood', role: 'solid' },
  { id: 'deskSideLeft', center: [-0.57, 0.43, -2.6], half: [0.03, 0.43, 0.38], material: 'wood', role: 'solid' },
  { id: 'deskPedestal', center: [1.48, 0.43, -2.61], half: [0.28, 0.43, 0.37], material: 'wood', role: 'solid' },
  { id: 'deskModesty', center: [0.33, 0.56, -2.22], half: [0.87, 0.30, 0.01], material: 'wood', role: 'solid' },

  // --- Window sill and bookshelf on the north wall ---
  { id: 'windowSill', center: [2.25, 0.95, -2.925], half: [0.3, 0.02, 0.075], material: 'wood', role: 'solid' },
  { id: 'bookshelfBack', center: [3.05, 1.0, -2.99], half: [0.45, 1.0, 0.01], material: 'wood', role: 'solid' },
  { id: 'bookshelfSideL', center: [2.62, 1.0, -2.815], half: [0.02, 1.0, 0.165], material: 'wood', role: 'solid' },
  { id: 'bookshelfSideR', center: [3.48, 1.0, -2.815], half: [0.02, 1.0, 0.165], material: 'wood', role: 'solid' },
  ...[0.015, 0.515, 1.015, 1.515, 1.985].map((y, i) => ({
    id: `bookshelfPanel${i}`, center: [3.05, y, -2.815], half: [0.41, 0.015, 0.165], material: 'wood', role: 'solid',
  })),
];

// Bed skirt: fabric hanging from the platform to 2 cm above the floor on the
// three open sides. The cat walks through it; the owner can't see through it.
/** @type {StaticBoxSpec[]} */
export const OCCLUDERS = [
  { id: 'bedSkirtFoot', center: [-1.395, 0.15, -0.1], half: [0.005, 0.13, 0.8], material: 'fabric', role: 'occluder' },
  { id: 'bedSkirtFront', center: [-2.4, 0.15, 0.705], half: [1.0, 0.13, 0.005], material: 'fabric', role: 'occluder' },
  { id: 'bedSkirtBack', center: [-2.4, 0.15, -0.905], half: [1.0, 0.13, 0.005], material: 'fabric', role: 'occluder' },
];

/**
 * Hiding volumes C checks. `checkFrom` is where the owner stands to crouch and
 * re-test sight into the volume.
 * @typedef {{id: string, min: [number, number, number], max: [number, number, number], checkFrom: [number, number, number]}} HidingVolume
 * @type {HidingVolume[]}
 */
export const HIDING_VOLUMES = [
  { id: 'underBed', min: [-3.34, 0, -0.84], max: [-1.46, 0.28, 0.64], checkFrom: [-1.0, 0, -0.1] },
  { id: 'underDesk', min: [-0.54, 0, -2.98], max: [1.2, 0.86, -2.23], checkFrom: [0.33, 0, -1.6] },
];

// Named heights B's prop layout spawns on (top faces, y in m).
export const SURFACES = {
  floor: 0,
  bedTop: 0.72,
  nightstandTop: 0.6,
  wallShelfTop: 1.41,
  deskTop: 0.94,
  windowSillTop: 0.97,
  bookshelfShelves: [0.03, 0.53, 1.03, 1.53],
  bookshelfTop: 2.0,
};

const defaultMaterials = new Map();
/** Cached cannon material per name, used until B's material table exists. */
export function defaultMaterialFor(name) {
  if (!defaultMaterials.has(name)) defaultMaterials.set(name, new CANNON.Material(name));
  return defaultMaterials.get(name);
}

/**
 * Create one STATIC box body from a spec. Exported so scenarios can add
 * isolated geometry (e.g. the tunneling shelf) with the same conventions.
 * @param {StaticBoxSpec} spec
 */
export function makeStaticBox(spec, materialFor = defaultMaterialFor) {
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(...spec.half)),
    position: new CANNON.Vec3(...spec.center),
    material: materialFor(spec.material),
    collisionFilterGroup: STATIC,
    collisionFilterMask: ALL,
  });
  if (spec.rotY) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spec.rotY);
  if (spec.role === 'occluder') {
    // Never pairs in the broadphase (mask 0) and never pushes anything, but
    // raycast() still hits it because rays test the body's group only.
    body.collisionResponse = false;
    body.collisionFilterMask = 0;
  }
  body.userData = { staticId: spec.id, role: spec.role };
  body.updateAABB();
  return body;
}

/**
 * Add the whole static room to a world, once.
 * @param {CANNON.World} world
 * @param {{materialFor?: (name: string) => CANNON.Material, boxes?: StaticBoxSpec[], occluders?: StaticBoxSpec[]}} [opts]
 * @returns {{bodies: CANNON.Body[], byId: Map<string, CANNON.Body>, solids: CANNON.Body[], occluders: CANNON.Body[]}}
 */
export function buildStaticGeometry(world, opts = {}) {
  const { materialFor = defaultMaterialFor, boxes = STATIC_BOXES, occluders = OCCLUDERS } = opts;
  if (world.__staticGeometry) return world.__staticGeometry; // built once per world

  const byId = new Map();
  const solids = [];
  const occluderBodies = [];
  for (const spec of [...boxes, ...occluders]) {
    const body = makeStaticBox(spec, materialFor);
    world.addBody(body);
    byId.set(spec.id, body);
    (spec.role === 'occluder' ? occluderBodies : solids).push(body);
  }
  const result = { bodies: [...solids, ...occluderBodies], byId, solids, occluders: occluderBodies };
  world.__staticGeometry = result;
  return result;
}

/** True for static bodies that physically block motion (not occluders). */
export function isSolidStatic(body) {
  return body.type === CANNON.Body.STATIC && body.collisionResponse && body.collisionFilterMask !== 0;
}
