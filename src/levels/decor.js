// Where a compiled level's dressing goes: pictures on the walls and rugs on
// the floor. None of it is physical; harness/look/room.js draws it. The
// original room keeps its own hand-placed decor.
//
// No Three.js: runs headless, so tests/levels/ can check it.

import { ROOM } from '../collision/index.js';

// The pictures of the original room: kind, width, height, centre height.
export const PICTURES = [['map', 0.7, 0.48, 1.8], ['leaves', 0.5, 0.64, 1.74], ['sun', 0.62, 0.52, 1.7], ['note', 0.26, 0.34, 1.6]];

/** Pieces up to this height leave the wall above them free for a picture. */
export const PICTURE_BOTTOM = 1.38;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** How high a piece reaches (the window over a sill counts as reaching 2.1 m). */
export function pieceTop(piece) {
  if (piece.item.id === 'windowSill') return 2.1;
  return Math.max(...[...piece.boxes, ...piece.occluders].map((b) => b.center[1] + b.half[1]));
}

/**
 * Where a level's pictures hang: on spans of the north and west walls (the
 * two the camera sees) that nothing tall stands in front of, apart from each
 * other, as near each wall's middle as they fit.
 * @returns {{kind: string, wall: 'north'|'west', along: number, y: number, w: number, h: number}[]}
 */
export function pictureSpots(pieces) {
  const blocked = { north: [], west: [] };
  for (const p of pieces) {
    if (pieceTop(p) < PICTURE_BOTTOM) continue;
    const fp = p.footprint;
    if (fp.minZ < ROOM.minZ + 0.6) blocked.north.push([fp.minX - 0.12, fp.maxX + 0.12]);
    if (fp.minX < ROOM.minX + 0.6) blocked.west.push([fp.minZ - 0.12, fp.maxZ + 0.12]);
  }
  const ends = { north: [ROOM.minX + 0.35, ROOM.maxX - 0.3], west: [ROOM.minZ + 0.35, ROOM.maxZ - 0.5] };
  const hung = { north: [], west: [] };
  const out = [];
  PICTURES.forEach(([kind, w, h, y], i) => {
    const first = i % 2 === 0 ? 'north' : 'west';
    for (const wall of [first, first === 'north' ? 'west' : 'north']) {
      const [lo, hi] = ends[wall], mid = (lo + hi) / 2;
      let best = null;
      for (let c = lo + w / 2; c <= hi - w / 2 + 1e-9; c += 0.05) {
        if (blocked[wall].some(([s, e]) => c - w / 2 < e && c + w / 2 > s)) continue;
        if (hung[wall].some((q) => Math.abs(q.c - c) < (q.w + w) / 2 + 0.5)) continue;
        if (best === null || Math.abs(c - mid) < Math.abs(best - mid)) best = c;
      }
      if (best !== null) {
        hung[wall].push({ c: best, w });
        out.push({ kind, wall, along: +best.toFixed(2), y, w, h });
        break;
      }
    }
  });
  return out;
}

/**
 * The rugs: the shag one under the coffee table (or the dining table), the
 * patchwork one beside the bed where he gets up. Each lies inside the room.
 * @returns {{kind: 'shag'|'patchwork', x: number, z: number, w: number, d: number, alongZ?: boolean}[]}
 */
export function rugSpots(level) {
  const inRoom = (x, z, w, d) => ({ x: clamp(x, ROOM.minX + w / 2 + 0.04, ROOM.maxX - w / 2 - 0.04), z: clamp(z, ROOM.minZ + d / 2 + 0.04, ROOM.maxZ - d / 2 - 0.04) });
  const out = [];
  const table = level.pieces.find((p) => p.item.id === 'coffeeTable') ?? level.pieces.find((p) => p.item.id === 'diningTable');
  if (table) {
    const fp = table.footprint;
    const w = Math.min(3.4, fp.maxX - fp.minX + 1.4), d = Math.min(2.4, fp.maxZ - fp.minZ + 1.2);
    out.push({ kind: 'shag', w, d, ...inRoom((fp.minX + fp.maxX) / 2, (fp.minZ + fp.maxZ) / 2, w, d) });
  }
  const home = level.home;
  if (home?.bedside) {
    const bed = home.piece.footprint;
    const alongZ = bed.maxZ - bed.minZ > bed.maxX - bed.minX; // the bed's long side runs north-south
    const w = alongZ ? 1.1 : 1.7, d = alongZ ? 1.7 : 1.1;
    out.push({ kind: 'patchwork', w, d, alongZ, ...inRoom(home.bedside.x, home.bedside.z, w, d) });
  }
  return out;
}
