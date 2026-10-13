// Material table (Workstream B).
//
// One row per material in tuning.js: friction, restitution, loudness, break
// impulse and contact stiffness. This module turns the rows into cannon-es
// Materials and one ContactMaterial per pair, and answers the questions the
// other workstreams ask:
//   solver   -> friction / restitution / stiffness per pair (ContactMaterials)
//   D, noise -> loudness(matA, matB)
//   A, fracture -> breakImpulse(material, breakScale)
//
// Pair rule: friction and loudness are the geometric mean of the two rows;
// restitution and contact stiffness are the lower of the two (the deader,
// softer material wins, so a mug doesn't bounce off the mattress).
// `tuning.materialPairs` overrides any of the four for a pair.
//
// The table reads tuning.js live: after the overlay edits a number, call
// refresh() and the next step uses it.
//
// Friction is never set on the cannon Material itself. cannon-es multiplies
// the two Materials' own friction values when both are set, which would
// bypass the pair table.
//
// No Three.js: simulation code must run headless.

import * as CANNON from 'cannon-es';
import { tuning as defaultTuning } from '../core/tuning.js';

// Used for a material name that has no row (e.g. a new static box material).
// It has no stiffness of its own, so it takes tuning.physics.contactStiffness.
const FALLBACK_ROW = { friction: 0.5, restitution: 0.05, loudness: 1, breakImpulse: null };

/** Order-independent key of a material pair: names sorted, "a|b". */
export function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @param {CANNON.World | null} world  contact materials are registered here; null for a table with no world
 * @param {object} [tuning]
 */
export function createMaterialTable(world, tuning = defaultTuning) {
  const materials = new Map(); // name -> CANNON.Material
  const contacts = new Map();  // pairKey -> CANNON.ContactMaterial
  const warned = new Set();

  /** The tuning row of a material. */
  function row(name) {
    const r = tuning.materials[name];
    if (r) return r;
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[materials] no row for "${name}" in tuning.materials, using the fallback`);
    }
    return FALLBACK_ROW;
  }

  /** Combined numbers of a pair, overrides applied. */
  function pair(a, b) {
    const ra = row(a), rb = row(b);
    const o = tuning.materialPairs?.[pairKey(a, b)] ?? {};
    const k = tuning.physics.contactStiffness;
    return {
      friction: o.friction ?? Math.sqrt(ra.friction * rb.friction),
      restitution: o.restitution ?? Math.min(ra.restitution, rb.restitution),
      loudness: o.loudness ?? Math.sqrt(ra.loudness * rb.loudness),
      stiffness: o.stiffness ?? Math.min(ra.stiffness ?? k, rb.stiffness ?? k),
    };
  }

  function applyContact(cm, a, b) {
    const p = pair(a, b);
    const ph = tuning.physics;
    cm.friction = p.friction;
    cm.restitution = p.restitution;
    cm.contactEquationStiffness = p.stiffness;
    cm.contactEquationRelaxation = ph.contactRelaxation;
    cm.frictionEquationStiffness = ph.frictionStiffness;
    cm.frictionEquationRelaxation = ph.frictionRelaxation;
  }

  /** The cannon Material for a name, created on first use. */
  function get(name) {
    let m = materials.get(name);
    if (m) return m;
    m = new CANNON.Material(name);
    materials.set(name, m);
    // One ContactMaterial against every material so far, itself included.
    for (const [other, om] of materials) {
      const cm = new CANNON.ContactMaterial(m, om);
      applyContact(cm, name, other);
      contacts.set(pairKey(name, other), cm);
      world?.addContactMaterial(cm);
    }
    return m;
  }

  /** Re-read tuning.js into every ContactMaterial and the world default. */
  function refresh() {
    for (const [key, cm] of contacts) {
      const [a, b] = key.split('|');
      applyContact(cm, a, b);
    }
    if (world) {
      const ph = tuning.physics;
      const d = world.defaultContactMaterial;
      d.friction = ph.defaultFriction;
      d.restitution = ph.defaultRestitution;
      d.contactEquationStiffness = ph.contactStiffness;
      d.contactEquationRelaxation = ph.contactRelaxation;
      d.frictionEquationStiffness = ph.frictionStiffness;
      d.frictionEquationRelaxation = ph.frictionRelaxation;
    }
  }

  /** Material name of a body or cannon Material (null if it has none). */
  function nameOf(bodyOrMaterial) {
    const m = bodyOrMaterial?.material ?? bodyOrMaterial;
    return m?.name || null;
  }

  for (const name of Object.keys(tuning.materials)) get(name);
  refresh();

  return {
    /** Names with a row in tuning.js. */
    get names() { return Object.keys(tuning.materials); },
    get,
    /** Same as get(); the shape buildStaticGeometry() expects. */
    materialFor: get,
    row,
    pair,
    friction: (a, b) => pair(a, b).friction,
    restitution: (a, b) => pair(a, b).restitution,
    stiffness: (a, b) => pair(a, b).stiffness,
    /** D's noise scale for an impact between two materials. */
    loudness: (a, b) => pair(a, b).loudness,
    /**
     * A's fracture threshold in N·s. `breakScale` is the prop's own factor
     * (a thin plate breaks more easily than a mug of the same ceramic).
     * Infinity for materials that never break.
     */
    breakImpulse(name, breakScale = 1) {
      const b = row(name).breakImpulse;
      return b == null ? Infinity : b * breakScale;
    },
    /** The ContactMaterial of a pair (both names must have been created). */
    contact: (a, b) => contacts.get(pairKey(a, b)) ?? null,
    nameOf,
    refresh,
  };
}
