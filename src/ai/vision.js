// The owner's sight (C): a view cone confirmed by A's line-of-sight rays.
//
// The cat is seen when it is within range, inside the cone around where the
// owner is looking, and at least one of three points on it (the middle and
// the two ends of its body) has a clear line to his eye. Sight is blocked by
// static geometry and by the bed skirt, so hiding works through geometry,
// not a flag. Props don't block it.
//
// Headings follow the cat's convention: h faces (cos h, 0, -sin h).
//
// No Three.js: runs headless.

import { STATIC } from '../core/groups.js';
import { lineOfSight } from '../collision/index.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param {Function} raycast  A's raycast
 * @param {{x: number, y: number, z: number}} eye
 * @param {number} look  heading he is looking along
 * @param {{body: object, heading: number, dims: {halfLength: number}}} cat
 * @param {{range: number, angle: number, skip?: object[]}} view
 * @returns {{seen: boolean, distance: number, inCone: boolean}}
 */
export function seesCat(raycast, eye, look, cat, view) {
  const p = cat.body.position;
  const dx = p.x - eye.x, dz = p.z - eye.z;
  const distance = Math.hypot(dx, p.y - eye.y, dz);
  if (distance > view.range) return { seen: false, distance, inCone: false };
  const bearing = Math.atan2(-dz, dx);
  const inCone = Math.abs(wrap(bearing - look)) <= view.angle || Math.hypot(dx, dz) < 0.35;
  if (!inCone) return { seen: false, distance, inCone };
  const fx = Math.cos(cat.heading) * cat.dims.halfLength, fz = -Math.sin(cat.heading) * cat.dims.halfLength;
  const points = [{ x: p.x, y: p.y, z: p.z }, { x: p.x + fx, y: p.y, z: p.z + fz }, { x: p.x - fx, y: p.y, z: p.z - fz }];
  const skip = [cat.body, ...(view.skip ?? [])];
  for (const q of points) {
    if (lineOfSight(raycast, eye, q, STATIC, { skip }).visible) return { seen: true, distance, inCone };
  }
  return { seen: false, distance, inCone };
}
