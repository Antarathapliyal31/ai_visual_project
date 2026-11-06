// swat() (Workstream B).
//
// Contract: swat(target, direction, speed), exit speed capped at 12 m/s.
// Used by gameplay (the cat's paw) and by test scenarios (A's tunneling proof).
//
// A swat is an impulse J = m * dv along `direction`. Through the centre of
// mass it changes only the linear velocity; struck off-centre (`opts.point`)
// it also spins the target. Afterwards the target's speed is clamped to the
// cap, so nothing ever leaves a swat faster than 12 m/s, however fast it was
// already moving.
//
// On a target at rest this gives exactly the velocity the day-one stub set
// (direction * min(speed, 12)), so scenarios written against the stub keep
// their numbers.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';

const r = new CANNON.Vec3();
const torqueImpulse = new CANNON.Vec3();
const dOmega = new CANNON.Vec3();

/**
 * @param {CANNON.Body} target
 * @param {{x: number, y: number, z: number}} direction  any length; normalised here
 * @param {number} speed  m/s the swat adds along `direction`, capped at tuning.swat.maxSpeed
 * @param {object} [opts]
 * @param {{x: number, y: number, z: number}} [opts.point]  world point struck; off-centre adds spin
 * @param {object} [opts.tuning]  the `swat` block of tuning.js
 * @returns {{impulse: number, exitSpeed: number, capped: boolean}} impulse in N·s
 */
export function swat(target, direction, speed, opts = {}) {
  const cfg = opts.tuning ?? defaultTuning.swat;
  const cap = cfg.maxSpeed;
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (target.type !== CANNON.Body.DYNAMIC || !(len > 0) || !(speed > 0)) {
    return { impulse: 0, exitSpeed: target.velocity.length(), capped: false };
  }
  const s = Math.min(speed, cap);
  const dvx = (direction.x / len) * s, dvy = (direction.y / len) * s, dvz = (direction.z / len) * s;

  target.wakeUp();
  target.velocity.x += dvx;
  target.velocity.y += dvy;
  target.velocity.z += dvz;

  if (opts.point) {
    // Angular part of the same impulse: dw = I^-1 (r x J), J = m * dv.
    r.set(opts.point.x - target.position.x, opts.point.y - target.position.y, opts.point.z - target.position.z);
    const m = target.mass;
    torqueImpulse.set(
      (r.y * dvz - r.z * dvy) * m,
      (r.z * dvx - r.x * dvz) * m,
      (r.x * dvy - r.y * dvx) * m,
    );
    target.updateInertiaWorld(true); // the body may have been turned by hand since its last step
    target.invInertiaWorld.vmult(torqueImpulse, dOmega);
    target.angularVelocity.vadd(dOmega, target.angularVelocity);
    const w = target.angularVelocity.length();
    if (w > cfg.maxSpin) target.angularVelocity.scale(cfg.maxSpin / w, target.angularVelocity);
  }

  let exitSpeed = target.velocity.length();
  // A hair of slack so rounding in length() never rescales a swat that is
  // already exactly at the cap.
  const capped = exitSpeed > cap * (1 + 1e-12);
  if (capped) {
    target.velocity.scale(cap / exitSpeed, target.velocity);
    exitSpeed = cap;
  }
  return { impulse: target.mass * s, exitSpeed, capped: capped || speed > cap };
}
