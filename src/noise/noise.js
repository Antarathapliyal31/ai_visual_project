// Noise: from solver impulses to the owner's wake level.
//
// The coupling at the heart of the game: the contact impulses the physics
// solver computes are what the owner hears.
//
//  - Harvester. After every physics step it reads world.contacts, sums each
//    body pair's impulse (multiplier * dt, B's integration rule 3) and emits
//    an ImpactEvent for pairs that were not touching the step before. A prop
//    resting or sliding makes no sound; landing, bouncing and breaking do.
//    Every event also goes to fracture, which decides what breaks (and leaves
//    the cat's own contacts alone unless tuning says otherwise).
//  - Loudness grows with the log of the impulse, so a small knock still
//    registers and one crash can't pin the meter, and is scaled by the
//    material pair's loudness from B's table (ceramic on wood rings, paper
//    thuds). The cat's own bumps and landings are padded.
//  - What the owner hears falls off with distance from the impact to his
//    head, and adds to the wake meter, which drains slowly once it has been
//    quiet for a while.
//
// No Three.js: runs headless, like the proofs.

/** @typedef {{bodyA: object, bodyB: object, impulse: number, point: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}, matA: string, matB: string}} ImpactEvent */
/** @typedef {{position: {x: number, y: number, z: number}, loudness: number, heardLoudness: number, impact: ImpactEvent}} NoiseEvent */

const key = (a, b) => (a.id < b.id ? a.id * 1e6 + b.id : b.id * 1e6 + a.id);

/**
 * Turn the solver's contacts into ImpactEvents, once per new contact.
 * @param {ReturnType<import('../physics/world.js').createPhysicsWorld>} physics
 * @param {object} [opts]
 * @param {(e: ImpactEvent) => void} [opts.onImpact]
 * @param {boolean} [opts.fracture=true]  forward every event to physics.fracture
 * @returns {{dispose: () => void, stats: {events: number}}}
 */
export function createImpactHarvester(physics, opts = {}) {
  const cfg = physics.tuning.noise;
  const dt = physics.dt;
  let touching = new Set();
  const stats = { events: 0 };

  const unhook = physics.onAfterStep(() => {
    const now = new Map();
    for (const c of physics.world.contacts) {
      const k = key(c.bi, c.bj);
      let e = now.get(k);
      if (!e) {
        e = { bodyA: c.bi, bodyB: c.bj, impulse: 0, sx: 0, sy: 0, sz: 0, n: 0, normal: { x: c.ni.x, y: c.ni.y, z: c.ni.z } };
        now.set(k, e);
      }
      const j = Math.abs(c.multiplier) * dt;
      e.impulse += j;
      // Contact point on body i, weighted by impulse (equally while none has any).
      const w = j > 0 ? j : 1e-9;
      e.sx += (c.bi.position.x + c.ri.x) * w;
      e.sy += (c.bi.position.y + c.ri.y) * w;
      e.sz += (c.bi.position.z + c.ri.z) * w;
      e.n += w;
    }
    const quiet = physics.stepCount <= cfg.settleSteps;
    for (const [k, e] of now) {
      if (touching.has(k) || quiet || e.impulse < cfg.impulseFloor) continue;
      const event = {
        bodyA: e.bodyA,
        bodyB: e.bodyB,
        impulse: e.impulse,
        point: { x: e.sx / e.n, y: e.sy / e.n, z: e.sz / e.n },
        normal: e.normal,
        matA: physics.materials.nameOf(e.bodyA) ?? 'wood',
        matB: physics.materials.nameOf(e.bodyB) ?? 'wood',
      };
      stats.events++;
      if (opts.fracture !== false) physics.fracture?.onImpact(event);
      opts.onImpact?.(event);
    }
    touching = new Set(now.keys());
  });

  return { dispose: unhook, stats };
}

/**
 * How loud an impact is at its source, before distance.
 * @param {ImpactEvent} e
 * @param {ReturnType<import('../physics/materials.js').createMaterialTable>} materials
 * @param {object} cfg  tuning.noise
 */
export function impactLoudness(e, materials, cfg) {
  const pair = materials.loudness(e.matA, e.matB);
  const cat = e.matA === 'cat' || e.matB === 'cat' ? cfg.catFactor : 1;
  return pair * cat * Math.log(1 + e.impulse / cfg.impulseScale);
}

/** Share of a sound heard at distance d (1 at the source). */
export function falloff(d, cfg) {
  return 1 / (1 + (d / cfg.falloff) ** 2);
}

/**
 * The wake meter: 0 asleep, 1 wide awake.
 * @param {object} cfg  tuning.noise
 */
export function createWakeMeter(cfg) {
  let level = 0, quietFor = Infinity;
  return {
    get level() { return level; },
    /** Add heard loudness. */
    hear(heard) {
      if (heard <= 0) return level;
      level = Math.min(1, level + heard * cfg.wakeGain);
      quietFor = 0;
      return level;
    },
    /** Push it straight up (the owner saw the cat). */
    raise(to) {
      level = Math.max(level, Math.min(1, to));
      quietFor = 0;
    },
    update(dt) {
      quietFor += dt;
      // Only the part of this step that is past the quiet delay drains it.
      const draining = Math.min(dt, quietFor - cfg.decayDelay);
      if (draining > 0) level = Math.max(0, level - cfg.wakeDecay * draining);
      return level;
    },
    reset() { level = 0; quietFor = Infinity; },
  };
}

/**
 * Harvester, loudness and wake meter wired together.
 * @param {ReturnType<import('../physics/world.js').createPhysicsWorld>} physics
 * @param {object} opts
 * @param {() => {x: number, y: number, z: number}} opts.listener  where the owner's head is
 * @param {(n: NoiseEvent) => void} [opts.onNoise]  every heard sound
 */
export function createNoise(physics, opts) {
  const cfg = physics.tuning.noise;
  const meter = createWakeMeter(cfg);
  let loudest = 0;
  const harvester = createImpactHarvester(physics, {
    onImpact(e) {
      const loudness = impactLoudness(e, physics.materials, cfg);
      const ear = opts.listener();
      const d = Math.hypot(e.point.x - ear.x, e.point.y - ear.y, e.point.z - ear.z);
      const heardLoudness = loudness * falloff(d, cfg);
      if (heardLoudness < cfg.minHeard) return;
      meter.hear(heardLoudness);
      loudest = Math.max(loudest, heardLoudness);
      opts.onNoise?.({ position: e.point, loudness, heardLoudness, impact: e });
    },
  });
  const unhook = physics.onAfterStep((dt) => meter.update(dt));
  return {
    meter,
    get wake() { return meter.level; },
    get loudest() { return loudest; },
    stats: harvester.stats,
    dispose() { harvester.dispose(); unhook(); },
  };
}
