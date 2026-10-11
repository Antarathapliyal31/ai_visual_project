// Hiding spots (Workstream A -> C).
//
// Hiding works through geometry, not a flag: the hiding volumes say where the
// cat counts as hidden, and the occluders (bed skirt) plus the solid desk
// panels are what actually block the owner's sight rays. C's vision crouches
// to a lower eye height at a volume's `checkFrom` and re-tests sight with
// lineOfSight().

import { STATIC } from '../core/groups.js';
import { HIDING_VOLUMES } from './staticGeometry.js';

export { HIDING_VOLUMES };

/** The hiding volume containing `pos`, or null. */
export function hidingSpotAt(pos, volumes = HIDING_VOLUMES) {
  for (const v of volumes) {
    if (
      pos.x >= v.min[0] && pos.x <= v.max[0] &&
      pos.y >= v.min[1] && pos.y <= v.max[1] &&
      pos.z >= v.min[2] && pos.z <= v.max[2]
    ) return v;
  }
  return null;
}

/**
 * Is there a clear line from `from` to `to`?
 * @param raycast  the function from createRaycaster(world)
 * @param mask     what blocks sight; default static geometry and occluders only
 * @param opts     passed to raycast (e.g. {skip: catBody})
 * @returns {{visible: boolean, blocker: import('cannon-es').Body | null, distance: number}}
 */
export function lineOfSight(raycast, from, to, mask = STATIC, opts = {}) {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  if (dist < 1e-9) return { visible: true, blocker: null, distance: 0 };
  // Stop just short of the target so the target's own surface never counts.
  const hit = raycast(from, d, dist - 1e-4, mask, opts);
  return { visible: !hit.hit, blocker: hit.body, distance: hit.hit ? hit.distance : dist };
}
