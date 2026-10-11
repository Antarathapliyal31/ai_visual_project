// Uniform spatial-grid broadphase for cannon-es (Workstream A).
//
// Space is cut into cubes of `cellSize`. Every body is binned into each cell
// its AABB overlaps, and only bodies sharing a cell are pair-tested.
//
//  - Static bodies are binned once and only re-binned when a static body is
//    added or removed (world addBody/removeBody events).
//  - Dynamic and kinematic bodies are re-binned every step.
//  - Planes and bodies spanning more than `maxCellsPerBody` cells go to an
//    "oversize" list that is tested against everything.
//  - A pair is emitted only from its *owner cell*: the cell containing the
//    min corner of the two AABBs' overlap. Two overlapping AABBs share
//    exactly one such cell, so pairs come out unique without a hash set.
//
// aabbQuery() is implemented too. cannon-es's own world.raycast* methods call
// it, and the base class just warns and returns nothing, which would make
// every built-in raycast silently miss.

import * as CANNON from 'cannon-es';
import { tuning } from '../core/tuning.js';

// Cell coordinates are packed into one number: 11 bits per axis.
const OFFSET = 1024;
const SPAN = 2048;
const MAX_INDEX = OFFSET - 1;
// Queries touching more cells than this scan the body list instead.
const MAX_QUERY_CELLS = 4096;

export function cellKey(ix, iy, iz) {
  return ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);
}

const isStaticBody = (b) => (b.type & CANNON.Body.STATIC) !== 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class UniformGridBroadphase extends CANNON.Broadphase {
  /**
   * @param {{cellSize?: number, maxCellsPerBody?: number}} [opts]
   */
  constructor(opts = {}) {
    super();
    this.useBoundingBoxes = true;
    this.setCellSize(opts.cellSize ?? tuning.collision.grid.cellSize);
    this.maxCellsPerBody = opts.maxCellsPerBody ?? tuning.collision.grid.maxCellsPerBody;

    this.staticCells = new Map();   // key -> Body[]
    this.dynamicCells = new Map();  // key -> Body[] (arrays reused across steps)
    this.dynamicKeys = [];          // keys in use this step
    this.staticOversize = [];
    this.dynamicOversize = [];
    this.staticBodies = [];
    this.dynamicBodies = [];

    this.staticDirty = true;
    this.binnedStep = -1;
    this.queryStamp = 0;

    this.stats = {
      staticRebuilds: 0,
      occupiedCells: 0,     // dynamic cells this step
      staticCells: 0,
      candidatePairs: 0,    // pairs that shared a cell and passed the owner-cell check
      pairs: 0,             // pairs handed to the narrowphase
      oversize: 0,
      lastStepMs: 0,
    };

    this._onBodiesChanged = (e) => {
      if (isStaticBody(e.body)) this.staticDirty = true;
    };
  }

  setCellSize(cellSize) {
    if (!(cellSize > 0)) throw new Error(`cellSize must be > 0, got ${cellSize}`);
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.staticDirty = true;
    this.binnedStep = -1;
  }

  setWorld(world) {
    if (this.world === world) return;
    if (this.world) {
      this.world.removeEventListener('addBody', this._onBodiesChanged);
      this.world.removeEventListener('removeBody', this._onBodiesChanged);
    }
    this.world = world;
    if (world) {
      world.addEventListener('addBody', this._onBodiesChanged);
      world.addEventListener('removeBody', this._onBodiesChanged);
    }
    this.staticDirty = true;
    this.binnedStep = -1;
  }

  /** Force a dynamic re-bin on the next query (after moving bodies by hand). */
  invalidate() {
    this.binnedStep = -1;
  }

  // ---------------------------------------------------------------- binning

  /** Cell index range of an AABB, or null if it should go to the oversize list. */
  _cellRange(aabb, out) {
    const inv = this.invCellSize;
    const x0 = Math.floor(aabb.lowerBound.x * inv), x1 = Math.floor(aabb.upperBound.x * inv);
    const y0 = Math.floor(aabb.lowerBound.y * inv), y1 = Math.floor(aabb.upperBound.y * inv);
    const z0 = Math.floor(aabb.lowerBound.z * inv), z1 = Math.floor(aabb.upperBound.z * inv);
    if (
      !(x0 >= -MAX_INDEX && x1 <= MAX_INDEX && y0 >= -MAX_INDEX && y1 <= MAX_INDEX && z0 >= -MAX_INDEX && z1 <= MAX_INDEX)
    ) {
      return null; // unbounded (planes) or outside the packable range
    }
    out.x0 = x0; out.x1 = x1; out.y0 = y0; out.y1 = y1; out.z0 = z0; out.z1 = z1;
    out.count = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    return out;
  }

  _insert(cells, body, r, keysOut) {
    for (let ix = r.x0; ix <= r.x1; ix++) {
      for (let iy = r.y0; iy <= r.y1; iy++) {
        for (let iz = r.z0; iz <= r.z1; iz++) {
          const k = cellKey(ix, iy, iz);
          let list = cells.get(k);
          if (!list) {
            list = [];
            cells.set(k, list);
          }
          if (keysOut && list.length === 0) keysOut.push(k);
          list.push(body);
        }
      }
    }
  }

  _rebuildStatic(world) {
    this.staticCells.clear();
    this.staticOversize.length = 0;
    this.staticBodies.length = 0;
    const r = {};
    for (const b of world.bodies) {
      if (!isStaticBody(b)) continue;
      b.updateAABB();
      this.staticBodies.push(b);
      const range = this._cellRange(b.aabb, r);
      if (!range || range.count > this.maxCellsPerBody * 64) {
        // Statics are binned once, so they may cover many more cells than a
        // dynamic body; only truly huge ones (planes) go oversize.
        this.staticOversize.push(b);
      } else {
        this._insert(this.staticCells, b, range, null);
      }
    }
    this.staticDirty = false;
    this.stats.staticRebuilds++;
    this.stats.staticCells = this.staticCells.size;
  }

  _rebinDynamic(world) {
    for (const k of this.dynamicKeys) this.dynamicCells.get(k).length = 0;
    this.dynamicKeys.length = 0;
    // Don't let empty arrays from old cells pile up forever.
    if (this.dynamicCells.size > 4096) this.dynamicCells.clear();
    this.dynamicOversize.length = 0;
    this.dynamicBodies.length = 0;

    const r = {};
    for (const b of world.bodies) {
      if (isStaticBody(b)) continue;
      // Always refresh: bodies moved by hand (position.set) don't flag aabbNeedsUpdate.
      b.updateAABB();
      this.dynamicBodies.push(b);
      const range = this._cellRange(b.aabb, r);
      if (!range || range.count > this.maxCellsPerBody) this.dynamicOversize.push(b);
      else this._insert(this.dynamicCells, b, range, this.dynamicKeys);
    }
    this.binnedStep = world.stepnumber;
    this.stats.occupiedCells = this.dynamicKeys.length;
    this.stats.oversize = this.dynamicOversize.length + this.staticOversize.length;
  }

  /** Bring both bin sets up to date for `world`. */
  ensureBinned(world) {
    if (this.world !== world) this.setWorld(world);
    if (this.staticDirty) this._rebuildStatic(world);
    if (this.binnedStep !== world.stepnumber) this._rebinDynamic(world);
  }

  // ------------------------------------------------------------------ pairs

  /** Called by cannon-es once per step. */
  collisionPairs(world, pairs1, pairs2) {
    const t0 = now();
    pairs1.length = 0;
    pairs2.length = 0;
    if (this.world !== world) this.setWorld(world);
    if (this.staticDirty) this._rebuildStatic(world);
    this._rebinDynamic(world);

    let candidates = 0;
    const inv = this.invCellSize;

    const test = (a, b) => {
      if (!this.needBroadphaseCollision(a, b)) return;
      if (a.aabb.overlaps(b.aabb)) {
        pairs1.push(a);
        pairs2.push(b);
      }
    };

    // Is (ix,iy,iz) the owner cell of the overlap of a and b?
    const owns = (a, b, ix, iy, iz) => {
      const la = a.aabb.lowerBound, lb = b.aabb.lowerBound;
      return (
        Math.floor((la.x > lb.x ? la.x : lb.x) * inv) === ix &&
        Math.floor((la.y > lb.y ? la.y : lb.y) * inv) === iy &&
        Math.floor((la.z > lb.z ? la.z : lb.z) * inv) === iz
      );
    };

    for (const k of this.dynamicKeys) {
      const list = this.dynamicCells.get(k);
      const statics = this.staticCells.get(k);
      // Unpack the key back to cell indices for the owner test.
      const iz = (k % SPAN) - OFFSET;
      const iy = (Math.floor(k / SPAN) % SPAN) - OFFSET;
      const ix = Math.floor(k / (SPAN * SPAN)) - OFFSET;

      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!owns(a, b, ix, iy, iz)) continue;
          candidates++;
          test(a, b);
        }
        if (statics) {
          for (let j = 0; j < statics.length; j++) {
            const s = statics[j];
            if (!owns(a, s, ix, iy, iz)) continue;
            candidates++;
            test(a, s);
          }
        }
      }
    }

    // Oversize dynamics against every other dynamic and every static.
    const big = this.dynamicOversize;
    const bigSet = big.length ? new Set(big) : null;
    for (let i = 0; i < big.length; i++) {
      const a = big[i];
      // Oversize-oversize pairs once (j > i); oversize-regular pairs from here only.
      for (let j = i + 1; j < big.length; j++) {
        candidates++;
        test(a, big[j]);
      }
      for (const b of this.dynamicBodies) {
        if (bigSet.has(b)) continue;
        candidates++;
        test(a, b);
      }
      for (const s of this.staticBodies) {
        candidates++;
        test(a, s);
      }
    }
    // Regular dynamics against oversize statics (e.g. an infinite floor plane).
    for (const s of this.staticOversize) {
      for (const b of this.dynamicBodies) {
        if (bigSet && bigSet.has(b)) continue; // already paired above
        candidates++;
        test(b, s);
      }
    }

    this.stats.candidatePairs = candidates;
    this.stats.pairs = pairs1.length;
    this.stats.lastStepMs = now() - t0;
  }

  // ---------------------------------------------------------------- queries

  /**
   * All bodies whose AABB overlaps `aabb`.
   * @param {CANNON.World} world
   * @param {CANNON.AABB} aabb
   * @param {CANNON.Body[]} [result]
   */
  aabbQuery(world, aabb, result = []) {
    this.ensureBinned(world);
    return this._query(aabb, result, true);
  }

  /** Like aabbQuery but only static bodies, and never triggers a dynamic re-bin. */
  queryStatic(world, aabb, result = []) {
    if (this.world !== world) this.setWorld(world);
    if (this.staticDirty) this._rebuildStatic(world);
    return this._query(aabb, result, false);
  }

  _query(aabb, result, includeDynamic) {
    const stamp = ++this.queryStamp;
    const push = (b) => {
      if (b.__gridStamp === stamp) return;
      b.__gridStamp = stamp;
      if (b.aabb.overlaps(aabb)) result.push(b);
    };

    const r = this._cellRange(aabb, {});
    if (!r || r.count > MAX_QUERY_CELLS) {
      for (const b of this.staticBodies) push(b);
      if (includeDynamic) for (const b of this.dynamicBodies) push(b);
      return result;
    }

    for (const b of this.staticOversize) push(b);
    if (includeDynamic) for (const b of this.dynamicOversize) push(b);
    for (let ix = r.x0; ix <= r.x1; ix++) {
      for (let iy = r.y0; iy <= r.y1; iy++) {
        for (let iz = r.z0; iz <= r.z1; iz++) {
          const k = cellKey(ix, iy, iz);
          const s = this.staticCells.get(k);
          if (s) for (let i = 0; i < s.length; i++) push(s[i]);
          if (includeDynamic) {
            const d = this.dynamicCells.get(k);
            if (d) for (let i = 0; i < d.length; i++) push(d[i]);
          }
        }
      }
    }
    return result;
  }

  /** Bodies in one cell (static and dynamic), for the raycaster's grid walk. */
  cellBodies(ix, iy, iz) {
    const k = cellKey(ix, iy, iz);
    return [this.staticCells.get(k), this.dynamicCells.get(k)];
  }

  /** World-space bounds of occupied cells, for the debug overlay. */
  occupiedCellBounds(kind = 'dynamic') {
    const keys = kind === 'static' ? [...this.staticCells.keys()] : this.dynamicKeys;
    const s = this.cellSize;
    return keys.map((k) => {
      const iz = (k % SPAN) - OFFSET;
      const iy = (Math.floor(k / SPAN) % SPAN) - OFFSET;
      const ix = Math.floor(k / (SPAN * SPAN)) - OFFSET;
      return { min: [ix * s, iy * s, iz * s], max: [(ix + 1) * s, (iy + 1) * s, (iz + 1) * s] };
    });
  }
}

export const GRID_INDEX_LIMIT = MAX_INDEX;
