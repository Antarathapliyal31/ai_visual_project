import { describe, it, expect } from 'vitest';
import { STATIC_BOXES, OCCLUDERS, HIDING_VOLUMES } from '../../src/collision/index.js';
import { BED_HEAD, BED_LIE, BED_SIT_EYE, BEDSIDE } from '../../src/ai/home.js';
import { INVENTORY, SHELL_IDS } from '../../src/levels/inventory.js';
import { compileLevel, makeTransform, placementTransform } from '../../src/levels/compile.js';
import { ORIGINAL } from '../../src/levels/index.js';

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const sameBox = (a, b) => a.id === b.id && close(a.center, b.center) && close(a.half, b.half)
  && Math.abs((a.rotY ?? 0) - (b.rotY ?? 0)) < 1e-9 && a.material === b.material && a.role === b.role;

describe('inventory', () => {
  it('splits the original room into the shell and pieces, every box exactly once', () => {
    const owned = Object.values(INVENTORY).flatMap((item) => item.boxes.map((b) => b.id));
    const ids = STATIC_BOXES.map((b) => b.id);
    for (const id of ids) {
      const n = owned.filter((o) => o === id).length + (SHELL_IDS.includes(id) ? 1 : 0);
      expect(n, id).toBe(1);
    }
  });

  it('compiling the original room gives back A\'s room box for box', () => {
    const level = compileLevel(ORIGINAL);
    expect(level.boxes).toHaveLength(STATIC_BOXES.length);
    for (const b of STATIC_BOXES) {
      const c = level.boxes.find((x) => x.id === b.id);
      expect(c, b.id).toBeTruthy();
      expect(sameBox(c, b), b.id).toBe(true);
    }
    expect(level.occluders).toHaveLength(OCCLUDERS.length);
    for (const b of OCCLUDERS) expect(sameBox(level.occluders.find((x) => x.id === b.id), b), b.id).toBe(true);
    for (const v of HIDING_VOLUMES) {
      const c = level.hidingVolumes.find((x) => x.id === v.id);
      expect(close(c.min, v.min) && close(c.max, v.max) && close(c.checkFrom, v.checkFrom), v.id).toBe(true);
    }
  });

  it("compiling the original room gives back the owner's home", () => {
    const { home } = compileLevel(ORIGINAL);
    expect(home.head).toMatchObject(BED_HEAD);
    expect(home.lie).toMatchObject(BED_LIE);
    expect(home.sitEye).toMatchObject(BED_SIT_EYE);
    expect(home.bedside).toEqual(BEDSIDE);
    expect(home.facing).toBe(0);
  });

  it('turns a piece in quarter turns about its centre, as rotY turns a box', () => {
    const T = makeTransform({ x: 0, z: 0 }, { x: 1, z: 2 }, 1);
    expect(T.point([1, 0.5, 0])).toEqual([1, 0.5, 1]); // +x -> -z at +90 degrees, then moved
    expect(T.point([0, 0, 1])).toEqual([2, 0, 2]);
  });

  it('stands a wall piece against any wall, back to the wall', () => {
    for (const wall of ['north', 'south', 'east', 'west']) {
      const level = compileLevel({ pieces: [{ item: 'desk', wall, at: 0 }] });
      const piece = level.pieces[0];
      const fp = piece.footprint;
      const gap = { north: fp.minZ - -3.0, south: 3.0 - fp.maxZ, west: fp.minX - -3.5, east: 3.5 - fp.maxX }[wall];
      expect(gap, wall).toBeLessThan(0.01);
      expect(gap, wall).toBeGreaterThan(-0.01);
    }
    expect(placementTransform({ item: 'bed', wall: 'north', at: 0 }).turns).toBe(3);
  });
});
