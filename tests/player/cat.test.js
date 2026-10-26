import { describe, it, expect, vi } from 'vitest';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { spawnSliceScene } from '../../src/physics/sliceScene.js';
import { createCat } from '../../src/player/cat.js';
import { inputFromKeys, cameraRelativeInput, CAT_KEYS } from '../../src/player/input.js';
import { hidingSpotAt, SURFACES, ROOM, STATIC_BOXES } from '../../src/collision/index.js';
import { CAT, STATIC } from '../../src/core/groups.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';
import { expectSame, expectIncludes } from '../helpers/same.js';

const R = tuning.cat.radius;
const HL = tuning.cat.bodyHalfLength;
const NOSE = HL + R;             // centre to the tip of the nose
const FLOOR_Y = R + 0.001;       // centre height standing on the floor
const NORTH = Math.PI / 2;       // heading that faces -z (the desk wall)
const WEST = Math.PI;            // faces -x (the bed)
const box = (id) => STATIC_BOXES.find((b) => b.id === id);

function setup(opts = {}) {
  const physics = createPhysicsWorld({ tuning: opts.tuning ?? freshTuning(), ...opts.world });
  const cat = createCat(physics, { position: [0, FLOOR_Y, 1], heading: NORTH, ...opts.cat });
  const run = (seconds, each) => {
    const n = Math.round(seconds * 120);
    for (let i = 0; i < n; i++) {
      physics.step();
      each?.(i);
    }
  };
  run(0.25); // stand
  return { physics, cat, run };
}

/** Press jump for one step. */
function tapJump(s) {
  s.cat.setInput({ jump: true });
  s.physics.step();
  s.cat.setInput({ jump: false });
}

describe('cat collider', () => {
  it('is short enough for both hiding spots (README integration rule 3)', () => {
    const { cat } = setup();
    expect(cat.dims.height).toBeLessThan(0.26); // desk modesty panel
    expect(cat.dims.height).toBeLessThan(0.28); // bed platform
    const deskGap = box('deskModesty').center[1] - box('deskModesty').half[1];
    const bedGap = box('bedPlatform').center[1] - box('bedPlatform').half[1];
    expect(cat.dims.height).toBeLessThan(deskGap);
    expect(cat.dims.height).toBeLessThan(bedGap);
  });

  it('is a dynamic CAT-group body with fixed rotation that never sleeps', () => {
    const { cat } = setup();
    const b = cat.body;
    expect(b.type).toBe(CANNON.Body.DYNAMIC);
    expect(b.collisionFilterGroup).toBe(CAT);
    expect(b.fixedRotation).toBe(true);
    expect(b.invInertia.length()).toBe(0);
    expect(b.allowSleep).toBe(false);
    expect(b.mass).toBe(tuning.cat.mass);
    expect(b.material.name).toBe('cat');
    expect(b.shapes).toHaveLength(2);
    expect(cat.dims).toMatchObject({ radius: R, length: 2 * NOSE, width: 2 * R });
  });

  it('can be a single sphere', () => {
    const { cat, run } = setup({ tuning: freshTuning((t) => { t.cat.bodyHalfLength = 0; }) });
    expect(cat.body.shapes).toHaveLength(1);
    cat.setInput({ forward: 1 });
    run(1);
    expect(cat.state.speed).toBeCloseTo(tuning.cat.speed, 1);
  });
});

describe('cat movement', () => {
  it('stands on the floor, grounded, at rest', () => {
    const { cat, run } = setup();
    run(1);
    expect(cat.state.grounded).toBe(true);
    expect(cat.state.groundBody.userData.staticId).toBe('floor');
    expect(cat.body.position.y).toBeCloseTo(R, 2);
    expect(cat.body.velocity.length()).toBeLessThan(0.01);
    expect(cat.body.position.x).toBeCloseTo(0, 6);
    expect(cat.body.position.z).toBeCloseTo(1, 6);
  });

  it('drives forward along its heading at the tuned speed, and stops when released', () => {
    const { cat, run } = setup();
    cat.setInput({ forward: 1 });
    run(0.5);
    expect(cat.state.speed).toBeCloseTo(tuning.cat.speed, 2);
    expect(cat.body.velocity.z).toBeCloseTo(-tuning.cat.speed, 2); // heading north = -z
    expect(Math.abs(cat.body.velocity.x)).toBeLessThan(1e-6);
    expect(cat.body.position.z).toBeLessThan(1 - 1.2);
    cat.setInput({ forward: 0 });
    run(0.15);
    expect(cat.state.speed).toBeLessThan(0.01);
    const z = cat.body.position.z;
    run(0.5);
    expect(cat.body.position.z).toBeCloseTo(z, 4); // no creep on a frictionless floor
  });

  it('accelerates, it does not snap to full speed', () => {
    const { cat, physics } = setup();
    cat.setInput({ forward: 1 });
    physics.step();
    expect(cat.body.velocity.length()).toBeCloseTo(tuning.cat.groundAccel / 120, 6);
  });

  it('reports its real speed: zero when it is pushing against a wall', () => {
    const { cat, run } = setup({ cat: { position: [-1.0, FLOOR_Y, -2.0], heading: NORTH } });
    cat.setInput({ forward: 1 });
    run(1.5);
    expect(cat.state.speed).toBeLessThan(0.01);
  });

  it('reverses more slowly than it walks', () => {
    const { cat, run } = setup();
    cat.setInput({ forward: -1 });
    run(0.5);
    expect(cat.state.speed).toBeCloseTo(tuning.cat.speed * tuning.cat.reverseFactor, 2);
    expect(cat.body.velocity.z).toBeGreaterThan(0); // backing away from the wall it faces
  });

  it('heading 0 faces +x and turning left raises it', () => {
    const { cat, run } = setup({ cat: { heading: 0, position: [0, FLOOR_Y, 1] } });
    expect(cat.forward()).toMatchObject({ x: 1, y: 0 });
    cat.setInput({ turn: 1 });
    run(0.25);
    expect(cat.heading).toBeCloseTo(tuning.cat.turnRate * 0.25, 6);
    cat.setInput({ turn: -1 });
    run(0.5);
    expect(cat.heading).toBeCloseTo(-tuning.cat.turnRate * 0.25, 6);
    expect(cat.body.position.x).toBeCloseTo(0, 4); // turning on the spot
  });

  it("keeps the body's yaw equal to the heading, so the mesh needs no special case", () => {
    const { cat, run } = setup();
    cat.setInput({ forward: 1, turn: 1 });
    run(0.7, () => {
      const f = cat.forward();
      const nose = cat.body.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
      // cannon-es integrates the quaternion to first order, so within a
      // step the yaw is a few microradians off; it is re-synced every step.
      expect(nose.x).toBeCloseTo(f.x, 4);
      expect(nose.y).toBeCloseTo(0, 9);
      expect(nose.z).toBeCloseTo(f.z, 4);
    });
    expect(cat.heading).not.toBeCloseTo(NORTH, 1);
  });

  it('steers towards a world direction when given `move` (camera-relative input)', () => {
    const { cat, run } = setup({ cat: { position: [0, FLOOR_Y, -1.5], heading: NORTH } });
    cat.setInput({ move: { x: 0, z: 1 } }); // run south: it has to turn right around first
    run(1);
    expect(cat.heading).toBeCloseTo(-Math.PI / 2, 2);
    expect(cat.body.velocity.z).toBeCloseTo(tuning.cat.speed, 2);
    expect(Math.abs(cat.body.velocity.x)).toBeLessThan(0.01);
    expect(cat.body.position.z).toBeGreaterThan(-1.5 + 1.5);
    cat.setInput({ move: { x: 0, z: 0 } });
    run(0.2);
    expect(cat.state.speed).toBeLessThan(0.01);
  });
});

describe('cat against the room', () => {
  it('is stopped by a wall, without climbing it or sticking to it', () => {
    // The corridor between the bed and the desk leads straight to the north wall.
    const { cat, run } = setup({ cat: { position: [-1.0, FLOOR_Y, 0], heading: NORTH } });
    cat.setInput({ forward: 1 });
    let minZ = Infinity, maxY = 0;
    run(2.5, () => {
      minZ = Math.min(minZ, cat.body.position.z);
      maxY = Math.max(maxY, cat.body.position.y);
    });
    const stop = ROOM.minZ + NOSE; // nose on the wall
    expect(minZ).toBeGreaterThan(stop - 0.015); // at most a 1.5 cm squash on impact
    expect(cat.body.position.z).toBeCloseTo(stop, 2);
    expect(maxY).toBeLessThan(R + 0.005);
    // Let go: it stays put instead of being thrown back.
    cat.setInput({ forward: 0 });
    run(0.5);
    expect(cat.body.position.z).toBeCloseTo(stop, 2);
    expect(cat.state.grounded).toBe(true);
  });

  it('slides along a wall it meets at an angle', () => {
    const { cat, run } = setup({ cat: { position: [-1.0, FLOOR_Y, 2.4], heading: -Math.PI / 4 } }); // south-east
    cat.setInput({ forward: 1 });
    run(1.5);
    expect(cat.body.position.z).toBeLessThan(ROOM.maxZ - R + 0.02);
    expect(cat.body.position.x).toBeGreaterThan(1.0); // kept moving east along the wall
  });

  it('never leaves the room, whichever way it runs', () => {
    for (const heading of [0, NORTH, WEST, -Math.PI / 2, 0.7, 2.4, -2.4, -0.7]) {
      const { cat, run } = setup({ cat: { position: [-1.0, FLOOR_Y, 1.5], heading } });
      cat.setInput({ forward: 1 });
      run(3, () => {
        const p = cat.body.position;
        expect(p.x).toBeGreaterThan(ROOM.minX);
        expect(p.x).toBeLessThan(ROOM.maxX);
        expect(p.z).toBeGreaterThan(ROOM.minZ);
        expect(p.z).toBeLessThan(ROOM.maxZ);
        expect(p.y).toBeGreaterThan(R - 0.03);
      });
      // The walls stopped it: the room bounds never had to.
      expect(cat.state.boundsHits).toBe(0);
    }
  });

  // The professor's review: the cat could jump out of the scene. The walls are
  // 2.8 m high and the bookshelf top is 2.0 m, so a full jump from there
  // (apex 3.1 m) cleared them.
  const ON_BOOKSHELF = SURFACES.bookshelfTop + R + 0.01;
  const leaps = [['north wall', [3.05, ON_BOOKSHELF, -2.85], NORTH], ['open east side', [3.2, ON_BOOKSHELF, -2.85], 0]];

  it('cannot jump out over the walls: a leap off the bookshelf stays under the wall tops', () => {
    for (const [label, position, heading] of leaps) {
      const s = setup({ cat: { position, heading } });
      s.cat.setInput({ forward: 1 });
      tapJump(s);
      let maxY = 0;
      s.run(3, () => {
        const p = s.cat.body.position;
        maxY = Math.max(maxY, p.y);
        expect(p.x, label).toBeLessThan(ROOM.maxX);
        expect(p.z, label).toBeGreaterThan(ROOM.minZ);
      });
      // At most one step of overshoot past the wall tops before it is put back.
      expect(maxY, label).toBeLessThan(ROOM.wallHeight - R + 0.04);
      expect(s.cat.state.boundsHits, label).toBeGreaterThan(0);
      expect(s.cat.state.grounded, label).toBe(true); // landed back on the bookshelf
      expect(s.cat.body.position.y, label).toBeCloseTo(ON_BOOKSHELF - 0.01, 2);
    }
  });

  it('without the room bounds the same leap clears the wall and falls out of the world', () => {
    const [, position, heading] = leaps[0];
    const s = setup({ tuning: freshTuning((t) => { t.cat.bounds.enabled = false; }), cat: { position, heading } });
    s.cat.setInput({ forward: 1 });
    tapJump(s);
    s.run(3);
    expect(s.cat.body.position.z).toBeLessThan(ROOM.minZ);
    expect(s.cat.body.position.y).toBeLessThan(0);
  });

  it('puts the cat back inside if something moves it out of the room', () => {
    const s = setup();
    s.cat.teleport([ROOM.maxX + 1, FLOOR_Y, 0], 0); // facing +x, past the open east side
    s.run(0.25);
    const p = s.cat.body.position;
    expect(p.x).toBeLessThan(ROOM.maxX - NOSE + tuning.cat.bounds.slack + 1e-6);
    expect(p.y).toBeCloseTo(R, 2);
    expect(s.cat.state.boundsHits).toBeGreaterThan(0);
  });

  it('respawns where it last stood if it ever falls out of the world', () => {
    const s = setup({ cat: { position: [-1.0, FLOOR_Y, 1.5], heading: NORTH } });
    s.run(0.5);
    const stood = s.cat.body.position.clone();
    s.cat.teleport([-1.0, -3, 1.5]); // under the floor
    s.run(2 / 120);
    expect(s.cat.state.respawns).toBe(1);
    expect(s.cat.body.position.distanceTo(stood)).toBeLessThan(0.01);
    s.run(0.5);
    expect(s.cat.state.grounded).toBe(true);
  });

  it('stays upright whatever hits it', () => {
    const { physics, cat, run } = setup();
    const mug = physics.spawn('mug', { position: [0.05, 0.6, 1.02] });
    mug.body.velocity.set(0, -8, 0);
    cat.setInput({ forward: 1, turn: 1 });
    run(1, () => {
      const q = cat.body.quaternion;
      expect(Math.abs(q.x)).toBeLessThan(1e-9);
      expect(Math.abs(q.z)).toBeLessThan(1e-9);
      expect(cat.body.angularVelocity.x).toBe(0);
      expect(cat.body.angularVelocity.z).toBe(0);
    });
  });

  it('walks under the desk and counts as hidden there', () => {
    const { cat, run } = setup({ cat: { position: [0.3, FLOOR_Y, -1.5], heading: NORTH } });
    expect(hidingSpotAt(cat.body.position)).toBeNull();
    cat.setInput({ forward: 1 });
    let maxY = 0;
    run(1.5, () => { maxY = Math.max(maxY, cat.body.position.y); });
    expect(hidingSpotAt(cat.body.position)?.id).toBe('underDesk');
    expect(cat.body.position.z).toBeLessThan(-2.3);
    expect(maxY).toBeLessThan(R + 0.005); // went under the panel, not over or into it
  });

  it('walks through the bed skirt and counts as hidden under the bed', () => {
    const { cat, run } = setup({ cat: { position: [-0.8, FLOOR_Y, -0.1], heading: WEST } });
    cat.setInput({ forward: 1 });
    run(1.5);
    expect(hidingSpotAt(cat.body.position)?.id).toBe('underBed');
    expect(cat.body.position.x).toBeLessThan(-2.0);
    expect(cat.state.grounded).toBe(true); // the skirt is not something it can stand on
    expect(cat.state.groundBody.userData.staticId).toBe('floor');
  });

  it('the height limit is real: a 28 cm cat is stopped by the desk panel', () => {
    const { cat, run } = setup({
      tuning: freshTuning((t) => { t.cat.radius = 0.14; }),
      cat: { position: [0.3, 0.141, -1.5], heading: NORTH },
    });
    cat.setInput({ forward: 1 });
    run(2);
    expect(hidingSpotAt(cat.body.position)).toBeNull();
    expect(cat.body.position.z).toBeGreaterThan(-2.21);
  });
});

describe('cat jump', () => {
  it('reaches the tuned jump height', () => {
    const s = setup();
    tapJump(s);
    let apex = 0;
    s.run(1.2, () => { apex = Math.max(apex, s.cat.body.position.y - R); });
    expect(apex).toBeGreaterThan(tuning.cat.jumpHeight - 0.015);
    expect(apex).toBeLessThan(tuning.cat.jumpHeight + 0.015);
    expect(apex).toBeGreaterThan(SURFACES.deskTop + 0.1); // clears the desk
    expect(s.cat.state.grounded).toBe(true);
    expect(s.cat.state.jumps).toBe(1);
  });

  it('cannot jump again in mid-air', () => {
    const s = setup();
    tapJump(s);
    s.run(0.25);
    expect(s.cat.state.grounded).toBe(false);
    const vy = s.cat.body.velocity.y;
    tapJump(s);
    s.run(0.2); // longer than the jump buffer
    expect(s.cat.body.velocity.y).toBeLessThan(vy);
    expect(s.cat.state.jumps).toBe(1);
  });

  it('remembers a press made just before landing', () => {
    const s = setup();
    tapJump(s);
    // Fall until the feet are about 3 cm above the floor, on the way down.
    for (let i = 0; i < 400 && !(s.cat.body.velocity.y < 0 && s.cat.body.position.y - R < 0.07); i++) s.physics.step();
    expect(s.cat.state.grounded).toBe(false);
    tapJump(s);
    let apex = 0;
    s.run(0.6, () => { apex = Math.max(apex, s.cat.body.position.y - R); });
    expect(s.cat.state.jumps).toBe(2);
    expect(apex).toBeGreaterThan(tuning.cat.jumpHeight - 0.05);
  });

  it('holding the key does not make it bounce', () => {
    const s = setup();
    s.cat.setInput({ jump: true });
    s.run(3);
    expect(s.cat.state.jumps).toBe(1);
  });

  it('allows a jump just after walking off a ledge, but not later', () => {
    const attempt = (delaySteps) => {
      // On the desk, walking south off its front edge (at its left end, clear of the chair).
      const s = setup({ cat: { position: [-0.2, SURFACES.deskTop + R + 0.001, -2.6], heading: -Math.PI / 2 } });
      expect(s.cat.state.groundBody.userData.staticId).toBe('deskTop');
      s.cat.setInput({ forward: 1 });
      for (let i = 0; i < 400 && s.cat.state.grounded; i++) s.physics.step();
      expect(s.cat.state.grounded).toBe(false);
      for (let i = 0; i < delaySteps; i++) s.physics.step();
      tapJump(s);
      return s.cat.state.jumps;
    };
    expect(attempt(3)).toBe(1);   // 25 ms after the edge: inside the coyote window
    expect(attempt(30)).toBe(0);  // a quarter of a second later: falling
  });

  it('jumps from the floor onto the desk', () => {
    const s = setup({ cat: { position: [-0.2, FLOOR_Y, -1.2], heading: NORTH } });
    s.cat.setInput({ forward: 1 });
    tapJump(s);
    s.run(0.55);
    s.cat.setInput({ forward: 0 });
    s.run(1);
    expect(s.cat.state.grounded).toBe(true);
    expect(s.cat.state.groundBody.userData.staticId).toBe('deskTop');
    expect(s.cat.body.position.y).toBeCloseTo(SURFACES.deskTop + R, 2);
  });

  it('can use the furniture as steps: chair seat, couch, coffee table, cat tree', () => {
    for (const [id, surface] of [['chairSeat', 'chairSeatTop'], ['couchSeat', 'couchSeatTop'], ['coffeeTableTop', 'coffeeTableTop'], ['catTreePerch', 'catTreePerchTop'], ['aquariumLid', 'aquariumTop']]) {
      const b = box(id);
      const s = setup({ cat: { position: [b.center[0], SURFACES[surface] + R + 0.05, b.center[2]], heading: NORTH } });
      s.run(0.6);
      expect(s.cat.state.grounded, id).toBe(true);
      expect(s.cat.state.groundBody.userData.staticId, id).toBe(id);
      expect(s.cat.body.position.y, id).toBeCloseTo(SURFACES[surface] + R, 2);
    }
    // Every one of them is within a jump of the floor or of the step before it.
    expect(SURFACES.chairSeatTop).toBeLessThan(tuning.cat.jumpHeight);
    expect(SURFACES.deskTop - SURFACES.chairSeatTop).toBeLessThan(tuning.cat.jumpHeight);
    expect(SURFACES.catTreePerchTop - SURFACES.catTreeHouseTop).toBeLessThan(tuning.cat.jumpHeight);
    expect(SURFACES.aquariumTop - SURFACES.nightstandTop).toBeLessThan(tuning.cat.jumpHeight);
  });

  it('fits between the coffee table\'s shelf and its top', () => {
    const top = box('coffeeTableTop'), shelf = box('coffeeTableShelf');
    const gap = top.center[1] - top.half[1] - SURFACES.coffeeTableShelfTop;
    expect(2 * R).toBeLessThan(gap);
    const s = setup({ cat: { position: [shelf.center[0], SURFACES.coffeeTableShelfTop + R + 0.002, shelf.center[2]], heading: NORTH } });
    s.run(0.5);
    expect(s.cat.state.groundBody.userData.staticId).toBe('coffeeTableShelf');
    expect(s.cat.body.position.y).toBeCloseTo(SURFACES.coffeeTableShelfTop + R, 2);
  });

  it('reports jumps and landings', () => {
    const onJump = vi.fn(), onLand = vi.fn();
    const s = setup({ cat: { onJump, onLand } });
    onLand.mockClear();
    tapJump(s);
    s.run(1.2);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onLand).toHaveBeenCalledTimes(1);
    // Touch-down speed from a 1.1 m apex is about 4.6 m/s.
    expect(onLand.mock.calls[0][0]).toBeGreaterThan(4);
    expect(onLand.mock.calls[0][0]).toBeLessThan(5);
  });

  it('lands a full jump with less than 2 cm of squash', () => {
    const s = setup();
    tapJump(s);
    let minY = Infinity;
    s.run(1.2, () => { minY = Math.min(minY, s.cat.body.position.y); });
    expect(minY).toBeGreaterThan(R - 0.02);
    expect(s.cat.body.position.y).toBeCloseTo(R, 2);
  });

  it('lands a fall from above the bookshelf: one step of squash, then back on its feet', () => {
    const s = setup({ cat: { position: [-1.0, 2.5, 1.5], heading: NORTH } });
    let minY = Infinity;
    s.run(2, () => { minY = Math.min(minY, s.cat.body.position.y); });
    // It arrives at 6.8 m/s, 5.7 cm per step, so that is the most it can dip
    // before the contact exists. It never gets near the floor's mid-plane.
    expect(minY).toBeGreaterThan(R - 0.06);
    expect(s.cat.body.position.y).toBeCloseTo(R, 2);
    expect(s.cat.state.grounded).toBe(true);
    expect(s.physics.guard.stats.clamps).toBe(0);
  });
});

describe('cat ground check (rays)', () => {
  it('is not grounded in the air', () => {
    const { cat, physics } = setup({ cat: { position: [0, 1.5, 1] } });
    physics.step();
    expect(cat.state.grounded).toBe(false);
    expect(cat.probeGround()).toBeNull();
    expect(cat.groundBelow().hit).toBe(true);
    expect(cat.groundBelow().height).toBeGreaterThan(1.0);
  });

  it('stands on a prop and knows which one', () => {
    const { physics, cat, run } = setup();
    const book = physics.spawn('book', { base: [2, 0, 1] });
    cat.teleport([2, 2 * book.halfHeight + R + 0.002, 1], NORTH);
    run(0.5);
    expect(cat.state.grounded).toBe(true);
    expectSame(cat.state.groundBody, book.body);
    expectSame(cat.groundBelow().body, book.body);
  });

  it('teleport() leaves the body findable straight away (README integration rule 2)', () => {
    const { physics, cat } = setup();
    const above = { x: 2 + HL, y: 2, z: -1 }; // over the centre of the front sphere, once it is there
    expect(physics.raycast(above, { x: 0, y: -1, z: 0 }, 5, CAT).hit).toBe(false); // bins the grid at the old place
    cat.teleport([2, FLOOR_Y, -1], 0);
    const hit = physics.raycast(above, { x: 0, y: -1, z: 0 }, 5, CAT);
    expect(hit.hit).toBe(true);
    expectSame(hit.body, cat.body);
    expect(hit.point.y).toBeCloseTo(FLOOR_Y + R, 3);
    expect(cat.body.velocity.length()).toBe(0);
    expect(cat.heading).toBe(0);
  });
});

describe('cat and props', () => {
  it('shoves a mug along instead of stopping dead or launching itself', () => {
    const { physics, cat, run } = setup({ cat: { position: [0, FLOOR_Y, 1.5], heading: NORTH } });
    const mug = physics.spawn('mug', { base: [0, 0, 0.5] });
    cat.setInput({ forward: 1 });
    let maxY = 0;
    run(1, () => { maxY = Math.max(maxY, cat.body.position.y); });
    expect(mug.body.position.z).toBeLessThan(0.5 - 0.8);   // pushed well ahead
    expect(cat.body.position.z).toBeLessThan(1.5 - 2.0);   // the cat barely slowed
    expect(maxY).toBeLessThan(R + 0.02);
  });

  it('can stand on the plate stack: it gives for a moment, then holds', () => {
    // 3 kg on five 0.25 kg plates is a 12:1 mass ratio, the hard case for the solver.
    const { physics, cat, run } = setup({ world: { allowSleep: false } });
    const scene = spawnSliceScene(physics);
    const top = scene.plates[4].body.position.y + scene.plates[4].halfHeight;
    const start = scene.plates.map((p) => p.body.position.clone());
    cat.teleport([start[0].x, top + R + 0.001, start[0].z], 0);
    const worst = () => {
      let moved = 0, overlap = 0;
      scene.plates.forEach((p, i) => { moved = Math.max(moved, p.body.position.distanceTo(start[i])); });
      for (let i = 0; i < 4; i++) overlap = Math.max(overlap, 0.025 - (scene.plates[i + 1].body.position.y - scene.plates[i].body.position.y));
      return { moved, overlap };
    };
    let peak = 0;
    run(0.5, () => { peak = Math.max(peak, worst().moved); });
    expect(peak).toBeLessThan(0.015); // the stack compresses up to ~1 cm while the contacts load up
    let held = { moved: 0, overlap: 0 };
    run(4, () => {
      const w = worst();
      held = { moved: Math.max(held.moved, w.moved), overlap: Math.max(held.overlap, w.overlap) };
    });
    expect(cat.state.grounded).toBe(true);
    expectSame(cat.state.groundBody, scene.plates[4].body);
    expect(held.moved).toBeLessThan(0.002);
    expect(held.overlap).toBeLessThan(0.0005);
  });
});

describe('cat on the plate stack, off-centre', () => {
  // Offsets (m) from the stack's axis and headings (rad) the cat stands at.
  const stances = [[0.05, 0, 0], [0, 0.08, 0], [0.1, 0.1, 0], [0.03, -0.06, 0.5], [-0.08, 0.05, 2.5], [0.12, 0, 0.9]];
  for (const [dx, dz, heading] of stances) {
    it(`standing ${dx}, ${dz} off the axis, heading ${heading}: the stack stays calm`, () => {
      const physics = createPhysicsWorld({ tuning: freshTuning(), allowSleep: false });
      const scene = spawnSliceScene(physics);
      for (let i = 0; i < 60; i++) physics.step();
      const top = scene.plates[4].body.position.y + scene.plates[4].halfHeight;
      const start = scene.plates.map((p) => p.body.position.clone());
      createCat(physics, { position: [start[0].x + dx, top + R + 0.001, start[0].z + dz], heading });
      let speed = 0, drift = 0;
      for (let i = 0; i < 720; i++) {
        physics.step();
        scene.plates.forEach((p, k) => {
          if (i >= 120) speed = Math.max(speed, p.body.velocity.length());
          drift = Math.max(drift, Math.hypot(p.body.position.x - start[k].x, p.body.position.z - start[k].z));
        });
      }
      expect(speed).toBeLessThan(0.02);  // no trembling once it has settled
      expect(drift).toBeLessThan(0.003); // and the plates stay where they were
    });
  }
});

describe('cat swat (paw volume)', () => {
  /** Cat on the floor facing +x with a mug `ahead` metres in front of its centre. */
  function withMug(ahead, opts = {}) {
    const s = setup({ cat: { position: [0, FLOOR_Y, 1.5], heading: 0, ...opts } });
    const mug = s.physics.spawn('mug', { base: [ahead, 0, 1.5] });
    s.run(0.25);
    return { ...s, mug };
  }

  it('swats what is in front of the nose, forward and a little up, well under the cap', () => {
    const { cat, mug } = withMug(0.45);
    const hits = cat.swat();
    expect(hits).toHaveLength(1);
    expectSame(hits[0].body, mug.body);
    const v = mug.body.velocity;
    expect(v.length()).toBeCloseTo(tuning.swat.speed, 6);
    expect(v.length()).toBeLessThanOrEqual(tuning.swat.maxSpeed);
    expect(v.x).toBeGreaterThan(0.9 * tuning.swat.speed);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.abs(v.z)).toBeLessThan(1e-4);
    expect(hits[0].impulse).toBeCloseTo(mug.body.mass * tuning.swat.speed, 9);
    expect(cat.state.swats).toBe(1);
  });

  it('sends the mug flying across the floor', () => {
    const { cat, mug, run } = withMug(0.45);
    cat.swat();
    run(2);
    expect(mug.body.position.x).toBeGreaterThan(0.45 + 0.4);
  });

  it('misses what is out of reach, behind it, or above it', () => {
    const reach = NOSE + tuning.swat.reach + tuning.swat.radius;
    expect(withMug(reach + 0.15).cat.swat()).toEqual([]);
    expect(withMug(-0.45).cat.swat()).toEqual([]);
    // A mug on the nightstand, 0.6 m up, while the cat is on the floor beside it.
    const s = setup({ cat: { position: [-2.75, FLOOR_Y, -1.25], heading: WEST } });
    const high = s.physics.spawn('mug', { base: [-3.2, SURFACES.nightstandTop, -1.25] });
    s.run(0.25);
    expect(s.cat.swat()).toEqual([]);
    expect(high.body.velocity.length()).toBeLessThan(0.01);
  });

  it('has a cooldown', () => {
    const { cat, run } = withMug(0.45);
    expect(cat.swat()).toHaveLength(1);
    expect(cat.swat()).toBeNull();
    run(tuning.swat.cooldown + 0.02);
    expect(cat.swat()).not.toBeNull();
    expect(cat.state.swats).toBe(2);
  });

  it('fires once per key press through the input', () => {
    const onSwat = vi.fn();
    const { cat, run } = withMug(0.45, { onSwat });
    cat.setInput({ swat: true });
    run(1); // held for a second
    expect(onSwat).toHaveBeenCalledTimes(1);
    expect(onSwat.mock.calls[0][0]).toHaveLength(1);
    cat.setInput({ swat: false });
    run(0.05);
    cat.setInput({ swat: true });
    run(0.05);
    expect(onSwat).toHaveBeenCalledTimes(2);
  });

  it('does not swat through the side of the desk', () => {
    // Cat outside the desk's left side panel, facing it; mug under the desk just inside.
    const panel = box('deskSideLeft');
    const outer = panel.center[0] - panel.half[0];
    const s = setup({ cat: { position: [outer - NOSE - 0.02, FLOOR_Y, -2.6], heading: 0 } });
    const mug = s.physics.spawn('mug', { base: [outer + 0.2, 0, -2.6] });
    s.run(0.25);
    // It is inside the paw volume...
    const paw = s.cat.pawCenter();
    expect(Math.hypot(mug.body.position.x - paw.x, mug.body.position.z - paw.z)).toBeLessThan(tuning.swat.radius);
    // ...but the panel is in the way.
    expect(s.cat.swat()).toEqual([]);
    expect(mug.body.velocity.length()).toBeLessThan(0.01);
  });

  it('hits at most maxTargets bodies with one swat', () => {
    const { physics, cat, run } = setup({ cat: { position: [0, FLOOR_Y, 1.5], heading: 0 } });
    const scene = spawnSliceScene(physics, { stack: { x: 0.55, z: 1.5, count: 5 }, mugs: [], book: { x: 3, z: 2.5, rotY: 0 } });
    // Put the stack on the floor in front of the cat instead of on the desk.
    scene.plates.forEach((p, i) => {
      p.body.position.y = p.halfHeight + i * 2 * p.halfHeight;
      p.body.aabbNeedsUpdate = true;
    });
    run(0.25);
    const hits = cat.swat();
    expect(hits).toHaveLength(tuning.swat.maxTargets);
    for (const h of hits) expect(h.exitSpeed).toBeLessThanOrEqual(tuning.swat.maxSpeed);
  });
});

describe('keyboard mapping', () => {
  it('maps the README controls to car-style input', () => {
    expect(inputFromKeys(new Set())).toEqual({ forward: 0, turn: 0, move: null, jump: false, swat: false });
    expect(inputFromKeys(new Set(['KeyW']))).toMatchObject({ forward: 1, turn: 0 });
    expect(inputFromKeys(new Set(['ArrowUp']))).toMatchObject({ forward: 1 });
    expect(inputFromKeys(new Set(['KeyS']))).toMatchObject({ forward: -1 });
    expect(inputFromKeys(new Set(['KeyA']))).toMatchObject({ turn: 1 });   // left raises the heading
    expect(inputFromKeys(new Set(['ArrowRight']))).toMatchObject({ turn: -1 });
    expect(inputFromKeys(new Set(['KeyW', 'KeyS']))).toMatchObject({ forward: 0 });
    expect(inputFromKeys(new Set(['Space', 'KeyJ']))).toMatchObject({ jump: true, swat: true });
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyJ']) {
      expect(CAT_KEYS.has(code)).toBe(true);
    }
  });

  it('turns WASD to match an isometric camera', () => {
    const cam = { x: -1, z: -1 }; // camera looking towards -x, -z
    const s = Math.SQRT1_2;
    const up = cameraRelativeInput(new Set(['KeyW']), cam).move;
    expect(up.x).toBeCloseTo(-s, 9);
    expect(up.z).toBeCloseTo(-s, 9);
    const right = cameraRelativeInput(new Set(['KeyD']), cam).move;
    expect(right.x).toBeCloseTo(s, 9);
    expect(right.z).toBeCloseTo(-s, 9);
    const diag = cameraRelativeInput(new Set(['KeyW', 'KeyD']), cam).move;
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1, 9); // no faster on the diagonal
    expect(cameraRelativeInput(new Set(), cam).move).toEqual({ x: 0, z: 0 });
  });

  it('drives the cat from held keys', () => {
    const { cat, run } = setup();
    cat.setInput(inputFromKeys(new Set(['KeyW'])));
    run(0.5);
    expect(cat.body.position.z).toBeLessThan(0);
  });
});

describe('cat lifecycle', () => {
  it('dispose() removes the body and stops the controller', () => {
    const { physics, cat, run } = setup();
    const before = cat.body.position.clone();
    cat.setInput({ forward: 1 });
    cat.dispose();
    expectIncludes(physics.world.bodies, cat.body, false);
    run(0.5);
    expect(cat.body.position.distanceTo(before)).toBe(0);
  });

  it('is blocked by static geometry only where there is some', () => {
    // Sanity check on the ray mask: the cat's ground rays see STATIC bodies.
    const { physics, cat } = setup();
    const hit = physics.raycast(cat.body.position, { x: 0, y: -1, z: 0 }, 1, STATIC);
    expect(hit.hit).toBe(true);
    expect(hit.distance).toBeCloseTo(R, 2);
  });
});
