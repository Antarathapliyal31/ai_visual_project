// Contact solver (Workstream B).
//
// cannon-es still builds every contact and friction equation and integrates
// the bodies. This replaces only the Gauss-Seidel pass that solves them,
// because the stock pass has two problems the game can't live with:
//
//  1. It starts every step from zero. A stack of three or more plates needs
//     far more than 20 passes to converge from scratch, so it never comes to
//     rest: the plates buzz at ~0.1 m/s and walk across the desk. Here each
//     contact starts from the impulse it ended the last step with (warm
//     starting), so a resting stack is already solved before the first pass.
//
//  2. Its friction limit is mu * g * reducedMass, a force, but it is applied
//     to the per-step impulse. At 120 Hz that makes friction 120 times too
//     strong (and 60 times at 60 Hz): nothing slides, things tip over
//     instead, and the material table's friction column has no effect. Here
//     the limit is Coulomb's law on the solved normal impulse of the same
//     contact: |friction impulse| <= mu * normal impulse.
//
// Two smaller things:
//  - Restitution is ignored below a small approach speed, so resting contacts
//    don't keep bouncing on their own restitution.
//  - A body pair keeps at most `maxContactsPerPair` contact points, the
//    outermost ones. A 12-sided plate on another gives 12 points where 6
//    carry the same load; the spare ones only slow convergence, and with
//    them a cat standing on the plate stack keeps it trembling.
//
// With warmStart = 0, coulombFriction = false, restitutionThreshold = 0 and
// maxContactsPerPair = 0 this is step for step the stock GSSolver, so each
// feature can be switched off in the overlay and compared.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';

const pairKey = (c) => c.bi.id * 1048576 + c.bj.id;
const t1 = new CANNON.Vec3();
const t2 = new CANNON.Vec3();

export class WarmGSSolver extends CANNON.GSSolver {
  /**
   * @param {object} [opts]
   * @param {number} [opts.iterations=30]
   * @param {number} [opts.tolerance=1e-7]
   * @param {number} [opts.warmStart=1]     share of last step's impulse a contact starts from (0 = off)
   * @param {boolean} [opts.coulombFriction=true]
   * @param {number} [opts.restitutionThreshold=0.5]  m/s; slower approaches don't bounce
   * @param {number} [opts.maxContactsPerPair=6]  0 keeps every contact point
   * @param {number} [opts.matchDistance=0.02]  m; a contact inherits from last step's nearest point within this
   */
  constructor(opts = {}) {
    super();
    this.iterations = opts.iterations ?? 30;
    this.tolerance = opts.tolerance ?? 1e-7;
    this.warmStart = opts.warmStart ?? 1;
    this.coulombFriction = opts.coulombFriction ?? true;
    this.restitutionThreshold = opts.restitutionThreshold ?? 0.5;
    this.maxContactsPerPair = opts.maxContactsPerPair ?? 6;
    this.matchDistance = opts.matchDistance ?? 0.02;

    this.cache = new Map(); // pairKey -> [{x, y, z, nx, ny, nz, n, t1, t2}] from the last step
    this.stats = { equations: 0, dropped: 0, warmStarted: 0, iterations: 0 };

    this._pool = [];      // spare cache entries and lists, to keep the per-step garbage down
    this._listPool = [];
    this._lambda = [];
    this._B = [];
    this._invC = [];
    this._normalOf = []; // friction equation -> index of its contact equation, or -1
    this._mu = [];
  }

  solve(dt, world) {
    const equations = this.equations;
    const stats = this.stats;
    stats.equations = equations.length;
    stats.dropped = 0;
    stats.warmStarted = 0;
    stats.iterations = 0;
    if (equations.length === 0) {
      this._clearCache();
      return 0;
    }

    const contacts = world.contacts;
    const fe = world.frictionEquations;

    // --- Pair every friction equation with its contact. The narrowphase
    // emits two friction equations right after each contact that has
    // friction, in the same order, with the contact's ri copied in.
    for (let i = 0; i !== fe.length; i++) fe[i].__contact = null;
    for (let k = 0, f = 0; k !== contacts.length; k++) {
      const c = contacts[k];
      c.__f1 = c.__f2 = null; // contacts are pooled: clear last step's links
      c.__drop = false;
      if (f + 1 >= fe.length) continue;
      const f1 = fe[f];
      if (f1.bi === c.bi && f1.bj === c.bj && f1.ri.x === c.ri.x && f1.ri.y === c.ri.y && f1.ri.z === c.ri.z) {
        f1.__contact = c;
        fe[f + 1].__contact = c;
        c.__f1 = f1;
        c.__f2 = fe[f + 1];
        f += 2;
      }
    }

    if (this.maxContactsPerPair > 0) this._reduceContacts(contacts);

    const Neq = equations.length;
    stats.equations = Neq;
    const bodies = world.bodies;
    const Nbodies = bodies.length;
    const h = dt;
    const lambda = this._lambda, Bs = this._B, invCs = this._invC, normalOf = this._normalOf, mus = this._mu;
    lambda.length = Bs.length = invCs.length = normalOf.length = mus.length = Neq;

    for (let i = 0; i !== Nbodies; i++) bodies[i].updateSolveMassProperties();
    for (let i = 0; i !== Neq; i++) equations[i].__solveIndex = i;
    const inSolver = (eq) => eq !== null && equations[eq.__solveIndex] === eq;

    // --- Restitution only for real impacts.
    const vThreshold = this.restitutionThreshold;
    if (vThreshold > 0) {
      for (let k = 0; k !== contacts.length; k++) {
        const c = contacts[k];
        if (c.restitution > 0 && -relativeNormalVelocity(c) < vThreshold) c.restitution = 0;
      }
    }

    for (let i = 0; i !== Neq; i++) {
      const c = equations[i];
      lambda[i] = 0;
      Bs[i] = c.computeB(h);
      invCs[i] = 1 / c.computeC();
      normalOf[i] = -1;
      mus[i] = 0;
      const normal = c.__contact;
      if (this.coulombFriction && normal && inSolver(normal)) {
        normalOf[i] = normal.__solveIndex;
        const cm = (c.bi.material && c.bj.material && world.getContactMaterial(c.bi.material, c.bj.material)) || world.defaultContactMaterial;
        mus[i] = cm.friction;
      }
    }

    for (let i = 0; i !== Nbodies; i++) {
      bodies[i].vlambda.set(0, 0, 0);
      bodies[i].wlambda.set(0, 0, 0);
    }

    // --- Warm start: begin from last step's impulse at the nearest contact
    // point of the same body pair.
    const warm = this.warmStart;
    if (warm > 0 && this.cache.size) {
      const maxD2 = this.matchDistance * this.matchDistance;
      for (let k = 0; k !== contacts.length; k++) {
        const c = contacts[k];
        if (!inSolver(c)) continue;
        const old = this.cache.get(pairKey(c));
        if (!old) continue;
        let best = null, bestD2 = maxD2;
        for (let m = 0; m !== old.length; m++) {
          const o = old[m];
          if (o.used) continue;
          const dx = o.x - c.ri.x, dy = o.y - c.ri.y, dz = o.z - c.ri.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 <= bestD2) { bestD2 = d2; best = o; }
        }
        // The tangents follow the normal, so the friction impulses only
        // carry over if the normal still points the same way.
        if (!best || best.nx * c.ni.x + best.ny * c.ni.y + best.nz * c.ni.z < 0.95) continue;
        best.used = true;
        stats.warmStarted++;
        start(c, best.n * warm, lambda);
        if (inSolver(c.__f1)) start(c.__f1, best.t1 * warm, lambda);
        if (inSolver(c.__f2)) start(c.__f2, best.t2 * warm, lambda);
      }
    }

    // --- Gauss-Seidel.
    const maxIter = this.iterations;
    const tolSquared = this.tolerance * this.tolerance;
    let iter = 0;
    for (; iter !== maxIter; iter++) {
      let total = 0;
      for (let j = 0; j !== Neq; j++) {
        const c = equations[j];
        const lambdaj = lambda[j];
        let delta = invCs[j] * (Bs[j] - c.computeGWlambda() - c.eps * lambdaj);
        let lo = c.minForce, hi = c.maxForce;
        const n = normalOf[j];
        if (n >= 0) {
          // Coulomb: the friction impulse can't exceed mu times the normal impulse.
          hi = mus[j] * lambda[n];
          lo = -hi;
        }
        if (lambdaj + delta < lo) delta = lo - lambdaj;
        else if (lambdaj + delta > hi) delta = hi - lambdaj;
        lambda[j] += delta;
        total += delta > 0 ? delta : -delta;
        c.addToWlambda(delta);
      }
      if (total * total < tolSquared) break;
    }
    stats.iterations = iter;

    for (let i = 0; i !== Nbodies; i++) {
      const b = bodies[i];
      b.vlambda.vmul(b.linearFactor, b.vlambda);
      b.velocity.vadd(b.vlambda, b.velocity);
      b.wlambda.vmul(b.angularFactor, b.wlambda);
      b.angularVelocity.vadd(b.wlambda, b.angularVelocity);
    }

    // multiplier * dt is the impulse D's harvester reads.
    const invDt = 1 / h;
    for (let i = 0; i !== Neq; i++) equations[i].multiplier = lambda[i] * invDt;

    // --- Remember this step's impulses for the next one.
    this._clearCache();
    if (warm > 0) {
      for (let k = 0; k !== contacts.length; k++) {
        const c = contacts[k];
        if (!inSolver(c)) continue;
        const key = pairKey(c);
        let list = this.cache.get(key);
        if (!list) this.cache.set(key, (list = this._listPool.pop() ?? []));
        const e = this._pool.pop() ?? {};
        e.x = c.ri.x; e.y = c.ri.y; e.z = c.ri.z;
        e.nx = c.ni.x; e.ny = c.ni.y; e.nz = c.ni.z;
        e.n = lambda[c.__solveIndex];
        e.t1 = inSolver(c.__f1) ? lambda[c.__f1.__solveIndex] : 0;
        e.t2 = inSolver(c.__f2) ? lambda[c.__f2.__solveIndex] : 0;
        e.used = false;
        list.push(e);
      }
    }

    // Don't leave stale indices on pooled equations.
    for (let i = 0; i !== Neq; i++) equations[i].__solveIndex = -1;
    return iter;
  }

  /**
   * Keep only the outermost contact points of each body pair. The narrowphase
   * emits a pair's contacts one after another; for each direction around the
   * contact normal the two extreme points are kept, the rest are taken out of
   * this step's equations.
   */
  _reduceContacts(contacts) {
    const max = this.maxContactsPerPair;
    const directions = Math.max(1, Math.floor(max / 2));
    let dropped = 0;
    for (let i = 0; i < contacts.length;) {
      let j = i + 1;
      while (j < contacts.length && contacts[j].bi === contacts[i].bi && contacts[j].bj === contacts[i].bj) j++;
      if (j - i > max) {
        for (let k = i; k < j; k++) contacts[k].__drop = true;
        contacts[i].ni.tangents(t1, t2);
        for (let d = 0; d < directions; d++) {
          const a = (Math.PI * d) / directions;
          const ca = Math.cos(a), sa = Math.sin(a);
          const dx = ca * t1.x + sa * t2.x, dy = ca * t1.y + sa * t2.y, dz = ca * t1.z + sa * t2.z;
          let lo = i, hi = i, loV = Infinity, hiV = -Infinity;
          for (let k = i; k < j; k++) {
            const r = contacts[k].ri;
            const v = r.x * dx + r.y * dy + r.z * dz;
            if (v < loV) { loV = v; lo = k; }
            if (v > hiV) { hiV = v; hi = k; }
          }
          contacts[lo].__drop = false;
          contacts[hi].__drop = false;
        }
        for (let k = i; k < j; k++) {
          const c = contacts[k];
          if (!c.__drop) continue;
          dropped++;
          c.multiplier = 0; // carries no impulse this step
          if (c.__f1) { c.__f1.multiplier = 0; c.__f2.multiplier = 0; }
        }
      }
      i = j;
    }
    if (!dropped) return;
    const eqs = this.equations;
    let w = 0;
    for (let k = 0; k < eqs.length; k++) {
      const e = eqs[k];
      const contact = e.__contact ?? e; // a friction equation follows its contact
      if (contact.__drop !== true) eqs[w++] = e;
    }
    this.stats.dropped = eqs.length - w;
    eqs.length = w;
  }

  _clearCache() {
    for (const list of this.cache.values()) {
      for (let i = 0; i < list.length; i++) this._pool.push(list[i]);
      list.length = 0;
      this._listPool.push(list);
    }
    this.cache.clear();
  }
}

function start(eq, value, lambda) {
  if (value === 0) return;
  lambda[eq.__solveIndex] = value;
  eq.addToWlambda(value);
}

/** Speed at which the two bodies separate along the contact normal (negative = approaching). */
function relativeNormalVelocity(c) {
  const { bi, bj, ri, rj, ni } = c;
  const vi = bi.velocity, wi = bi.angularVelocity, vj = bj.velocity, wj = bj.angularVelocity;
  // v + w x r for each body at the contact point
  const ax = vi.x + wi.y * ri.z - wi.z * ri.y, ay = vi.y + wi.z * ri.x - wi.x * ri.z, az = vi.z + wi.x * ri.y - wi.y * ri.x;
  const bx = vj.x + wj.y * rj.z - wj.z * rj.y, by = vj.y + wj.z * rj.x - wj.x * rj.z, bz = vj.z + wj.x * rj.y - wj.y * rj.x;
  return (bx - ax) * ni.x + (by - ay) * ni.y + (bz - az) * ni.z;
}
