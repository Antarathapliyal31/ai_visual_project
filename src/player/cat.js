// Cat controller (Workstream B).
//
// The cat is a dynamic cannon-es body with fixed rotation: contacts can push
// it around but never tip it. Its collider is two spheres along the heading
// (24 cm tall, 24 cm wide, 44 cm long), short enough for the 26 cm gap under
// the desk and the 28 cm gap under the bed.
//
//  - Steering is car-style: `turn` rotates the heading, `forward` drives along
//    it. Passing `move` (a world-space direction, e.g. WASD turned to match
//    the camera) steers towards that direction instead.
//  - The controller owns the horizontal velocity and moves it towards the
//    target with a capped acceleration, so the cat pushes props with a finite
//    force. The cat's material is frictionless, so the solver never fights
//    this and the cat never sticks to walls.
//  - The heading is turned through the body's angular velocity. Fixed
//    rotation means contacts can't change it, but the solver still sees the
//    nose sweeping sideways, so turning on the spot shoves props aside.
//  - Ground check: three of A's rays straight down, one under each sphere and
//    one under the middle. Jumping needs the ground (with a short coyote
//    window) and remembers an early press for a moment.
//  - Swat: a paw volume in front of the nose; the nearest props inside it get
//    swat(). Nothing is swatted through a wall or shelf.
//
// update(dt) must run before world.step(), which createPhysicsWorld()'s
// step() does for every cat made from it.
//
// Heading h faces (cos h, 0, -sin h): 0 is +x, and turning left raises it.
// The body's quaternion is the same yaw, so D's body-to-mesh sync needs
// nothing special for a cat model that faces +x.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { STATIC, PROP, DEBRIS, CAT, ALL } from '../core/groups.js';
import { swat as applySwat } from './swat.js';

const UP = new CANNON.Vec3(0, 1, 0);
const DOWN = { x: 0, y: -1, z: 0 };
const JUMP_LOCK = 0.12; // s the ground rays are ignored after take-off

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => {
  a %= 2 * Math.PI;
  return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
};

/**
 * @typedef {object} CatInput
 * @property {number} forward  -1..1, along the heading (reverse is slower)
 * @property {number} turn     -1..1, positive turns left
 * @property {{x: number, z: number} | null} move  world-space direction to run in; overrides forward/turn
 * @property {boolean} jump
 * @property {boolean} swat
 */

/**
 * @param {ReturnType<import('../physics/world.js').createPhysicsWorld>} physics
 * @param {object} [opts]
 * @param {[number, number, number] | {x: number, y: number, z: number}} [opts.position]  centre; default on the floor
 * @param {number} [opts.heading]  radians; default faces the north wall (-z)
 * @param {(hits: object[], paw: {x: number, y: number, z: number}) => void} [opts.onSwat]
 * @param {() => void} [opts.onJump]
 * @param {(impactSpeed: number) => void} [opts.onLand]  downward speed at touchdown, m/s
 */
export function createCat(physics, opts = {}) {
  const { world, raycast, tuning } = physics;
  const cfg = tuning.cat;
  const sw = tuning.swat;
  const radius = cfg.radius;
  const halfLength = cfg.bodyHalfLength;

  const body = new CANNON.Body({
    mass: cfg.mass,
    material: physics.materials.get('cat'),
    fixedRotation: true,
    allowSleep: false,     // a sleeping body ignores velocities set by hand
    linearDamping: 0,      // the controller brakes; damping would shorten jumps
    angularDamping: 0,
    collisionFilterGroup: CAT,
    collisionFilterMask: ALL,
  });
  if (halfLength > 0) {
    body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(halfLength, 0, 0));
    body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(-halfLength, 0, 0));
  } else {
    body.addShape(new CANNON.Sphere(radius));
  }
  body.userData = { kind: 'cat', material: 'cat' };

  /** @type {CatInput} */
  const input = { forward: 0, turn: 0, move: null, jump: false, swat: false };
  const state = {
    grounded: false,
    groundBody: null,
    airTime: 0,
    speed: 0,           // horizontal, m/s
    swatCooldown: 0,
    jumps: 0,
    swats: 0,
  };
  let heading = 0;
  let jumpBuffer = 0, jumpLock = 0;
  let prevJump = false, prevSwat = false;
  let fallSpeed = 0;

  // The cat walks through the bed skirt, so rays that stand in for its body
  // ignore the occluders too.
  const skip = [body, ...(physics.staticGeometry?.occluders ?? [])];
  const GROUND_MASK = STATIC | PROP | DEBRIS;

  const forward = () => ({ x: Math.cos(heading), y: 0, z: -Math.sin(heading) });

  function syncOrientation(omega = 0) {
    body.quaternion.setFromAxisAngle(UP, heading);
    body.angularVelocity.set(0, omega, 0);
    // Moved by hand: cannon-es doesn't flag the AABB itself.
    body.aabbNeedsUpdate = true;
  }

  /** Place the cat by hand (spawn, reset, scenarios). */
  function teleport(position, newHeading = heading) {
    const p = Array.isArray(position) ? { x: position[0], y: position[1], z: position[2] } : position;
    body.position.set(p.x, p.y, p.z);
    body.velocity.set(0, 0, 0);
    heading = wrapAngle(newHeading);
    syncOrientation();
    body.updateAABB();
    world.broadphase.invalidate?.(); // the grid re-bins before the next ray
    state.grounded = false;
    state.airTime = Infinity; // placed in mid-air: no coyote jump until it has stood on something
    jumpBuffer = jumpLock = 0;
  }

  /** Closest ground under the feet within the probe distance, or null. */
  function probeGround() {
    const f = forward();
    const reach = radius + cfg.groundProbe;
    let best = null;
    const offsets = halfLength > 0 ? [0, halfLength, -halfLength] : [0];
    for (const k of offsets) {
      const origin = { x: body.position.x + f.x * k, y: body.position.y, z: body.position.z + f.z * k };
      const hit = raycast(origin, DOWN, reach, GROUND_MASK, { skip });
      // Only faces the cat can stand on count.
      if (hit.hit && hit.normal.y > 0.5 && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** What is straight below the cat, however far: for a drop shadow or landing marker. */
  function groundBelow(maxDist = 4) {
    const hit = raycast(body.position, DOWN, maxDist, GROUND_MASK, { skip });
    return { hit: hit.hit, point: hit.point, body: hit.body, height: hit.hit ? hit.distance - radius : Infinity };
  }

  /** Centre of the paw volume, in front of the nose. */
  function pawCenter() {
    const f = forward();
    const d = halfLength + radius + sw.reach;
    return { x: body.position.x + f.x * d, y: body.position.y, z: body.position.z + f.z * d };
  }

  const pawAABB = new CANNON.AABB();
  const found = [];

  /**
   * Swat whatever is in the paw volume. Returns the bodies hit (possibly
   * none), or null while the cooldown is running.
   */
  function swat() {
    if (state.swatCooldown > 0) return null;
    state.swatCooldown = sw.cooldown;
    state.swats++;

    const paw = pawCenter();
    const pr = sw.radius;
    pawAABB.lowerBound.set(paw.x - pr, paw.y - pr, paw.z - pr);
    pawAABB.upperBound.set(paw.x + pr, paw.y + pr, paw.z + pr);
    found.length = 0;
    world.broadphase.aabbQuery(world, pawAABB, found);

    const candidates = [];
    for (const b of found) {
      if (b === body || b.type !== CANNON.Body.DYNAMIC) continue;
      if ((b.collisionFilterGroup & (PROP | DEBRIS)) === 0) continue;
      // Nearest point of the body's bounds to the paw centre.
      const lo = b.aabb.lowerBound, hi = b.aabb.upperBound;
      const point = { x: clamp(paw.x, lo.x, hi.x), y: clamp(paw.y, lo.y, hi.y), z: clamp(paw.z, lo.z, hi.z) };
      const distance = Math.hypot(point.x - paw.x, point.y - paw.y, point.z - paw.z);
      if (distance <= pr) candidates.push({ body: b, point, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);

    const f = forward();
    const direction = { x: f.x, y: sw.lift, z: f.z };
    const hits = [];
    for (const c of candidates) {
      if (hits.length >= sw.maxTargets) break;
      // No swatting through a wall or a shelf.
      const to = { x: c.point.x - body.position.x, y: c.point.y - body.position.y, z: c.point.z - body.position.z };
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > 1e-6 && raycast(body.position, to, dist, STATIC, { skip }).hit) continue;
      // Strike part-way between the centre of mass and the near edge: some spin, not a wild one.
      const p = c.body.position;
      const point = {
        x: p.x + (c.point.x - p.x) * sw.spin,
        y: p.y + (c.point.y - p.y) * sw.spin,
        z: p.z + (c.point.z - p.z) * sw.spin,
      };
      const result = applySwat(c.body, direction, sw.speed, { point, tuning: sw });
      hits.push({ body: c.body, point, ...result });
    }
    opts.onSwat?.(hits, paw);
    return hits;
  }

  /** Advance the controller by one substep. Runs before world.step(). */
  function update(dt) {
    state.swatCooldown = Math.max(0, state.swatCooldown - dt);
    jumpLock = Math.max(0, jumpLock - dt);
    jumpBuffer = Math.max(0, jumpBuffer - dt);

    // --- Ground.
    const ground = jumpLock > 0 ? null : probeGround();
    const wasGrounded = state.grounded;
    state.grounded = !!ground;
    state.groundBody = ground ? ground.body : null;
    if (state.grounded) {
      if (!wasGrounded && state.airTime > 0.05) opts.onLand?.(fallSpeed);
      state.airTime = 0;
    } else {
      state.airTime += dt;
      fallSpeed = Math.max(0, -body.velocity.y);
    }

    // --- Steering.
    let omega = 0, drive = 0;
    if (input.move) {
      const mag = Math.min(1, Math.hypot(input.move.x, input.move.z));
      if (mag > 0.05) {
        const diff = wrapAngle(Math.atan2(-input.move.z, input.move.x) - heading);
        const maxTurn = cfg.moveTurnRate * dt;
        omega = clamp(diff, -maxTurn, maxTurn) / dt;
        drive = mag * Math.max(0, Math.cos(diff)); // don't run sideways while still turning
      }
    } else {
      omega = clamp(input.turn, -1, 1) * cfg.turnRate;
      drive = clamp(input.forward, -1, 1);
      if (drive < 0) drive *= cfg.reverseFactor;
    }
    // The body turns by omega * dt during this step; the heading goes with it.
    syncOrientation(omega);
    heading = wrapAngle(heading + omega * dt);

    // --- Horizontal velocity towards the target, acceleration capped.
    const f = forward();
    const v = body.velocity;
    state.speed = Math.hypot(v.x, v.z); // what the last step left it with, walls included
    const accel = state.grounded ? (drive !== 0 ? cfg.groundAccel : cfg.brakeAccel) : (drive !== 0 ? cfg.airAccel : 0);
    if (accel > 0) {
      const dvx = f.x * cfg.speed * drive - v.x, dvz = f.z * cfg.speed * drive - v.z;
      const dv = Math.hypot(dvx, dvz);
      const k = dv > accel * dt ? (accel * dt) / dv : 1;
      v.x += dvx * k;
      v.z += dvz * k;
    }

    // --- Jump: on the ground, or just after walking off a ledge.
    if (input.jump && !prevJump) jumpBuffer = cfg.jumpBuffer;
    prevJump = input.jump;
    const canJump = state.grounded || state.airTime <= cfg.coyoteTime;
    if (jumpBuffer > 0 && canJump && jumpLock <= 0) {
      const g = Math.abs(tuning.physics.gravity);
      // + g*dt/2 makes the apex land on jumpHeight with the leap-frog integrator.
      v.y = Math.sqrt(2 * g * cfg.jumpHeight) + (g * dt) / 2;
      jumpBuffer = 0;
      jumpLock = JUMP_LOCK;
      state.grounded = false;
      state.airTime = cfg.coyoteTime + dt; // no second jump off the coyote window
      state.jumps++;
      opts.onJump?.();
    }

    // --- Swat.
    if (input.swat && !prevSwat) swat();
    prevSwat = input.swat;
  }

  function setInput(partial) {
    Object.assign(input, partial);
    return input;
  }

  const p0 = opts.position ?? [0, radius + 0.001, 1.0];
  world.addBody(body);
  teleport(p0, opts.heading ?? Math.PI / 2);
  const unhook = physics.onBeforeStep(update);

  function dispose() {
    unhook();
    if (world.bodies.includes(body)) world.removeBody(body);
  }

  return {
    body, input, state,
    /** Collider dimensions, for D's mesh and C's sight rays. */
    dims: { radius, halfLength, height: 2 * radius, length: 2 * (halfLength + radius), width: 2 * radius },
    get heading() { return heading; },
    forward, setInput, update, teleport, swat, pawCenter, probeGround, groundBelow, dispose,
  };
}
