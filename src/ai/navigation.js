// Waypoint navigation for the owner (C): A* over hand-placed floor waypoints.
//
// The plan cut floor-grid navigation for "A* over 8-12 hand-placed waypoints
// around the furniture". The links between waypoints are not hand-written:
// they are found from A's static geometry. A straight walk is allowed where
// the owner's footprint, swept along it, overlaps no static box between the
// floor and his height (each box widened by his radius, in its own turned
// frame, so the turned desk chair counts). Props are not obstacles: the owner
// is a kinematic body and pushes them aside.
//
// No Three.js: runs headless.

import { ROOM, STATIC_BOXES } from '../collision/index.js';

/** Open floor around the furniture of A's room (x, z in m). */
export const WAYPOINTS = [
  { id: 'bedside', x: -2.25, z: -1.4 },     // north of the bed, where he gets up
  { id: 'nightstand', x: -2.75, z: -2.05 }, // behind the nightstand, by the aquarium
  { id: 'aquarium', x: -1.0, z: -1.95 },
  { id: 'bedFoot', x: -0.95, z: -0.1 },     // where he crouches to look under the bed
  { id: 'deskFront', x: 0.33, z: -1.6 },    // where he crouches to look under the desk
  { id: 'center', x: 0.6, z: 0.3 },
  { id: 'shelf', x: 2.2, z: -1.85 },
  { id: 'east', x: 2.2, z: 1.3 },
  { id: 'southEast', x: 2.1, z: 2.5 },
  { id: 'south', x: 0.0, z: 2.45 },
  { id: 'coffee', x: -1.05, z: 2.05 },
  { id: 'bedSouth', x: -1.0, z: 1.0 },
];

/** Does the segment a-b come within r of the box's footprint? (slab test in the box's frame) */
function segmentHitsBox(a, b, box, r) {
  const c = Math.cos(box.rotY ?? 0), s = Math.sin(box.rotY ?? 0);
  const local = (p) => {
    const dx = p.x - box.center[0], dz = p.z - box.center[2];
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  const p0 = local(a), p1 = local(b);
  let t0 = 0, t1 = 1;
  for (const [o, d, h] of [[p0.x, p1.x - p0.x, box.half[0] + r], [p0.z, p1.z - p0.z, box.half[2] + r]]) {
    if (Math.abs(d) < 1e-12) {
      if (o < -h || o > h) return false;
      continue;
    }
    let ta = (-h - o) / d, tb = (h - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.radius=0.22]  half the owner's width
 * @param {number} [opts.height=1.72]  boxes wholly above this, or on the floor, are no obstacle
 * @param {typeof WAYPOINTS} [opts.waypoints]
 * @param {object[]} [opts.boxes]  default A's solid STATIC_BOXES
 * @param {object} [opts.room]  bounds targets are kept inside
 */
export function createNavigator(opts = {}) {
  const radius = opts.radius ?? 0.22;
  const height = opts.height ?? 1.72;
  const room = opts.room ?? ROOM;
  const boxes = (opts.boxes ?? STATIC_BOXES).filter((b) =>
    (b.role ?? 'solid') === 'solid' && b.center[1] + b.half[1] > 0.04 && b.center[1] - b.half[1] < height);
  const nodes = (opts.waypoints ?? WAYPOINTS).map((w, i) => ({ ...w, index: i, links: [] }));

  /** Can a body this wide walk straight from a to b? */
  function clear(a, b, r = radius) {
    for (const box of boxes) if (segmentHitsBox(a, b, box, r)) return false;
    return true;
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!clear(nodes[i], nodes[j])) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
      nodes[i].links.push({ node: nodes[j], d });
      nodes[j].links.push({ node: nodes[i], d });
    }
  }

  /** Keep a target on the floor inside the room, a body's width from the walls. */
  function inside(p) {
    return {
      x: Math.min(room.maxX - radius, Math.max(room.minX + radius, p.x)),
      z: Math.min(room.maxZ - radius, Math.max(room.minZ + radius, p.z)),
    };
  }

  const near = (p) => nodes.filter((n) => clear(p, n, radius * 0.7));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  /**
   * Points to walk through from `from` to `to`, ending at `to` if it can be
   * reached, else at the waypoint nearest to it. Null if nothing connects.
   * @returns {{x: number, z: number}[] | null}
   */
  function path(from, to) {
    const goal = inside(to);
    if (clear(from, goal, radius * 0.7)) return [goal];
    const starts = near(from);
    const ends = new Set(near(goal));
    // Goal not reachable in a straight line from any waypoint (inside the desk, say): the nearest one will do.
    const finish = ends.size ? null : nodes.reduce((best, n) => (dist(n, goal) < dist(best, goal) ? n : best), nodes[0]);
    if (finish) ends.add(finish);
    if (!starts.length) return null;

    // A* from every waypoint the start can see.
    const g = new Map(), came = new Map(), open = new Set();
    for (const s of starts) { g.set(s, dist(from, s)); open.add(s); }
    const h = (n) => (finish ? dist(n, finish) : dist(n, goal));
    while (open.size) {
      let cur = null, best = Infinity;
      for (const n of open) { const f = g.get(n) + h(n); if (f < best) { best = f; cur = n; } }
      open.delete(cur);
      if (ends.has(cur)) {
        const out = [];
        for (let n = cur; n; n = came.get(n)) out.unshift({ x: n.x, z: n.z });
        if (!finish) out.push(goal);
        return out;
      }
      for (const { node, d } of cur.links) {
        const tentative = g.get(cur) + d;
        if (tentative < (g.get(node) ?? Infinity)) {
          g.set(node, tentative);
          came.set(node, cur);
          open.add(node);
        }
      }
    }
    return null;
  }

  /** The waypoint nearest a point, by straight-line distance. */
  function nearest(p) {
    return nodes.reduce((best, n) => (dist(n, p) < dist(best, p) ? n : best), nodes[0]);
  }

  return { nodes, clear, path, nearest, inside };
}
