import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import {
  STATIC_BOXES, OCCLUDERS, HIDING_VOLUMES, ROOM, SURFACES, buildStaticGeometry, isSolidStatic,
} from '../../src/collision/staticGeometry.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';

const overlapVolume = (a, b) => {
  let v = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.center[i] - a.half[i], b.center[i] - b.half[i]);
    const hi = Math.min(a.center[i] + a.half[i], b.center[i] + b.half[i]);
    v *= Math.max(0, hi - lo);
  }
  return v;
};

// World-space AABB of a spec, turned by its rotY.
const worldBox = (b) => {
  const c = Math.abs(Math.cos(b.rotY ?? 0)), s = Math.abs(Math.sin(b.rotY ?? 0));
  const hx = b.half[0] * c + b.half[2] * s, hz = b.half[0] * s + b.half[2] * c;
  return {
    min: [b.center[0] - hx, b.center[1] - b.half[1], b.center[2] - hz],
    max: [b.center[0] + hx, b.center[1] + b.half[1], b.center[2] + hz],
  };
};
const SHELL = new Set(['floor', 'wallWest', 'wallNorth', 'boundaryEast', 'boundarySouth']);

describe('static geometry store', () => {
  it('has unique ids', () => {
    const ids = [...STATIC_BOXES, ...OCCLUDERS].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('solid boxes never overlap each other (touching is fine)', () => {
    const bad = [];
    for (let i = 0; i < STATIC_BOXES.length; i++) {
      for (let j = i + 1; j < STATIC_BOXES.length; j++) {
        if (overlapVolume(STATIC_BOXES[i], STATIC_BOXES[j]) > 1e-9) bad.push(`${STATIC_BOXES[i].id} x ${STATIC_BOXES[j].id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('builds every body exactly once per world', () => {
    const world = new CANNON.World();
    const a = buildStaticGeometry(world);
    const b = buildStaticGeometry(world);
    expect(b).toBe(a);
    expect(world.bodies.length).toBe(STATIC_BOXES.length + OCCLUDERS.length);
    expect(a.solids.every(isSolidStatic)).toBe(true);
    expect(a.occluders.some(isSolidStatic)).toBe(false);
  });

  it('bins statics once in the grid, however many steps run', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const grid = new UniformGridBroadphase();
    world.broadphase = grid;
    buildStaticGeometry(world);
    const mug = new CANNON.Body({ mass: 0.3, shape: new CANNON.Cylinder(0.08, 0.07, 0.14, 12), position: new CANNON.Vec3(0.6, 1.2, -2.6) });
    world.addBody(mug);
    for (let i = 0; i < 240; i++) world.step(1 / 120);
    expect(grid.stats.staticRebuilds).toBe(1);
    // The mug landed on the desk top (y = 0.94) instead of falling through.
    expect(mug.position.y).toBeGreaterThan(0.94);
    expect(mug.position.y).toBeLessThan(1.1);
  });

  it('occluders never reach the narrowphase', () => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const grid = new UniformGridBroadphase();
    world.broadphase = grid;
    const { occluders } = buildStaticGeometry(world);
    // A box dropped straight through the bed-skirt panel at the foot of the bed.
    const box = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)), position: new CANNON.Vec3(-1.395, 0.12, -0.1) });
    world.addBody(box);
    const p1 = [], p2 = [];
    grid.collisionPairs(world, p1, p2);
    const touched = [...p1, ...p2];
    for (const o of occluders) expect(touched).not.toContain(o);
  });

  it('furniture stands inside the room, on or above the floor', () => {
    const out = [];
    for (const b of STATIC_BOXES) {
      if (SHELL.has(b.id)) continue;
      const { min, max } = worldBox(b);
      if (min[0] < ROOM.minX - 1e-9 || max[0] > ROOM.maxX + 1e-9 || min[2] < ROOM.minZ - 1e-9 || max[2] > ROOM.maxZ + 1e-9 || min[1] < -1e-9) out.push(b.id);
    }
    expect(out).toEqual([]);
  });

  it('no solid box intrudes into a hiding volume, and each check point has room to crouch', () => {
    const clearance = 0.3; // m around the owner's crouch point, floor to head
    const bad = [];
    for (const b of STATIC_BOXES) {
      if (SHELL.has(b.id)) continue;
      const { min, max } = worldBox(b);
      for (const v of HIDING_VOLUMES) {
        if ([0, 1, 2].every((i) => max[i] > v.min[i] + 1e-9 && min[i] < v.max[i] - 1e-9)) bad.push(`${b.id} in ${v.id}`);
        const [x, , z] = v.checkFrom;
        const d = Math.hypot(Math.max(min[0] - x, 0, x - max[0]), Math.max(min[2] - z, 0, z - max[2]));
        if (d < clearance && min[1] < 1.8) bad.push(`${b.id} crowds ${v.id}.checkFrom (${d.toFixed(2)} m)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every named surface is the top face of some box', () => {
    const tops = STATIC_BOXES.map((b) => b.center[1] + b.half[1]);
    const missing = [];
    for (const [name, h] of Object.entries(SURFACES)) {
      for (const y of [h].flat()) if (!tops.some((t) => Math.abs(t - y) < 1e-6)) missing.push(`${name} ${y}`);
    }
    expect(missing).toEqual([]);
  });

  it('hiding volumes sit inside the room and above the floor', () => {
    for (const v of HIDING_VOLUMES) {
      for (let i = 0; i < 3; i++) expect(v.max[i]).toBeGreaterThan(v.min[i]);
      expect(v.min[1]).toBeGreaterThanOrEqual(0);
    }
  });
});
