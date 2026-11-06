import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { buildStaticGeometry, HIDING_VOLUMES } from '../../src/collision/staticGeometry.js';
import { UniformGridBroadphase } from '../../src/collision/gridBroadphase.js';
import { createRaycaster } from '../../src/collision/raycast.js';
import { hidingSpotAt, lineOfSight } from '../../src/collision/hiding.js';

function room() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new UniformGridBroadphase();
  const geo = buildStaticGeometry(world);
  return { world, geo, raycast: createRaycaster(world) };
}
const vol = (id) => HIDING_VOLUMES.find((v) => v.id === id);
const at = (v, y) => ({ x: v.checkFrom[0], y, z: v.checkFrom[2] });

describe('hiding volumes', () => {
  it('finds the volume a point is in', () => {
    expect(hidingSpotAt({ x: 0.3, y: 0.12, z: -2.8 }).id).toBe('underDesk');
    expect(hidingSpotAt({ x: -2.4, y: 0.12, z: -0.1 }).id).toBe('underBed');
    expect(hidingSpotAt({ x: 0, y: 0.12, z: 0 })).toBeNull();
  });
});

describe('sight through geometry', () => {
  const { raycast, geo } = room();
  const catUnderDesk = { x: 0.3, y: 0.12, z: -2.8 };
  const catUnderBed = { x: -2.4, y: 0.12, z: -0.1 };

  it('a standing owner cannot see a cat under the desk, near or far', () => {
    for (const eye of [{ x: -1.0, y: 1.6, z: 0 }, { x: 0.3, y: 1.6, z: 3.0 }, { x: 2.5, y: 1.6, z: 1.0 }]) {
      expect(lineOfSight(raycast, eye, catUnderDesk).visible).toBe(false);
    }
  });

  it('crouching at the check point sees under the desk', () => {
    expect(lineOfSight(raycast, at(vol('underDesk'), 0.2), catUnderDesk).visible).toBe(true);
  });

  it('the bed skirt blocks sight under the bed, even crouched', () => {
    const r = lineOfSight(raycast, at(vol('underBed'), 0.15), catUnderBed);
    expect(r.visible).toBe(false);
    expect(geo.occluders).toContain(r.blocker);
    expect(lineOfSight(raycast, { x: 0, y: 1.6, z: 1.5 }, catUnderBed).visible).toBe(false);
  });

  it('an open-floor cat is visible', () => {
    expect(lineOfSight(raycast, { x: -1.0, y: 1.6, z: 0 }, { x: 1.0, y: 0.12, z: 1.0 }).visible).toBe(true);
  });
});

describe('occluders vs bodies', () => {
  it('the cat walks through the bed skirt and ends up hidden', () => {
    const { world } = room();
    const cat = new CANNON.Body({ mass: 4, shape: new CANNON.Sphere(0.1), position: new CANNON.Vec3(-1.0, 0.1, -0.1) });
    cat.velocity.set(-2, 0, 0);
    world.addBody(cat);
    for (let i = 0; i < 60; i++) world.step(1 / 120);
    expect(cat.position.x).toBeLessThan(-1.46);
    expect(hidingSpotAt(cat.position)?.id).toBe('underBed');
  });
});
