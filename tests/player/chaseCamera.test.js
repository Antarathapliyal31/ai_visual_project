import { describe, it, expect } from 'vitest';
import { createChaseCamera, CHASE } from '../../src/player/chaseCamera.js';
import { STATIC_BOXES, ROOM } from '../../src/collision/index.js';

const R = 0.12; // the cat's radius: its middle is this high on the floor
const cat = (x, z, heading, y = R) => ({ body: { position: { x, y, z } }, heading });
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const camera = () => createChaseCamera({ boxes: STATIC_BOXES, room: ROOM });
const deskTop = (() => { const b = STATIC_BOXES.find((s) => s.id === 'deskTop'); return b.center[1] + b.half[1]; })();
/** Degrees between where the camera looks and where the cat is: under 30, the cat is in a 60 degree view. */
const offCentre = ({ position: e, target: t }, p) => {
  const a = { x: t.x - e.x, y: t.y - e.y, z: t.z - e.z }, b = { x: p.x - e.x, y: p.y - e.y, z: p.z - e.z };
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
};
/** Degrees the camera looks down. */
const pitch = ({ position: e, target: t }) => (Math.atan2(e.y - t.y, Math.hypot(t.x - e.x, t.z - e.z)) * 180) / Math.PI;

describe('the chase camera', () => {
  it('sits behind the cat and a little above it, looking just ahead of it', () => {
    const cam = camera();
    const c = cat(0.5, 1.0, 0); // facing +x, in the open
    const { position, target } = cam.snap(c);
    expect(position.x).toBeCloseTo(0.5 - CHASE.distance, 2); // behind: -x
    expect(position.z).toBeCloseTo(1.0, 2);
    expect(position.y).toBeCloseTo(R + CHASE.height, 2);
    expect(target.x).toBeGreaterThan(0.5); // ahead of the cat
  });

  it('swings round behind the cat as it turns, with a lag', () => {
    const cam = camera();
    const c = cat(0.5, 1.0, 0);
    cam.snap(c);
    c.heading = Math.PI / 2; // now facing -z (north)
    cam.update(1 / 60, c);
    expect(cam.yaw).toBeGreaterThan(0);
    expect(cam.yaw).toBeLessThan(Math.PI / 4); // a sixtieth of a second in, not even half way round
    let p;
    for (let i = 0; i < 180; i++) p = cam.update(1 / 60, c).position;
    expect(cam.yaw).toBeCloseTo(Math.PI / 2, 1);
    expect(p.z).toBeGreaterThan(1.0 + CHASE.distance * 0.9); // behind a cat facing north is south
    expect(Math.abs(p.x - 0.5)).toBeLessThan(0.15);
  });

  it('comes in front of a wall behind the cat instead of going through it', () => {
    const cam = camera();
    const c = cat(1.0, 2.2, Math.PI / 2); // facing north, 0.8 m from the south wall behind it
    const view = cam.snap(c);
    expect(view.position.z).toBeLessThan(ROOM.maxZ);
    expect(flat(view.position, c.body.position)).toBeLessThan(CHASE.distance - 0.5); // pulled in
    expect(cam.inside(view.position)).toBe(false);
    expect(offCentre(view, c.body.position)).toBeLessThan(25); // the cat still in view
  });

  it('looks over furniture right behind the cat rather than into it', () => {
    const cam = camera();
    const c = cat(0.3, -1.95, -Math.PI / 2); // facing south, its back to the desk, 25 cm from it
    const { position } = cam.snap(c);
    expect(cam.inside(position)).toBe(false);
    expect(position.y).toBeGreaterThan(deskTop);
  });

  it('comes in close over the head of a cat with its back to a wall, not up to the ceiling', () => {
    const cam = camera();
    const c = cat(0.4, -2.55, -Math.PI / 2, deskTop + R); // on the desk, facing the room, 45 cm from the wall behind
    const view = cam.snap(c);
    expect(cam.inside(view.position)).toBe(false);
    expect(view.position.z).toBeLessThan(c.body.position.z); // still behind it
    expect(view.position.y - c.body.position.y).toBeLessThan(0.7); // just over its head
    expect(pitch(view)).toBeLessThan(51); // looking out over the room, not down at a map of it
    expect(offCentre(view, c.body.position)).toBeLessThan(25);
  });

  it('never looks straight down, even with the cat backed right up against a wall', () => {
    const cam = camera();
    const c = cat(1.0, ROOM.maxZ - R - 0.01, Math.PI / 2); // facing north, its tail on the south wall
    const view = cam.snap(c);
    expect(cam.inside(view.position)).toBe(false);
    expect(pitch(view)).toBeLessThan(CHASE.steepest * (180 / Math.PI) + 1);
  });

  it('watches a cat under the bed from above the bed, not from inside it', () => {
    const cam = camera();
    const { position } = cam.snap(cat(-2.4, -0.1, 0)); // under the bed
    expect(cam.inside(position)).toBe(false);
    expect(position.y).toBeGreaterThan(0.75); // above the mattress
  });

  it('watches a cat under the desk from above the desk, not from the dark space under it', () => {
    const cam = camera();
    const c = cat(0.4, -2.55, -Math.PI / 2); // under the desk, facing out
    const view = cam.snap(c);
    expect(cam.inside(view.position)).toBe(false);
    expect(view.position.y).toBeGreaterThan(deskTop);
    expect(pitch(view)).toBeLessThan(51);
  });

  it('never leaves the room or ends up inside furniture, wherever the cat goes', () => {
    const cam = camera();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let tried = 0, i = 0; i < 300 && tried < 3000; tried++) {
      const c = cat(ROOM.minX + 0.2 + rand() * (ROOM.maxX - ROOM.minX - 0.4), ROOM.minZ + 0.2 + rand() * (ROOM.maxZ - ROOM.minZ - 0.4), rand() * Math.PI * 2);
      if (cam.inside(c.body.position)) continue; // only where a cat can be
      i++;
      const { position, target } = cam.snap(c);
      expect(position.x).toBeGreaterThan(ROOM.minX);
      expect(position.x).toBeLessThan(ROOM.maxX);
      expect(position.z).toBeGreaterThan(ROOM.minZ);
      expect(position.z).toBeLessThan(ROOM.maxZ);
      expect(position.y).toBeLessThan(ROOM.wallHeight);
      const at = `cat at ${c.body.position.x.toFixed(2)}, ${c.body.position.z.toFixed(2)}`;
      expect(cam.inside(position), at).toBe(false);
      expect(pitch({ position, target }), at).toBeLessThan(CHASE.steepest * (180 / Math.PI) + 0.5);
    }
  });
});
