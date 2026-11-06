// Fracture for mugs and plates (Workstream A).
//
// Each breakable has 2-4 pre-cut pieces. When an ImpactEvent's impulse passes
// the body's break impulse, the body is swapped for its pieces. Every piece
// keeps the parent's orientation and angular velocity, and gets the parent's
// linear velocity plus the spin at its own offset (v + w x r), so the break
// conserves the momentum of the parent.
//
//   plate -> 3 wedges (120 degree sectors)
//   mug   -> 2 half shells + the base
//
// Pieces are shrunk slightly about their own centres so they never spawn
// overlapping each other, and they join the DEBRIS group.
//
// IMPORTANT: call flush() *after* world.step() returns, never from inside a
// cannon-es step event. cannon's post-step sleep loop indexes world.bodies
// with a count taken before the event, so removing a body inside postStep
// crashes it.
//
// No Three.js: onBroken hands D's renderer plain shape specs to build meshes.

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';
import { DEBRIS, CAT, ALL } from '../core/groups.js';

/**
 * @typedef {object} ImpactEvent  (D's harvester -> noise, score, fracture)
 * @property {CANNON.Body} bodyA
 * @property {CANNON.Body} bodyB
 * @property {number} impulse      N·s
 * @property {{x,y,z}} [point]
 * @property {{x,y,z}} [normal]
 * @property {string} [matA]
 * @property {string} [matB]
 */

/**
 * @typedef {{type: 'prism', polygon: [number, number][], halfHeight: number}
 *   | {type: 'box', half: [number, number, number]}
 *   | {type: 'cylinder', radius: number, height: number}} PieceShapeSpec
 * Local to the piece body (centred on its centre of mass), Y up.
 */

// --------------------------------------------------------------- pre-cuts

/** Signed area and centroid of a 2D polygon (x, z). */
function polygonCentroid(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  a *= 0.5;
  return { area: Math.abs(a), x: cx / (6 * a), z: cz / (6 * a) };
}

/** Convex prism along Y from a convex polygon in XZ, faces wound outward. */
export function makePrism(polygon, halfHeight) {
  const n = polygon.length;
  const vertices = [];
  for (const [x, z] of polygon) vertices.push(new CANNON.Vec3(x, -halfHeight, z));
  for (const [x, z] of polygon) vertices.push(new CANNON.Vec3(x, halfHeight, z));
  const faces = [[...Array(n).keys()], [...Array(n).keys()].map((i) => i + n)];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, j + n, i + n]);
  }
  // Orient every face so its normal points away from the prism's centre.
  const centre = vertices.reduce((c, v) => c.vadd(v), new CANNON.Vec3()).scale(1 / vertices.length);
  for (const f of faces) {
    const [a, b, c] = f.map((k) => vertices[k]);
    const normal = b.vsub(a).cross(c.vsub(a));
    const fc = f.reduce((s, k) => s.vadd(vertices[k]), new CANNON.Vec3()).scale(1 / f.length);
    if (normal.dot(fc.vsub(centre)) < 0) f.reverse();
  }
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

/**
 * Pre-cut pieces in the parent's local frame.
 * @returns {{offset: CANNON.Vec3, shape: CANNON.Shape, volume: number, spec: PieceShapeSpec}[]}
 */
export function precut(kind, parentShape, shrink) {
  if (kind === 'plate') {
    const r = Math.max(parentShape.radiusTop, parentShape.radiusBottom);
    const h = parentShape.height;
    const pieces = [];
    const arcSegments = 3;
    for (let k = 0; k < 3; k++) {
      const a0 = (k * 2 * Math.PI) / 3;
      const poly = [[0, 0]];
      for (let s = 0; s <= arcSegments; s++) {
        const a = a0 + ((2 * Math.PI) / 3) * (s / arcSegments);
        poly.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      // Recentre on the wedge's centroid, then shrink about it.
      const c = polygonCentroid(poly);
      const local = poly.map(([x, z]) => [(x - c.x) * shrink, (z - c.z) * shrink]);
      pieces.push({
        offset: new CANNON.Vec3(c.x, 0, c.z),
        shape: makePrism(local, (h / 2) * shrink),
        volume: c.area * h,
        spec: { type: 'prism', polygon: local, halfHeight: (h / 2) * shrink },
      });
    }
    return pieces;
  }

  if (kind === 'mug') {
    const r = (parentShape.radiusTop + parentShape.radiusBottom) / 2;
    const h = parentShape.height;
    const shellHalf = [(r / 2) * shrink, 0.4 * h * shrink, r * shrink];
    const baseR = parentShape.radiusBottom * shrink;
    const baseH = 0.2 * h * shrink;
    const shellVol = r * (0.8 * h) * (2 * r);
    const baseVol = Math.PI * parentShape.radiusBottom ** 2 * 0.2 * h;
    return [
      ...[-1, 1].map((side) => ({
        offset: new CANNON.Vec3(side * (r / 2), 0.1 * h, 0),
        shape: new CANNON.Box(new CANNON.Vec3(...shellHalf)),
        volume: shellVol,
        spec: { type: 'box', half: shellHalf },
      })),
      {
        offset: new CANNON.Vec3(0, -0.4 * h, 0),
        shape: new CANNON.Cylinder(baseR, baseR, baseH, 8),
        volume: baseVol,
        spec: { type: 'cylinder', radius: baseR, height: baseH },
      },
    ];
  }

  throw new Error(`no pre-cut pieces for kind "${kind}"`);
}

// ---------------------------------------------------------------- runtime

/**
 * @param {CANNON.World} world
 * @param {{tuning?: object, onBroken?: (info: {parent: CANNON.Body, kind: string, impact: ImpactEvent, pieces: {body: CANNON.Body, spec: PieceShapeSpec}[]}) => void}} [opts]
 */
export function createFracture(world, opts = {}) {
  const cfg = opts.tuning ?? defaultTuning.collision.fracture;
  const registry = new Map(); // body -> {kind, breakImpulse}
  const queued = new Map();   // body -> ImpactEvent
  const stats = { broken: 0, pieces: 0 };

  /**
   * Make a body breakable.
   * @param {CANNON.Body} body  single-shape Cylinder body (mug or plate)
   * @param {{kind: 'mug'|'plate', breakImpulse?: number}} info  breakImpulse in N·s,
   *   normally from B's material table
   */
  function register(body, { kind, breakImpulse }) {
    const shape = body.shapes[0];
    if (!(shape instanceof CANNON.Cylinder)) throw new Error('fracture expects a Cylinder collider');
    registry.set(body, { kind, breakImpulse: breakImpulse ?? cfg.defaultBreakImpulse[kind] });
  }

  function unregister(body) {
    registry.delete(body);
    queued.delete(body);
  }

  /**
   * Feed every ImpactEvent here. Each body breaks at most once. Unless
   * tuning says `breakOnCat`, the cat's own contacts never break anything:
   * at 3 kg it would shatter every plate it walked into.
   */
  function onImpact(event) {
    for (const b of [event.bodyA, event.bodyB]) {
      const entry = registry.get(b);
      if (!entry || queued.has(b)) continue;
      const other = b === event.bodyA ? event.bodyB : event.bodyA;
      if (!cfg.breakOnCat && other && (other.collisionFilterGroup & CAT)) continue;
      if (event.impulse >= entry.breakImpulse) queued.set(b, event);
    }
  }

  /** Swap queued bodies for their pieces. Call between steps. */
  function flush() {
    const results = [];
    for (const [parent, impact] of queued) {
      const entry = registry.get(parent);
      registry.delete(parent);
      if (!entry || !world.bodies.includes(parent)) continue;
      results.push(breakBody(parent, entry.kind, impact));
    }
    queued.clear();
    return results;
  }

  function breakBody(parent, kind, impact) {
    const cuts = precut(kind, parent.shapes[0], cfg.shrink);
    const totalVolume = cuts.reduce((s, c) => s + c.volume, 0);
    const v = parent.velocity, w = parent.angularVelocity, q = parent.quaternion;

    const pieces = cuts.map((cut) => {
      const r = q.vmult(cut.offset);           // offset in world frame
      const body = new CANNON.Body({
        mass: parent.mass * (cut.volume / totalVolume),
        shape: cut.shape,
        material: parent.material,
        linearDamping: parent.linearDamping,
        angularDamping: parent.angularDamping,
        collisionFilterGroup: DEBRIS,
        collisionFilterMask: ALL,
      });
      body.position.copy(parent.position.vadd(r));
      body.quaternion.copy(q);
      body.velocity.copy(v.vadd(w.cross(r)));  // v + w x r
      body.angularVelocity.copy(w);
      body.userData = { debrisOf: kind };
      body.aabbNeedsUpdate = true;
      return { body, spec: cut.spec };
    });

    world.removeBody(parent);
    for (const p of pieces) world.addBody(p.body);
    stats.broken++;
    stats.pieces += pieces.length;

    const info = { parent, kind, impact, pieces };
    opts.onBroken?.(info);
    return info;
  }

  return { register, unregister, onImpact, flush, stats, isBreakable: (b) => registry.has(b) };
}
