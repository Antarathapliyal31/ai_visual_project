// Prop factories (Workstream B).
//
// Each factory builds a cannon-es body from the dimensions in tuning.js and
// returns it with a plain `visual` spec made from the same numbers, so D's
// renderer builds the mesh from the collider and the two can't disagree.
//
//   plate   low-sided convex cylinder, coarse collider (segments in tuning.js)
//   mug     tapered cylinder
//   book    box
//   lamp, pot       tapered cylinders (the room clusters)
//   pillow, clock, monitor, keyboard   boxes
//   ball            sphere
//
// Every collider is one convex shape: a row with `half` is a box, one with
// `sphere` a sphere, anything else a cylinder. Plates and mugs are single-shape Cylinder bodies, which
// is what A's fracture pre-cuts expect.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';
import { PROP, ALL } from '../core/groups.js';

/**
 * @typedef {{type: 'cylinder', radiusTop: number, radiusBottom: number, height: number}
 *   | {type: 'box', half: [number, number, number]}
 *   | {type: 'sphere', radius: number}} PropVisual
 * Local to the body (centred on its centre of mass), Y up. Same vocabulary as
 * the debris specs A's fracture hands out.
 *
 * @typedef {object} Prop
 * @property {string} kind            one of PROP_KINDS
 * @property {CANNON.Body} body
 * @property {string} material         name in the material table
 * @property {PropVisual} visual
 * @property {number} breakImpulse     N·s for fracture.register(); Infinity if it never breaks
 * @property {number} halfHeight       m, centre to resting face
 *
 * @typedef {object} PropOptions
 * @property {[number, number, number] | {x: number, y: number, z: number}} [position]  centre of mass
 * @property {[number, number, number] | {x: number, y: number, z: number}} [base]
 *   point on a surface; the prop is placed resting on it (overrides position)
 * @property {number} [rotY]           yaw, radians
 * @property {number} [gap=REST_GAP]   m left between the prop and `base`
 * @property {object} [dims]           overrides for this prop's tuning row
 * @property {string} [tag]            a label for the renderer (e.g. 'cushion'); no effect on physics
 */

export const PROP_KINDS = ['plate', 'mug', 'book', 'lamp', 'pot', 'pillow', 'clock', 'ball', 'monitor', 'keyboard'];

// Props are spawned 10 microns *into* what they rest on, about where the soft
// contacts settle anyway, so every contact exists on the very first step.
// With any positive gap a stack falls like an accordion: each prop drops one
// step longer than the one below it, and the top of a five-stack arrives at
// 0.4 m/s and 5 mm deep.
export const REST_GAP = -1e-5; // m

const vec = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);

function shapeFor(kind, d) {
  if (!PROP_KINDS.includes(kind)) throw new Error(`no prop factory for kind "${kind}"`);
  if (d.half) {
    return {
      shape: new CANNON.Box(new CANNON.Vec3(...d.half)),
      visual: { type: 'box', half: [...d.half] },
      halfHeight: d.half[1],
    };
  }
  if (d.sphere) {
    return { shape: new CANNON.Sphere(d.sphere), visual: { type: 'sphere', radius: d.sphere }, halfHeight: d.sphere };
  }
  const radiusTop = d.radiusTop ?? d.radius, radiusBottom = d.radiusBottom ?? d.radius;
  return {
    shape: new CANNON.Cylinder(radiusTop, radiusBottom, d.height, d.segments),
    visual: { type: 'cylinder', radiusTop, radiusBottom, height: d.height },
    halfHeight: d.height / 2,
  };
}

/**
 * Build one prop. The body is not added to a world; physics.spawn() does both.
 * @param {string} kind  one of PROP_KINDS
 * @param {PropOptions} [opts]
 * @param {{materials: ReturnType<import('./materials.js').createMaterialTable>, tuning?: object}} ctx
 * @returns {Prop}
 */
export function buildProp(kind, opts = {}, ctx) {
  const tuning = ctx.tuning ?? defaultTuning;
  const base = tuning.props[kind];
  if (!base) throw new Error(`no prop factory for kind "${kind}"`);
  const d = { ...base, ...opts.dims };
  const { shape, visual, halfHeight } = shapeFor(kind, d);
  const ph = tuning.physics;

  const body = new CANNON.Body({
    mass: d.mass,
    shape,
    material: ctx.materials.get(d.material),
    linearDamping: d.linearDamping,
    angularDamping: d.angularDamping,
    collisionFilterGroup: PROP,
    collisionFilterMask: ALL,
    allowSleep: true,
    sleepSpeedLimit: ph.sleepSpeedLimit,
    sleepTimeLimit: ph.sleepTimeLimit,
  });

  if (opts.base) {
    const b = vec(opts.base);
    body.position.set(b.x, b.y + halfHeight + (opts.gap ?? REST_GAP), b.z);
  } else if (opts.position) {
    const p = vec(opts.position);
    body.position.set(p.x, p.y, p.z);
  }
  if (opts.rotY) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), opts.rotY);
  // Moved by hand: cannon-es doesn't flag the AABB itself.
  body.aabbNeedsUpdate = true;
  body.updateAABB();

  body.userData = { kind, material: d.material, prop: true };
  if (opts.tag) body.userData.tag = opts.tag;
  return {
    kind,
    tag: opts.tag ?? null,
    body,
    material: d.material,
    visual,
    breakImpulse: ctx.materials.breakImpulse(d.material, d.breakScale ?? 1),
    halfHeight,
  };
}

/** True for props A's fracture can break (single-cylinder ceramic). */
export function isBreakable(prop) {
  return (prop.kind === 'plate' || prop.kind === 'mug') && Number.isFinite(prop.breakImpulse);
}

/**
 * Register a prop with A's fracture, break impulse from the material table.
 * @returns {boolean} whether it was registered
 */
export function registerBreakable(fracture, prop) {
  if (!isBreakable(prop)) return false;
  fracture.register(prop.body, { kind: prop.kind, breakImpulse: prop.breakImpulse });
  return true;
}

/**
 * Centre heights of `count` props stacked on a surface.
 * @param {number} surfaceY  top face of what the stack stands on
 * @param {number} halfHeight
 * @param {number} [gap=REST_GAP] m between neighbours at spawn
 */
export function stackHeights(surfaceY, halfHeight, count, gap = REST_GAP) {
  const ys = [];
  for (let i = 0; i < count; i++) ys.push(surfaceY + gap + halfHeight + i * (2 * halfHeight + gap));
  return ys;
}
