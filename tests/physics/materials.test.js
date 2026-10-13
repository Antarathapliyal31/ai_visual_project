import { describe, it, expect, vi, afterEach } from 'vitest';
import * as CANNON from 'cannon-es';
import { createMaterialTable, pairKey } from '../../src/physics/materials.js';
import { STATIC_BOXES, OCCLUDERS } from '../../src/collision/index.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';

afterEach(() => vi.restoreAllMocks());

describe('material table', () => {
  it('has a row with all four columns for every planned material', () => {
    const table = createMaterialTable(new CANNON.World());
    for (const name of ['ceramic', 'wood', 'paper', 'plastic', 'fabric', 'cat']) {
      const row = table.row(name);
      expect(table.names).toContain(name);
      expect(row.friction).toBeGreaterThanOrEqual(0);
      expect(row.restitution).toBeGreaterThanOrEqual(0);
      expect(row.restitution).toBeLessThan(1);
      expect(row.loudness).toBeGreaterThan(0);
      expect(row.stiffness).toBeGreaterThan(0);
      expect(row).toHaveProperty('breakImpulse');
    }
  });

  it("covers every material A's static geometry uses, without the fallback", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = createMaterialTable(new CANNON.World());
    for (const spec of [...STATIC_BOXES, ...OCCLUDERS]) {
      expect(table.names).toContain(spec.material);
      expect(table.get(spec.material).name).toBe(spec.material);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('combines a pair as sqrt(friction), min(restitution), sqrt(loudness)', () => {
    const table = createMaterialTable(new CANNON.World());
    const a = tuning.materials.plastic, b = tuning.materials.fabric; // no override for this pair
    expect(tuning.materialPairs[pairKey('plastic', 'fabric')]).toBeUndefined();
    expect(table.friction('plastic', 'fabric')).toBeCloseTo(Math.sqrt(a.friction * b.friction), 12);
    expect(table.restitution('plastic', 'fabric')).toBe(Math.min(a.restitution, b.restitution));
    expect(table.loudness('plastic', 'fabric')).toBeCloseTo(Math.sqrt(a.loudness * b.loudness), 12);
    expect(table.stiffness('plastic', 'fabric')).toBe(Math.min(a.stiffness, b.stiffness));
  });

  it('lets the softer material set the contact: plates are soft on the desk, the cat is stiff on it', () => {
    const table = createMaterialTable(new CANNON.World());
    const m = tuning.materials;
    expect(table.stiffness('ceramic', 'wood')).toBe(m.ceramic.stiffness);
    expect(table.stiffness('ceramic', 'ceramic')).toBe(m.ceramic.stiffness);
    expect(table.stiffness('cat', 'wood')).toBe(m.cat.stiffness);
    expect(table.stiffness('cat', 'ceramic')).toBe(m.ceramic.stiffness);
    // Light stackable props sink tens of microns; the cat must not squash into walls.
    expect(m.ceramic.stiffness).toBeLessThanOrEqual(1e5);
    expect(m.paper.stiffness).toBeLessThanOrEqual(1e5);
    expect(m.cat.stiffness).toBeGreaterThanOrEqual(1e6);
  });

  it('lets a pair override win, and is symmetric', () => {
    const table = createMaterialTable(new CANNON.World());
    const o = tuning.materialPairs['ceramic|wood'];
    expect(table.pair('ceramic', 'wood')).toMatchObject({ friction: o.friction, restitution: o.restitution, loudness: o.loudness });
    for (const [a, b] of [['ceramic', 'wood'], ['paper', 'fabric'], ['cat', 'ceramic']]) {
      expect(table.pair(a, b)).toEqual(table.pair(b, a));
      expect(pairKey(a, b)).toBe(pairKey(b, a));
    }
  });

  it('keeps every override key sorted, so none is silently ignored', () => {
    for (const key of Object.keys(tuning.materialPairs)) {
      const [a, b] = key.split('|');
      expect(pairKey(a, b)).toBe(key);
      expect(tuning.materials[a]).toBeDefined();
      expect(tuning.materials[b]).toBeDefined();
    }
  });

  it('registers one ContactMaterial per pair in the world, with the table numbers', () => {
    const world = new CANNON.World();
    const table = createMaterialTable(world);
    const names = table.names;
    for (const a of names) {
      for (const b of names) {
        const cm = world.getContactMaterial(table.get(a), table.get(b));
        expect(cm).toBeTruthy();
        expect(cm).toBe(table.contact(a, b));
        expect(cm.friction).toBe(table.friction(a, b));
        expect(cm.restitution).toBe(table.restitution(a, b));
        expect(cm.contactEquationStiffness).toBe(table.stiffness(a, b));
        expect(cm.contactEquationRelaxation).toBe(tuning.physics.contactRelaxation);
      }
    }
    expect(world.contactmaterials).toHaveLength((names.length * (names.length + 1)) / 2);
  });

  it("never sets friction on the cannon Material itself (it would bypass the pair table)", () => {
    const table = createMaterialTable(new CANNON.World());
    for (const name of table.names) {
      expect(table.get(name).friction).toBe(-1);
      expect(table.get(name).restitution).toBe(-1);
    }
  });

  it("gives the break impulses A's fracture was tuned with, and Infinity for unbreakable materials", () => {
    const table = createMaterialTable(new CANNON.World());
    const { plate, mug } = tuning.props;
    const defaults = tuning.collision.fracture.defaultBreakImpulse;
    expect(table.breakImpulse(plate.material, plate.breakScale)).toBeCloseTo(defaults.plate, 9);
    expect(table.breakImpulse(mug.material, mug.breakScale)).toBeCloseTo(defaults.mug, 9);
    for (const name of ['wood', 'paper', 'plastic', 'fabric', 'plaster', 'cat']) {
      expect(table.breakImpulse(name)).toBe(Infinity);
    }
  });

  it('makes a crash of ceramic louder than paper, and the cat nearly silent', () => {
    const table = createMaterialTable(new CANNON.World());
    expect(table.loudness('ceramic', 'wood')).toBeGreaterThan(table.loudness('paper', 'wood'));
    expect(table.loudness('ceramic', 'ceramic')).toBeGreaterThan(table.loudness('ceramic', 'fabric'));
    expect(table.loudness('cat', 'wood')).toBeLessThan(table.loudness('paper', 'wood'));
  });

  it('picks up live tuning edits on refresh()', () => {
    const t = freshTuning();
    const world = new CANNON.World();
    const table = createMaterialTable(world, t);
    t.materialPairs['ceramic|wood'].friction = 0.123;
    t.materials.plastic.restitution = 0.01;
    t.materials.paper.stiffness = 7e4;
    t.physics.contactStiffness = 5e5;
    t.physics.contactRelaxation = 5;
    table.refresh();
    expect(table.contact('ceramic', 'wood').friction).toBe(0.123);
    expect(table.contact('plastic', 'plastic').restitution).toBe(0.01);
    expect(table.contact('paper', 'paper').contactEquationStiffness).toBe(7e4);
    expect(table.contact('paper', 'paper').contactEquationRelaxation).toBe(5);
    expect(world.defaultContactMaterial.contactEquationStiffness).toBe(5e5);
  });

  it('falls back (and warns once) for a material with no row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const world = new CANNON.World();
    const table = createMaterialTable(world);
    const m = table.get('marble');
    expect(m.name).toBe('marble');
    expect(table.get('marble')).toBe(m);
    expect(world.getContactMaterial(m, table.get('wood'))).toBeTruthy();
    expect(table.friction('marble', 'marble')).toBeCloseTo(0.5, 12);
    expect(table.stiffness('marble', 'marble')).toBe(tuning.physics.contactStiffness);
    expect(table.breakImpulse('marble')).toBe(Infinity);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads the material name off a body', () => {
    const table = createMaterialTable(new CANNON.World());
    const body = new CANNON.Body({ mass: 1, material: table.get('paper') });
    expect(table.nameOf(body)).toBe('paper');
    expect(table.nameOf(new CANNON.Body({ mass: 1 }))).toBeNull();
  });
});
