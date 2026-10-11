// Swept-sphere tunneling guard (Workstream A).
//
// At 120 Hz a 12 m/s mug moves 10 cm per substep, five times the thickness of
// a 2 cm shelf, so discrete collision can let it pass straight through.
//
// After every substep, each fast body's motion is swept as a sphere from its
// previous centre to its new one against the solid static boxes. If the
// sphere would have entered a box during the substep, the body is put back
// at the first hit and its velocity into the surface is removed. The
// narrowphase then resolves the contact normally on the next substep, from
// the correct side.
//
//  - Gate: only bodies that moved more than `minDisplacement` this substep
//    (1 cm ~ 1.2 m/s, half the thinnest shelf) are checked.
//  - The sphere is the body's *inner* radius (centre to nearest face of its
//    local AABB), so clamping never stops a body short of a real contact.
//  - A hit only clamps when discrete collision would really fail: the centre
//    ends the substep past the box's mid-plane (the solver would push it out
//    the wrong side) or deeper than one inner radius. Grazing hits from props
//    sliding along a desk are left alone, and so are resting contacts, which
//    is what keeps resting stacks from jittering.
//  - A body that starts the substep already touching a box is only clamped if
//    it crosses that box's mid-plane; then it is held where it started.
//
// Runs on cannon-es's own per-substep preStep/postStep events (preStep fires
// right before integration, postStep right after), so it works whoever
// drives world.step().

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';
import { UniformGridBroadphase } from './gridBroadphase.js';
import { isSolidStatic } from './staticGeometry.js';

const AXES = ['x', 'y', 'z'];

/**
 * Sweep a sphere along a segment against an oriented box.
 * @param p0 start centre (world)
 * @param dir normalised direction (world)
 * @param len segment length
 * @param r sphere radius
 * @returns {{t: number, normal: {x,y,z}, inside: boolean, crossed: boolean, deep: boolean} | null}
 *   t: first contact distance along the segment (0 if `inside` at the start);
 *   normal: outward normal of the face entered (or nearest face when inside);
 *   crossed: the centre ends past the box's mid-plane on that axis;
 *   deep: the end position penetrates the real box by more than r.
 */
export function sweepSphereVsBox(p0, dir, len, r, center, quat, half) {
  // Into the box frame.
  const inv = { x: -quat.x, y: -quat.y, z: -quat.z, w: quat.w };
  const rel = { x: p0.x - center.x, y: p0.y - center.y, z: p0.z - center.z };
  const o = rotate(inv, rel);
  const d = rotate(inv, dir);
  // The box grown by r. (Exact for faces; at edges and corners this is a
  // slightly fatter rounded box, which only makes the guard more cautious.)
  const h = { x: half.x + r, y: half.y + r, z: half.z + r };
  const end = { x: o.x + d.x * len, y: o.y + d.y * len, z: o.z + d.z * len };

  const finish = (t, axis, sign, inside) => {
    const k = AXES[axis];
    const along = sign * end[k]; // end centre measured along the face normal
    const n = { x: 0, y: 0, z: 0 };
    n[k] = sign;
    return {
      t, inside,
      normal: rotate(quat, n),
      crossed: along < 0,
      deep: half[k] - along > r,
    };
  };

  if (Math.abs(o.x) < h.x && Math.abs(o.y) < h.y && Math.abs(o.z) < h.z) {
    // Already touching: use the face it is least deep behind.
    let axis = 0, best = Infinity;
    for (let a = 0; a < 3; a++) {
      const k = AXES[a];
      const pen = h[k] - Math.abs(o[k]);
      if (pen < best) { best = pen; axis = a; }
    }
    return finish(0, axis, o[AXES[axis]] >= 0 ? 1 : -1, true);
  }

  let tNear = -Infinity, tFar = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const k = AXES[a];
    const oi = o[k], di = d[k], hi = h[k];
    if (Math.abs(di) < 1e-12) {
      if (oi < -hi || oi > hi) return null;
      continue;
    }
    const t1 = (-hi - oi) / di, t2 = (hi - oi) / di;
    const tEnter = Math.min(t1, t2), tExit = Math.max(t1, t2);
    if (tEnter > tNear) { tNear = tEnter; axis = a; sign = di > 0 ? -1 : 1; }
    if (tExit < tFar) tFar = tExit;
    if (tNear > tFar) return null;
  }
  if (tNear < 0 || tNear > len) return null;
  const hit = finish(tNear, axis, sign, false);
  // Passing clean through and out the far side counts as crossing.
  if (tFar <= len) hit.crossed = true;
  return hit;
}

/** Sweep a sphere against an infinite plane (cannon-es planes face local +Z). */
export function sweepSphereVsPlane(p0, dir, len, r, position, quat) {
  const n = rotate(quat, { x: 0, y: 0, z: 1 });
  const dist = (p) => (p.x - position.x) * n.x + (p.y - position.y) * n.y + (p.z - position.z) * n.z;
  const d0 = dist(p0);
  const dEnd = d0 + len * (dir.x * n.x + dir.y * n.y + dir.z * n.z);
  const crossed = dEnd < 0;
  if (d0 <= r) return { t: 0, normal: n, inside: true, crossed, deep: crossed };
  if (dEnd >= r) return null;
  const t = ((d0 - r) / (d0 - dEnd)) * len;
  return { t, normal: n, inside: false, crossed, deep: r - dEnd > r };
}

function rotate(q, v) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * v.x + qy * v.z - qz * v.y;
  const iy = qw * v.y + qz * v.x - qx * v.z;
  const iz = qw * v.z + qx * v.y - qy * v.x;
  const iw = -qx * v.x - qy * v.y - qz * v.z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

/** Distance from a body's centre to the nearest face of its local AABB. */
export function innerRadius(body) {
  const min = new CANNON.Vec3(Infinity, Infinity, Infinity);
  const max = new CANNON.Vec3(-Infinity, -Infinity, -Infinity);
  const smin = new CANNON.Vec3(), smax = new CANNON.Vec3();
  for (let i = 0; i < body.shapes.length; i++) {
    body.shapes[i].calculateWorldAABB(body.shapeOffsets[i], body.shapeOrientations[i], smin, smax);
    min.x = Math.min(min.x, smin.x); min.y = Math.min(min.y, smin.y); min.z = Math.min(min.z, smin.z);
    max.x = Math.max(max.x, smax.x); max.y = Math.max(max.y, smax.y); max.z = Math.max(max.z, smax.z);
  }
  const r = Math.min(-min.x, -min.y, -min.z, max.x, max.y, max.z);
  return Math.max(r, 0.002);
}

/**
 * @param {CANNON.World} world
 * @param {{tuning?: object}} [opts]
 */
export function createSweptGuard(world, opts = {}) {
  const cfg = opts.tuning ?? defaultTuning.collision.guard;
  const prev = new Map(); // body -> {x,y,z} at preStep
  const radii = new WeakMap(); // body -> {r, nShapes}
  const candidates = [];
  const sweepAABB = new CANNON.AABB();
  const qi = new CANNON.Quaternion();
  const xi = new CANNON.Vec3();

  const guard = {
    enabled: cfg.enabled ?? true,
    stats: { checked: 0, clamps: 0, lastClamp: null },
    /** Bodies moving more than this per substep are swept (m). */
    minDisplacement: cfg.minDisplacement,
    skin: cfg.skin ?? 0.002,
    dispose,
  };

  function radiusOf(body) {
    let e = radii.get(body);
    if (!e || e.nShapes !== body.shapes.length) {
      e = { r: innerRadius(body), nShapes: body.shapes.length };
      radii.set(body, e);
    }
    return e.r;
  }

  function staticCandidates(aabb) {
    candidates.length = 0;
    const bp = world.broadphase;
    if (bp instanceof UniformGridBroadphase) bp.queryStatic(world, aabb, candidates);
    else {
      for (const b of world.bodies) {
        if (b.type !== CANNON.Body.STATIC) continue;
        if (b.aabbNeedsUpdate) b.updateAABB();
        if (b.aabb.overlaps(aabb)) candidates.push(b);
      }
    }
    return candidates;
  }

  function onPreStep() {
    if (!guard.enabled) return;
    for (const b of world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING) continue;
      let p = prev.get(b);
      if (!p) { p = { x: 0, y: 0, z: 0 }; prev.set(b, p); }
      p.x = b.position.x; p.y = b.position.y; p.z = b.position.z;
      p.step = world.stepnumber;
    }
  }

  function onPostStep() {
    if (!guard.enabled) return;
    const minD2 = guard.minDisplacement * guard.minDisplacement;
    for (const b of world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const p0 = prev.get(b);
      // Only bodies recorded in this substep's preStep (stepnumber was bumped since).
      if (!p0 || p0.step !== world.stepnumber - 1) continue;
      const dx = b.position.x - p0.x, dy = b.position.y - p0.y, dz = b.position.z - p0.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= minD2) continue;
      guard.stats.checked++;

      const len = Math.sqrt(d2);
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const r = radiusOf(b);
      sweepAABB.lowerBound.set(Math.min(p0.x, b.position.x) - r, Math.min(p0.y, b.position.y) - r, Math.min(p0.z, b.position.z) - r);
      sweepAABB.upperBound.set(Math.max(p0.x, b.position.x) + r, Math.max(p0.y, b.position.y) + r, Math.max(p0.z, b.position.z) + r);

      let best = null;
      for (const s of staticCandidates(sweepAABB)) {
        if (!isSolidStatic(s)) continue;
        // Respect collision filters: debris that ignores a surface isn't clamped by it.
        if ((b.collisionFilterGroup & s.collisionFilterMask) === 0 || (s.collisionFilterGroup & b.collisionFilterMask) === 0) continue;
        for (let i = 0; i < s.shapes.length; i++) {
          const shape = s.shapes[i];
          s.quaternion.mult(s.shapeOrientations[i], qi);
          s.quaternion.vmult(s.shapeOffsets[i], xi);
          xi.vadd(s.position, xi);
          let h = null;
          if (shape.type === CANNON.Shape.types.BOX) h = sweepSphereVsBox(p0, dir, len, r, xi, qi, shape.halfExtents);
          else if (shape.type === CANNON.Shape.types.PLANE) h = sweepSphereVsPlane(p0, dir, len, r, xi, qi);
          if (!h) continue;
          // Leave it to the solver unless the discrete step would really fail.
          if (h.inside ? !h.crossed : !(h.crossed || h.deep)) continue;
          if (!best || h.t < best.t) best = h;
        }
      }
      if (!best) continue;

      // Clamp to the first hit, leaving a small skin gap.
      const t = Math.max(0, best.t - guard.skin);
      b.position.set(p0.x + dir.x * t, p0.y + dir.y * t, p0.z + dir.z * t);
      // Remove the velocity component into the surface.
      const n = best.normal;
      const vn = b.velocity.x * n.x + b.velocity.y * n.y + b.velocity.z * n.z;
      if (vn < 0) {
        b.velocity.x -= vn * n.x;
        b.velocity.y -= vn * n.y;
        b.velocity.z -= vn * n.z;
      }
      b.aabbNeedsUpdate = true;
      guard.stats.clamps++;
      guard.stats.lastClamp = { body: b, point: { x: b.position.x, y: b.position.y, z: b.position.z }, normal: { ...n }, speed: len / (world.dt || 1 / 120) };
    }
  }

  world.addEventListener('preStep', onPreStep);
  world.addEventListener('postStep', onPostStep);

  function dispose() {
    world.removeEventListener('preStep', onPreStep);
    world.removeEventListener('postStep', onPostStep);
    prev.clear();
  }

  return guard;
}
