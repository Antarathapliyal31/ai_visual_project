// The chase camera: play.html's third-person view. It sits behind the cat
// and a little above it, and swings round behind as the cat turns, with a
// lag, so turning feels like turning and not like the room spinning. Set
// free (setFree), it stays where the mouse turns and tilts it instead (look),
// as in a game played with a mouse: then the keys move the cat the way the
// camera looks (src/player/input.js cameraRelativeInput).
//
// It stays in the room:
//   - its pivot (where it looks out from) starts just above the cat; a cat
//     under the bed, the desk or a table is watched from above it, not from
//     inside the dark space under it;
//   - a ray from the pivot to where it would like to be pulls it in front
//     of walls and tall furniture; low furniture right behind the cat it
//     looks over from higher up, and with a wall right behind the cat it
//     comes in close over the cat's head (never up to the ceiling);
//   - it is kept inside the walls and under their tops, and never looks
//     straight down.
// A cat hidden under something is still shown by its see-through
// silhouette (harness/look/catMesh.js).
//
// Plain numbers, no Three.js: play.html copies `position` and `target` onto
// its camera; the tests drive it directly.

import { rayVsBox } from '../collision/raycast.js';

/** How the camera follows: distances in metres, rates per second. */
export const CHASE = {
  distance: 1.5,   // behind the pivot
  height: 0.8,     // above the cat's middle
  pivotUp: 0.45,   // where the pivot starts, above the cat's middle
  lookAhead: 0.35, // it looks at a point this far ahead of the cat...
  lookUp: 0.12,    // ...and this far up
  yawRate: 2.5,    // how quickly it swings round behind (1 - e^(-rate dt) of the way each step)
  followRate: 8,   // how quickly it follows the cat about
  clear: 0.12,     // kept this far in front of a wall or furniture
  closest: 0.35,   // nearer the pivot than this, it tries looking over what is behind the cat...
  maxLift: 0.9,    // ...from at most this much higher (a desk, a bed, a counter; not a bookcase)
  under: 0.8,      // something this little above the cat's middle: the cat is under it (a desk top is 0.74)...
  over: 0.35,      // ...and is watched from a pivot this far above the top of it
  steepest: 0.87,  // rad (50 degrees): it never looks down more steeply than this (unless tilted there by hand)
  sensitivity: 0.0025, // free: rad it turns or tilts per pixel the mouse moves
  lowest: -0.15,   // free: rad it tilts to, from just below the pivot...
  highest: 1.1,    // ...to well above it, looking down (63 degrees)
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const UP = { x: 0, y: 1, z: 0 };

/**
 * @param {{boxes: object[], room: {minX: number, maxX: number, minZ: number, maxZ: number, wallHeight: number}, options?: object}} opts
 *   boxes: the level's static boxes (level.boxes), walls included
 */
export function createChaseCamera({ boxes, room, options = {} }) {
  const c = { ...CHASE, ...options };
  // Everything but the floor, ready for rays: centre, half sizes, the turn about y as a quaternion.
  const solids = boxes.filter((b) => b.id !== 'floor').map((b) => {
    const r = b.rotY ?? 0;
    return {
      center: { x: b.center[0], y: b.center[1], z: b.center[2] },
      half: { x: b.half[0], y: b.half[1], z: b.half[2] },
      quat: { x: 0, y: Math.sin(r / 2), z: 0, w: Math.cos(r / 2) },
      cos: Math.cos(r), sin: Math.sin(r),
    };
  });
  /** Is a point inside any solid? */
  const inside = (p) => solids.some((s) => {
    const dx = p.x - s.center.x, dz = p.z - s.center.z;
    // Into the box's own frame (the inverse of its turn about y).
    const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
    return Math.abs(lx) < s.half.x && Math.abs(p.y - s.center.y) < s.half.y && Math.abs(lz) < s.half.z;
  });
  /** The nearest solid along a ray, within `most` metres. */
  const firstHit = (o, d, most) => {
    let best = most;
    for (const s of solids) {
      const hit = rayVsBox(o, d, s.center, s.quat, s.half, best);
      if (hit && hit.t >= 0 && hit.t < best) best = hit.t;
    }
    return best < most ? best : null;
  };
  const clampInRoom = (p) => ({
    x: Math.min(room.maxX - 0.1, Math.max(room.minX + 0.1, p.x)),
    y: Math.min(room.wallHeight - 0.12, Math.max(0.15, p.y)),
    z: Math.min(room.maxZ - 0.1, Math.max(room.minZ + 0.1, p.z)),
  });

  // Where it sits round the pivot: this far off, tilted up this much (just as `distance` back and
  // `height` up put it), turned to `yaw`. Free, the mouse turns and tilts it.
  const R = Math.hypot(c.distance, c.height - c.pivotUp), TILT = Math.atan2(c.height - c.pivotUp, c.distance);
  let yaw = 0, tilt = TILT, free = false, ready = false;
  let position = { x: 0, y: 0, z: 0 }, target = { x: 0, y: 0, z: 0 };

  /** Where it would be, for the cat as it is and the yaw so far: { camera, target, blocked }. */
  function aim(cat) {
    const p = cat.body.position, h = cat.heading;
    const base = { x: p.x, y: p.y + c.pivotUp, z: p.z };
    // Under something (the bed, the desk, a table): the pivot goes up through it, and through
    // anything stacked close above that (shelves), to `over` above the top.
    const top = { x: p.x, y: p.y, z: p.z };
    let over = firstHit(top, UP, c.under), under = false;
    for (let n = 0; n < 10 && over !== null; n++) {
      under = true;
      top.y += over + 0.01; // into it...
      for (let i = 0; i < 150 && inside(top); i++) top.y += 0.02; // ...and out of its top
      over = firstHit(top, UP, c.over + 0.1);
    }
    if (under) base.y = Math.max(base.y, Math.min(room.wallHeight - 0.3, top.y + c.over));
    for (let i = 0; i < 30 && inside(base); i++) base.y += 0.1;
    // Behind is against the facing (cos yaw, -sin yaw).
    const back = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    // Straight back from the pivot, pulled in front of whatever is in the way. If that leaves it
    // nearer than `closest`, try from higher up: that clears a desk or a bed right behind the cat.
    // Nothing clears a wall, so then it takes the try that got furthest back, lowest first.
    let best = null;
    for (let lift = 0; lift <= c.maxLift + 1e-9; lift += 0.15) {
      const pivot = { x: base.x, y: base.y + lift, z: base.z };
      if (lift > 0 && pivot.y > room.wallHeight - 0.3) break;
      const out = R * Math.cos(tilt);
      const want = { x: pivot.x + back.x * out, y: pivot.y + R * Math.sin(tilt), z: pivot.z + back.z * out };
      const d = { x: want.x - pivot.x, y: want.y - pivot.y, z: want.z - pivot.z };
      const len = Math.hypot(d.x, d.y, d.z);
      const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
      const hit = firstHit(pivot, dir, len);
      const reach = hit === null ? len : Math.max(0, hit - c.clear);
      const here = { pivot, dir, reach, blocked: hit !== null || lift > 0 };
      if (reach >= c.closest) { best = here; break; }
      if (!best || reach > best.reach + 0.05) best = here;
    }
    const { pivot, dir, reach } = best;
    let camera = clampInRoom({ x: pivot.x + dir.x * reach, y: pivot.y + dir.y * reach, z: pivot.z + dir.z * reach });
    for (let i = 0; i < 25 && inside(camera); i++) camera.y += 0.1; // never inside furniture
    // It looks a little ahead of the cat (the way the cat faces, or free, the way it looks itself);
    // less far ahead once it has come in close, so the cat stays in view, but never so steeply down
    // that the room turns into a map (free, no more steeply than it is tilted).
    const way = free ? yaw : h;
    const fx = Math.cos(way), fz = -Math.sin(way);
    const qx = p.x - camera.x, qz = p.z - camera.z; // the camera to the cat, across the floor
    const lookY = p.y + c.lookUp;
    // Looking no more steeply than `steepest` needs the target this far off across the floor;
    // `least` is how far ahead of the cat that is (where |q + f * ahead| = need).
    const need = Math.max(0, camera.y - lookY) / Math.tan(free ? Math.max(c.steepest, tilt) : c.steepest);
    const fq = fx * qx + fz * qz, room2 = fq * fq - (qx * qx + qz * qz) + need * need;
    const least = room2 > 0 ? -fq + Math.sqrt(room2) : 0;
    const ahead = Math.max(c.lookAhead * Math.min(1, Math.hypot(qx, qz) / c.distance), least);
    const target = { x: p.x + fx * ahead, y: lookY, z: p.z + fz * ahead };
    return { camera, target, blocked: best.blocked };
  }

  return {
    /** Straight behind the cat, no lag: at the start of a night, or on H. */
    snap(cat) {
      yaw = cat.heading;
      tilt = TILT;
      const a = aim(cat);
      position = a.camera;
      target = a.target;
      ready = true;
      return { position: { ...position }, target: { ...target } };
    },
    /** One frame: swing round behind the cat (unless free) and follow it, with a lag. */
    update(dt, cat) {
      if (!ready) return this.snap(cat);
      if (!free) yaw = wrap(yaw + wrap(cat.heading - yaw) * (1 - Math.exp(-c.yawRate * dt)));
      const a = aim(cat);
      // Free, it keeps up closely: the mouse turning it should feel direct.
      const k = 1 - Math.exp(-c.followRate * (free ? 3 : 1) * dt);
      // Pulled in by a wall it moves at once, so it never shows the inside of one.
      if (a.blocked) position = a.camera;
      else position = { x: position.x + (a.camera.x - position.x) * k, y: position.y + (a.camera.y - position.y) * k, z: position.z + (a.camera.z - position.z) * k };
      const kt = 1 - Math.exp(-c.followRate * 1.5 * dt);
      target = { x: target.x + (a.target.x - target.x) * kt, y: target.y + (a.target.y - target.y) * kt, z: target.z + (a.target.z - target.z) * kt };
      return { position: { ...position }, target: { ...target } };
    },
    /** Free (the mouse turns and tilts it) or following the cat round (car-style keys). */
    setFree(on) {
      free = Boolean(on);
      if (!free) tilt = TILT;
    },
    /** The mouse moved this many pixels (right, down): turn and tilt the free camera. */
    look(dx, dy) {
      if (!free) return;
      yaw = wrap(yaw - dx * c.sensitivity);
      tilt = Math.min(c.highest, Math.max(c.lowest, tilt + dy * c.sensitivity));
    },
    get yaw() { return yaw; },
    get tilt() { return tilt; },
    get free() { return free; },
    /** The way it looks, across the floor ({x, z}): what W means when it is free. */
    get forward() { return { x: Math.cos(yaw), z: -Math.sin(yaw) }; },
    /** For the tests: is a point inside the room's furniture or walls? */
    inside,
  };
}
