// Ray queries (Workstream A).
//
// Contract: raycast(origin, dir, maxDist, mask) -> {hit, distance, point, normal, body}
// Used by B (ledge / ground checks), C (owner sight) and the overlay.
//
//  - rayVsAABB: the slab test.
//  - rayVsBox: the ray is moved into the box's frame (inverse rotation), then
//    slab-tested, and the hit normal is rotated back out.
//  - raycast walks the uniform grid cell by cell along the ray (3D DDA,
//    Amanatides & Woo) and stops as soon as the best hit is nearer than the
//    next cell boundary, so far-away bodies are never touched.
//
// Semantics match cannon-es world.raycastClosest: if the origin is inside a
// box, the exit face is reported. The mask is tested against the body's
// collisionFilterGroup only, so occluders (mask 0, no collision response)
// still block rays.

import * as CANNON from 'cannon-es';
import { UniformGridBroadphase, GRID_INDEX_LIMIT } from './gridBroadphase.js';

const EPS = 1e-12;
const AXES = ['x', 'y', 'z'];

/**
 * Slab test of a ray against an axis-aligned box.
 * `d` must be normalised; `t` is then a distance.
 * @returns {{t: number, axis: number, sign: number} | null} hit distance and the
 *   outward normal of the face hit (axis index and sign).
 */
export function rayVsAABB(o, d, min, max, maxDist = Infinity) {
  let tNear = -Infinity, tFar = Infinity;
  let nearAxis = -1, nearSign = 0, farAxis = -1, farSign = 0;
  for (let a = 0; a < 3; a++) {
    const k = AXES[a];
    const oi = o[k], di = d[k];
    const lo = Array.isArray(min) ? min[a] : min[k];
    const hi = Array.isArray(max) ? max[a] : max[k];
    if (Math.abs(di) < EPS) {
      if (oi < lo || oi > hi) return null; // parallel and outside this slab
      continue;
    }
    const inv = 1 / di;
    const tLo = (lo - oi) * inv, tHi = (hi - oi) * inv;
    // Entering through the lo face if moving +, through the hi face if moving -.
    const tEnter = di > 0 ? tLo : tHi;
    const tExit = di > 0 ? tHi : tLo;
    if (tEnter > tNear) { tNear = tEnter; nearAxis = a; nearSign = di > 0 ? -1 : 1; }
    if (tExit < tFar) { tFar = tExit; farAxis = a; farSign = di > 0 ? 1 : -1; }
    if (tNear > tFar) return null;
  }
  if (tFar < 0) return null; // box is behind the ray
  if (tNear >= 0) return tNear <= maxDist ? { t: tNear, axis: nearAxis, sign: nearSign } : null;
  // Origin inside: report the exit face (cannon-es does the same).
  return tFar <= maxDist ? { t: tFar, axis: farAxis, sign: farSign } : null;
}

// --- small quaternion helpers on plain {x,y,z,w} / {x,y,z} ---------------

function rotate(q, v, out) {
  // out = q * v * q^-1
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x, y, z } = v;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

function rotateInverse(q, v, out) {
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v, out);
}

/**
 * Ray against an oriented box.
 * @param o ray origin (world)
 * @param d normalised ray direction (world)
 * @param center box centre (world)
 * @param quat box orientation (world)
 * @param half half extents {x,y,z}
 * @returns {{t: number, normal: {x,y,z}} | null}
 */
export function rayVsBox(o, d, center, quat, half, maxDist = Infinity) {
  const rel = { x: o.x - center.x, y: o.y - center.y, z: o.z - center.z };
  const lo = rotateInverse(quat, rel, {});
  const ld = rotateInverse(quat, d, {});
  const hit = rayVsAABB(lo, ld, { x: -half.x, y: -half.y, z: -half.z }, half, maxDist);
  if (!hit) return null;
  const n = { x: 0, y: 0, z: 0 };
  n[AXES[hit.axis]] = hit.sign;
  return { t: hit.t, normal: rotate(quat, n, {}) };
}

/** Ray against a sphere. Origin inside reports the exit point. */
export function rayVsSphere(o, d, center, radius, maxDist = Infinity) {
  const mx = o.x - center.x, my = o.y - center.y, mz = o.z - center.z;
  const b = mx * d.x + my * d.y + mz * d.z;
  const c = mx * mx + my * my + mz * mz - radius * radius;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq; // inside
  if (t < 0 || t > maxDist) return null;
  const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
  const nx = (px - center.x) / radius, ny = (py - center.y) / radius, nz = (pz - center.z) / radius;
  return { t, normal: { x: nx, y: ny, z: nz } };
}

/** Ray against an infinite plane (cannon-es planes face local +Z). */
export function rayVsPlane(o, d, position, quat, maxDist = Infinity) {
  const n = rotate(quat, { x: 0, y: 0, z: 1 }, {});
  const denom = n.x * d.x + n.y * d.y + n.z * d.z;
  if (Math.abs(denom) < EPS) return null;
  const t = (n.x * (position.x - o.x) + n.y * (position.y - o.y) + n.z * (position.z - o.z)) / denom;
  if (t < 0 || t > maxDist) return null;
  return { t, normal: n };
}

// ------------------------------------------------------------------------

/**
 * @typedef {object} RaycastHit
 * @property {boolean} hit
 * @property {number} distance   m from origin (Infinity when no hit)
 * @property {CANNON.Vec3} point
 * @property {CANNON.Vec3} normal outward surface normal at the hit
 * @property {CANNON.Body | null} body
 */

/**
 * Build the raycast() function for a world. It always uses the world's current
 * broadphase: the grid walk when it's a UniformGridBroadphase, otherwise an
 * aabbQuery over the ray's bounding box.
 * @param {CANNON.World} world
 */
export function createRaycaster(world) {
  const fallbackRay = new CANNON.Ray();
  const fallbackResult = new CANNON.RaycastResult();
  const qi = new CANNON.Quaternion();
  const xi = new CANNON.Vec3();
  let stamp = 0;

  /** Closest hit of the ray against one body's shapes, or null. */
  function testBody(body, o, d, maxDist) {
    let best = null;
    for (let i = 0; i < body.shapes.length; i++) {
      const shape = body.shapes[i];
      body.quaternion.mult(body.shapeOrientations[i], qi);
      body.quaternion.vmult(body.shapeOffsets[i], xi);
      xi.vadd(body.position, xi);
      let h = null;
      switch (shape.type) {
        case CANNON.Shape.types.BOX:
          h = rayVsBox(o, d, xi, qi, shape.halfExtents, maxDist);
          break;
        case CANNON.Shape.types.SPHERE:
          h = rayVsSphere(o, d, xi, shape.radius, maxDist);
          break;
        case CANNON.Shape.types.PLANE:
          h = rayVsPlane(o, d, xi, qi, maxDist);
          break;
        default:
          h = cannonShapeHit(shape, body, o, d, maxDist);
      }
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  /** Cylinders and other convex shapes: defer to cannon-es for that one shape. */
  function cannonShapeHit(shape, body, o, d, maxDist) {
    fallbackRay.from.set(o.x, o.y, o.z);
    fallbackRay.to.set(o.x + d.x * maxDist, o.y + d.y * maxDist, o.z + d.z * maxDist);
    fallbackRay.updateDirection();
    fallbackRay.mode = CANNON.Ray.CLOSEST;
    fallbackRay.skipBackfaces = false;
    fallbackRay.result = fallbackResult;
    fallbackResult.reset();
    fallbackRay.intersectShape(shape, qi, xi, body);
    if (!fallbackResult.hasHit) return null;
    const n = fallbackResult.hitNormalWorld;
    return { t: fallbackResult.distance, normal: { x: n.x, y: n.y, z: n.z } };
  }

  /**
   * @param {{x,y,z}} origin
   * @param {{x,y,z}} dir      any length; normalised here
   * @param {number} maxDist   m
   * @param {number} [mask=-1] collision groups the ray can hit
   * @param {{skip?: CANNON.Body | CANNON.Body[]}} [opts]
   * @returns {RaycastHit}
   */
  return function raycast(origin, dir, maxDist, mask = -1, opts = {}) {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const miss = { hit: false, distance: Infinity, point: new CANNON.Vec3(), normal: new CANNON.Vec3(), body: null };
    if (!(len > 0) || !(maxDist > 0)) return miss;
    const o = { x: origin.x, y: origin.y, z: origin.z };
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const skip = opts.skip ? new Set(Array.isArray(opts.skip) ? opts.skip : [opts.skip]) : null;

    const myStamp = ++stamp;
    let best = null, bestBody = null;
    const consider = (body) => {
      if (body.__rayStamp === myStamp) return;
      body.__rayStamp = myStamp;
      if ((body.collisionFilterGroup & mask) === 0) return;
      if (skip && skip.has(body)) return;
      const limit = best ? best.t : maxDist;
      const h = testBody(body, o, d, limit);
      if (h && (!best || h.t < best.t)) { best = h; bestBody = body; }
    };

    const bp = world.broadphase;
    if (bp instanceof UniformGridBroadphase) {
      bp.ensureBinned(world);
      for (const b of bp.staticOversize) consider(b);
      for (const b of bp.dynamicOversize) consider(b);
      walkGrid(bp, o, d, maxDist, (statics, dynamics, tExit) => {
        if (statics) for (let i = 0; i < statics.length; i++) consider(statics[i]);
        if (dynamics) for (let i = 0; i < dynamics.length; i++) consider(dynamics[i]);
        // Bodies not seen yet lie only in cells further along the ray.
        return best !== null && best.t <= tExit;
      });
    } else {
      const aabb = new CANNON.AABB();
      const e = { x: o.x + d.x * maxDist, y: o.y + d.y * maxDist, z: o.z + d.z * maxDist };
      aabb.lowerBound.set(Math.min(o.x, e.x), Math.min(o.y, e.y), Math.min(o.z, e.z));
      aabb.upperBound.set(Math.max(o.x, e.x), Math.max(o.y, e.y), Math.max(o.z, e.z));
      for (const b of bp.aabbQuery(world, aabb, [])) consider(b);
    }

    if (!best) return miss;
    return {
      hit: true,
      distance: best.t,
      point: new CANNON.Vec3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t),
      normal: new CANNON.Vec3(best.normal.x, best.normal.y, best.normal.z),
      body: bestBody,
    };
  };
}

/**
 * Visit grid cells along a ray in order. `visit(statics, dynamics, tExit)`
 * returns true to stop early. tExit is the distance at which the ray leaves
 * the current cell.
 */
export function walkGrid(grid, o, d, maxDist, visit) {
  const s = grid.cellSize;
  const inv = grid.invCellSize;
  let ix = Math.floor(o.x * inv), iy = Math.floor(o.y * inv), iz = Math.floor(o.z * inv);
  const stepX = d.x > 0 ? 1 : d.x < 0 ? -1 : 0;
  const stepY = d.y > 0 ? 1 : d.y < 0 ? -1 : 0;
  const stepZ = d.z > 0 ? 1 : d.z < 0 ? -1 : 0;
  // Distance along the ray to the first boundary on each axis, and per cell.
  const next = (i, step, oi, di) => (step === 0 ? Infinity : (((step > 0 ? i + 1 : i) * s) - oi) / di);
  let tMaxX = next(ix, stepX, o.x, d.x), tMaxY = next(iy, stepY, o.y, d.y), tMaxZ = next(iz, stepZ, o.z, d.z);
  const tDeltaX = stepX === 0 ? Infinity : s / Math.abs(d.x);
  const tDeltaY = stepY === 0 ? Infinity : s / Math.abs(d.y);
  const tDeltaZ = stepZ === 0 ? Infinity : s / Math.abs(d.z);

  const lim = GRID_INDEX_LIMIT;
  for (let guard = 0; guard < 100000; guard++) {
    const tExit = Math.min(tMaxX, tMaxY, tMaxZ);
    const outX = Math.abs(ix) > lim, outY = Math.abs(iy) > lim, outZ = Math.abs(iz) > lim;
    if (!outX && !outY && !outZ) {
      const [st, dy] = grid.cellBodies(ix, iy, iz);
      if (visit(st, dy, tExit)) return;
    } else if (
      (outX && Math.sign(ix) !== -stepX) ||
      (outY && Math.sign(iy) !== -stepY) ||
      (outZ && Math.sign(iz) !== -stepZ)
    ) {
      // Outside the packable range on some axis and not heading back in.
      // Anything out there is in the oversize lists, already tested.
      return;
    }
    if (tExit > maxDist) return;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; tMaxX += tDeltaX; }
    else if (tMaxY <= tMaxZ) { iy += stepY; tMaxY += tDeltaY; }
    else { iz += stepZ; tMaxZ += tDeltaZ; }
  }
}
