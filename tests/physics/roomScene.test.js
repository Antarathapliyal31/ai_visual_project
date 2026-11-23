import { describe, it, expect } from 'vitest';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { spawnRoomScene } from '../../src/physics/roomScene.js';
import { createCat } from '../../src/player/cat.js';
import { SURFACES, STATIC_BOXES, ROOM } from '../../src/collision/index.js';
import { freshTuning } from '../helpers/tuning.js';
import { expectSameItems, expectIncludes } from '../helpers/same.js';

const box = (id) => STATIC_BOXES.find((b) => b.id === id);
const within = (p, id, margin = 0) => {
  const b = box(id);
  return Math.abs(p.x - b.center[0]) <= b.half[0] + margin && Math.abs(p.z - b.center[2]) <= b.half[2] + margin;
};
/** Do two AABBs overlap by more than a millimetre on every axis? */
function overlaps(a, b, eps = 0.001) {
  return ['x', 'y', 'z'].every((k) => a.lowerBound[k] + eps < b.upperBound[k] - eps && b.lowerBound[k] + eps < a.upperBound[k] - eps);
}

describe('room scene', () => {
  it('is the slice scene plus the four clusters', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const room = spawnRoomScene(physics);
    expect(room.plates).toHaveLength(5);
    expect(room.mugs).toHaveLength(2); // on the desk; a third is on the coffee table
    expect(room.lamps).toHaveLength(2);
    expect(room.pots).toHaveLength(4);
    expect(room.wallShelfBooks).toHaveLength(3);
    expect(room.shelfBooks.length).toBeGreaterThan(30);
    expect(room.clock.kind).toBe('clock');
    expect(room.pillow.kind).toBe('pillow');
    expect(room.balls).toHaveLength(3);
    expect(room.floorBooks).toHaveLength(2);
    expect(room.cushion.tag).toBe('cushion');
    expect(room.tableMug.kind).toBe('mug');
    expect(room.underTable).toHaveLength(2);
    expect(room.monitor.kind).toBe('monitor');
    expect(room.keyboard.kind).toBe('keyboard');
    expectSameItems(physics.props, room.all);
    expect(new Set(room.all).size).toBe(room.all.length);
    // Enough to fill the room, few enough for the 60-awake-bodies budget once the cat gets going.
    expect(room.all.length).toBeLessThan(80);
  });

  it('puts every cluster on its own piece of furniture', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const room = spawnRoomScene(physics);
    const [bedside, deskLamp] = room.lamps;
    expect(within(bedside.body.position, 'nightstand')).toBe(true);
    expect(bedside.body.position.y).toBeCloseTo(SURFACES.nightstandTop + bedside.halfHeight, 3);
    expect(within(room.clock.body.position, 'nightstand')).toBe(true);
    expect(within(deskLamp.body.position, 'deskTop')).toBe(true);
    expect(within(room.monitor.body.position, 'deskTop')).toBe(true);
    expect(within(room.keyboard.body.position, 'deskTop')).toBe(true);
    // The screen stands on its edge behind the keyboard.
    expect(room.monitor.body.position.y).toBeCloseTo(SURFACES.deskTop + room.monitor.halfHeight, 3);
    expect(room.monitor.body.position.z).toBeLessThan(room.keyboard.body.position.z);
    expect(within(room.pillow.body.position, 'bedMattress')).toBe(true);
    expect(room.pillow.body.position.y).toBeCloseTo(SURFACES.bedTop + room.pillow.halfHeight, 3);
    for (const b of room.wallShelfBooks) expect(within(b.body.position, 'wallShelf')).toBe(true);
    const [shelfPot, sillPot, topPot, floorPot] = room.pots;
    expect(within(shelfPot.body.position, 'wallShelf')).toBe(true);
    expect(within(sillPot.body.position, 'windowSill')).toBe(true);
    expect(topPot.body.position.y).toBeCloseTo(SURFACES.bookshelfTop + topPot.halfHeight, 3);
    expect(floorPot.body.position.y).toBeCloseTo(floorPot.halfHeight, 3);
    for (const b of room.balls.slice(0, 2)) expect(b.body.position.y).toBeCloseTo(b.halfHeight, 3);
    expect(within(room.balls[2].body.position, 'catTreePerch')).toBe(true);
    expect(room.balls[2].body.position.y).toBeCloseTo(SURFACES.catTreePerchTop + room.balls[2].halfHeight, 3);
    expect(within(room.couchCushion.body.position, 'couchSeat')).toBe(true);
    expect(room.couchCushion.body.position.y).toBeCloseTo(SURFACES.couchSeatTop + room.couchCushion.halfHeight, 3);
    for (const p of [room.tableMug, room.tableBook]) {
      expect(within(p.body.position, 'coffeeTableTop')).toBe(true);
      expect(p.body.position.y).toBeCloseTo(SURFACES.coffeeTableTop + p.halfHeight, 3);
    }
    for (const p of room.underTable) expect(within(p.body.position, 'coffeeTableShelf')).toBe(true);
    expect(room.cushion.body.position.y).toBeCloseTo(room.cushion.halfHeight, 3);
    // Every bookshelf book stands between the side panels, on one of the four shelves.
    const left = box('bookshelfSideL'), right = box('bookshelfSideR');
    for (const b of room.shelfBooks) {
      b.body.updateAABB();
      expect(b.body.aabb.lowerBound.x).toBeGreaterThan(left.center[0] + left.half[0]);
      expect(b.body.aabb.upperBound.x).toBeLessThan(right.center[0] - right.half[0]);
      const onShelf = SURFACES.bookshelfShelves.some((y) => b.body.aabb.lowerBound.y > y - 0.001 && b.body.aabb.upperBound.y < y + 0.47);
      expect(onShelf).toBe(true);
    }
  });

  it('spawns nothing overlapping furniture or another prop', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const room = spawnRoomScene(physics);
    for (const p of room.all) p.body.updateAABB();
    const clashes = [];
    room.all.forEach((p, i) => {
      for (let j = i + 1; j < room.all.length; j++) {
        if (overlaps(p.body.aabb, room.all[j].body.aabb)) clashes.push(`${p.kind} #${i} and ${room.all[j].kind} #${j}`);
      }
      for (const s of physics.staticGeometry.solids) {
        if (overlaps(p.body.aabb, s.aabb)) clashes.push(`${p.kind} #${i} and ${s.userData.staticId}`);
      }
    });
    expect(clashes).toEqual([]);
  });

  it('is the same room every time', () => {
    const positions = () => {
      const physics = createPhysicsWorld({ tuning: freshTuning() });
      return spawnRoomScene(physics).all.map((p) => [p.kind, ...p.body.position.toArray(), ...p.body.shapes[0].boundingSphereRadius.toFixed(6)]);
    };
    expect(positions()).toEqual(positions());
    const other = createPhysicsWorld({ tuning: freshTuning() });
    const seeded = spawnRoomScene(other, { seed: 7 }).shelfBooks.map((p) => p.body.position.x);
    const dflt = spawnRoomScene(createPhysicsWorld({ tuning: freshTuning() })).shelfBooks.map((p) => p.body.position.x);
    expect(seeded).not.toEqual(dflt);
  });

  it('sits still from the first step with sleeping off: nothing moves a millimetre in 10 s', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning(), allowSleep: false });
    const room = spawnRoomScene(physics);
    const start = room.all.map((p) => p.body.position.clone());
    let moved = 0, speed = 0;
    for (let i = 0; i < 1200; i++) {
      physics.step();
      room.all.forEach((p, k) => {
        moved = Math.max(moved, p.body.position.distanceTo(start[k]));
        speed = Math.max(speed, p.body.velocity.length());
      });
    }
    expect(moved).toBeLessThan(0.001);
    expect(speed).toBeLessThan(0.05);
    expect(physics.guard.stats.clamps).toBe(0);
  });

  it('is asleep within two seconds, so the full room costs nothing at rest', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const room = spawnRoomScene(physics);
    for (let i = 0; i < 240; i++) physics.step();
    expect(room.all.filter((p) => p.body.sleepState !== CANNON.Body.SLEEPING)).toHaveLength(0);
  });

  describe('the bookshelf, for the cat', () => {
    const NORTH = Math.PI / 2;
    /** The room, settled, with the cat on the floor at (x, z) facing the bookshelf. */
    function atTheShelf(x, z) {
      const physics = createPhysicsWorld({ tuning: freshTuning() });
      spawnRoomScene(physics);
      for (let i = 0; i < 240; i++) physics.step();
      const cat = createCat(physics, { position: [x, physics.tuning.cat.radius + 0.001, z], heading: NORTH });
      const books = physics.props.filter((p) => p.kind === 'book' && within(p.body.position, 'bookshelfPanel0'));
      const home = new Map(books.map((b) => [b, b.body.position.clone()]));
      const knocked = () => books.filter((b) => {
        const up = b.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
        return b.body.position.distanceTo(home.get(b)) > 0.25 || up.y < 0.64;
      }).length;
      const run = (s, input) => { if (input) cat.setInput(input); for (let i = 0; i < s * 120; i++) physics.step(); };
      return { physics, cat, run, knocked };
    }

    it('has room on its bottom shelf for the cat to walk into', () => {
      const { cat, run } = atTheShelf(3.25, -2.1);
      run(1.5, { forward: 1, turn: 0 });
      run(0.3, { forward: 0, turn: 0 });
      const panel = box('bookshelfPanel0');
      expect(cat.body.position.z).toBeLessThan(panel.center[2] + panel.half[2]); // in, past the front edge
      expect(cat.body.position.y).toBeCloseTo(panel.center[1] + panel.half[1] + cat.dims.radius, 1); // standing on the shelf
    });

    it('lets a cat inside a shelf sweep its books out of the front, on either of the two lowest shelves', () => {
      for (const [panel, label] of [['bookshelfPanel0', 'bottom'], ['bookshelfPanel1', 'second']]) {
        const b = box(panel), top = b.center[1] + b.half[1];
        const physics = createPhysicsWorld({ tuning: freshTuning() });
        spawnRoomScene(physics);
        for (let i = 0; i < 240; i++) physics.step();
        const r = physics.tuning.cat.radius;
        // In the opening at the right-hand end, facing along the shelf at its row of books.
        const cat = createCat(physics, { position: [3.3, top + r + 0.01, b.center[2] + 0.06], heading: Math.PI });
        const books = physics.props.filter((p) => p.kind === 'book' && Math.abs(p.body.position.y - top - 0.12) < 0.1 && within(p.body.position, panel));
        const home = new Map(books.map((p) => [p, p.body.position.clone()]));
        const run = (s, input) => { cat.setInput(input); for (let i = 0; i < s * 120; i++) physics.step(); };
        run(0.3, { forward: 0, turn: 0 });
        for (let k = 0; k < 4; k++) { run(0.05, { forward: 0, turn: 0, swat: true }); run(0.4, { forward: 0, turn: 0, swat: false }); }
        const out = books.filter((p) => p.body.position.z > b.center[2] + b.half[2] || p.body.position.distanceTo(home.get(p)) > 0.25);
        expect(out.length, label).toBeGreaterThanOrEqual(3);
      }
    });

    it('lets the cat knock books off the bottom shelf from the floor', () => {
      const { cat, run, knocked } = atTheShelf(2.8, -2.3);
      run(0.6, { forward: 1, turn: 0 }); // up to the shelf
      run(0.2, { forward: 0, turn: 0 });
      for (let k = 0; k < 4; k++) { run(0.05, { forward: 0, turn: 0, swat: true }); run(0.4, { forward: 0, turn: 0, swat: false }); }
      expect(knocked()).toBeGreaterThanOrEqual(3);
      expect(cat.state.swats).toBe(4);
    });
  });

  it('comes apart when the cat gets at it, and nothing leaves the room', () => {
    const physics = createPhysicsWorld({ tuning: freshTuning() });
    const room = spawnRoomScene(physics);
    for (let i = 0; i < 240; i++) physics.step();
    const r = physics.tuning.cat.radius;
    // On the desk in front of the desk lamp, facing it, then a swat.
    const lamp = room.lamps[1].body;
    const home = lamp.position.clone();
    const cat = createCat(physics, { position: [home.x, SURFACES.deskTop + r + 0.001, home.z + 0.45], heading: Math.PI / 2 });
    for (let i = 0; i < 30; i++) physics.step();
    const hits = cat.swat();
    expectIncludes(hits.map((h) => h.body), lamp);
    for (let i = 0; i < 360; i++) physics.step();
    const up = lamp.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    expect(up.y < 0.9 || lamp.position.distanceTo(home) > 0.05).toBe(true); // knocked over or moved
    for (const p of physics.props) {
      expect(p.body.position.y).toBeGreaterThan(-0.02);
      expect(p.body.position.x).toBeGreaterThan(ROOM.minX);
      expect(p.body.position.x).toBeLessThan(ROOM.maxX);
      expect(p.body.position.z).toBeGreaterThan(ROOM.minZ);
      expect(p.body.position.z).toBeLessThan(ROOM.maxZ);
    }
  });
});
