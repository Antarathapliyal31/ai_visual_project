// The cat: a brown mackerel tabby built around the controller's collider.
//
// Modelled facing +x with its origin at the collider's centre, so the mesh
// just copies the body's position and quaternion. The body, head, legs and
// tail are shaped from overlapping ellipsoids; the tabby coat (flank
// stripes, the dark line down the spine, the M on the forehead, ringed legs
// and tail, pale chest, belly, muzzle and socks) is painted into vertex
// colours from each point's place on the body, under a combed fur texture.
//
// Sizes are written for the default 12 cm collider radius and scale with it.
// Everything stays under the collider's 24 cm except the ear tips (25.6 cm),
// which still clear the 26 cm gap under the desk; pass `low` to update()
// where there is no headroom and the tail comes down too.
//
// update() only reads the controller's state: legs step with the speed, the
// tail sways, the body stretches in the air, a front paw swipes on a swat,
// and it breathes and blinks when it stands still.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as tex from './textures.js';

const BASE = new THREE.Color(0xa67f4f), BACK = new THREE.Color(0x7f5f3b), DARK = new THREE.Color(0x33241a);
const LIGHT = new THREE.Color(0xf0dfbf), PINK = new THREE.Color(0xd98f8a);

/** 0 at a, 1 at b, eased; works with a > b too. */
function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** An ellipsoid in place, with vertex colours from `paint(x, y, z, colour)`. */
function blob(center, radii, paint, { segments = 28, rotZ = 0, rotX = 0 } = {}) {
  const geo = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.7));
  geo.scale(radii[0], radii[1], radii[2]);
  if (rotZ) geo.rotateZ(rotZ);
  if (rotX) geo.rotateX(rotX);
  geo.translate(center[0], center[1], center[2]);
  return painted(geo, paint);
}

function painted(geo, paint) {
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    paint(p.getX(i), p.getY(i), p.getZ(i), c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createCatMesh(dims) {
  const k = dims.radius / 0.12; // everything below is in metres for a 12 cm radius
  const S = (v) => v * k;
  const P = (x, y, z) => [S(x), S(y), S(z)];
  const group = new THREE.Group();

  const coat = tex.fur();
  coat.repeat.set(3, 3);
  const fur = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: coat, bumpMap: coat, bumpScale: 1.4, roughness: 0.92, sheen: 0.8, sheenRoughness: 0.5, sheenColor: 0xf6dfb4 });
  fur.userData.env = 0.3;

  // ------------------------------------------------------------- the coat
  /** Body: flank stripes, spine line, pale chest and belly. Coordinates in metres at k = 1. */
  const bodyCoat = (X, Y, Z, c) => {
    const x = X / k, y = Y / k, z = Z / k;
    c.copy(BASE).lerp(BACK, smooth(0.02, 0.09, y) * 0.65);
    const wave = Math.sin(x * 96 + Math.sin(y * 40 + z * 9) * 1.1);
    c.lerp(DARK, smooth(0.2, 0.72, wave) * smooth(-0.028, 0.02, y) * 0.88);
    c.lerp(DARK, smooth(0.02, 0.004, Math.abs(z)) * smooth(0.066, 0.086, y) * 0.85);
    const belly = smooth(-0.004, -0.03, y), chest = smooth(0.1, 0.16, x) * smooth(0.03, -0.012, y);
    c.lerp(LIGHT, Math.max(belly, chest) * 0.92);
  };
  /** Head: the M on the forehead, stripes back from the eyes, pale muzzle and chin. */
  const faceCoat = (X, Y, Z, c) => {
    const x = X / k, y = Y / k, z = Z / k;
    c.copy(BASE);
    const lines = smooth(0.25, 0.8, Math.cos(z * 290));
    c.lerp(DARK, smooth(0.08, 0.1, y) * smooth(0.25, 0.215, x) * lines * 0.9);
    const cheek = smooth(0.03, 0.048, Math.abs(z)) * smooth(0.235, 0.2, x);
    c.lerp(DARK, cheek * smooth(0.35, 0.85, Math.sin(y * 250 + x * 70)) * 0.75);
    c.lerp(LIGHT, smooth(0.062, 0.034, y) * smooth(0.19, 0.228, x) * 0.92);
  };
  const pale = (x, y, z, c) => c.copy(LIGHT);
  const pink = (x, y, z, c) => c.copy(PINK);
  /** A limb hanging down from y = 0: rings, and a pale sock on the bottom third. */
  const limbCoat = (length) => (X, Y, Z, c) => {
    const t = -Y / length; // 0 at the top, 1 at the paw
    c.copy(BASE).lerp(DARK, smooth(0.25, 0.8, Math.sin(t * 13 + 1)) * (1 - smooth(0.55, 0.75, t)) * 0.85);
    c.lerp(LIGHT, smooth(0.6, 0.78, t) * 0.95);
  };

  // ----------------------------------------------------------------- body
  const body = new THREE.Group();
  const torso = new THREE.Mesh(mergeGeometries([
    blob(P(0.07, 0.03, 0), P(0.1, 0.062, 0.058), bodyCoat, { segments: 36 }),          // ribcage
    blob(P(-0.035, 0.024, 0), P(0.12, 0.056, 0.054), bodyCoat, { segments: 36 }),      // belly
    blob(P(-0.12, 0.03, 0), P(0.075, 0.068, 0.062), bodyCoat, { segments: 32 }),       // haunches
    blob(P(0.085, 0.062, 0), P(0.05, 0.03, 0.04), bodyCoat),                           // shoulders
    blob(P(0.145, 0.05, 0), P(0.055, 0.046, 0.044), bodyCoat),                         // neck
    blob(P(-0.125, 0.0, 0.046), P(0.05, 0.062, 0.027), bodyCoat),                      // thighs
    blob(P(-0.125, 0.0, -0.046), P(0.05, 0.062, 0.027), bodyCoat),
    blob(P(0.1, 0.004, 0.04), P(0.03, 0.05, 0.024), bodyCoat),                         // upper forelegs
    blob(P(0.1, 0.004, -0.04), P(0.03, 0.05, 0.024), bodyCoat),
  ]), fur);
  body.add(torso);

  // ----------------------------------------------------------------- head
  // Built in body coordinates so the coat lines up, then hung on a pivot at the neck.
  const neck = P(0.165, 0.052, 0);
  const headGeo = mergeGeometries([
    blob(P(0.19, 0.062, 0), P(0.058, 0.05, 0.06), faceCoat, { segments: 36 }),         // skull
    blob(P(0.205, 0.042, 0.033), P(0.03, 0.026, 0.026), faceCoat),                     // cheeks
    blob(P(0.205, 0.042, -0.033), P(0.03, 0.026, 0.026), faceCoat),
    blob(P(0.24, 0.042, 0), P(0.024, 0.02, 0.03), pale),                               // muzzle
    blob(P(0.234, 0.026, 0), P(0.018, 0.012, 0.02), pale),                             // chin
    blob(P(0.2615, 0.051, 0), P(0.007, 0.006, 0.0095), pink, { segments: 12 }),        // nose
  ]);
  headGeo.translate(-neck[0], -neck[1], -neck[2]);
  const head = new THREE.Group();
  head.position.set(...neck);
  head.add(new THREE.Mesh(headGeo, fur));

  const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xb9cf4a, emissive: 0x53701a, emissiveIntensity: 0.45, roughness: 0.15, clearcoat: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0907, roughness: 0.3 });
  const earSkin = new THREE.MeshStandardMaterial({ color: 0xd9a39a, roughness: 0.8, side: THREE.DoubleSide });
  const earFur = new THREE.MeshPhysicalMaterial({ color: 0x8a6841, map: coat, roughness: 0.92, sheen: 0.6, sheenColor: 0xf6dfb4, side: THREE.DoubleSide });
  eyeWhite.userData.env = 1.2;
  const eyes = [], ears = [];
  for (const side of [-1, 1]) {
    // Eye: a dark rim, the iris, a slit pupil and a glint.
    const eye = new THREE.Group();
    eye.position.set(S(0.236) - neck[0], S(0.075) - neck[1], side * S(0.03));
    eye.rotation.y = -side * 0.42; // set into the side of the face
    const rim = new THREE.Mesh(new THREE.SphereGeometry(S(0.0148), 16, 12), black);
    rim.scale.set(0.45, 1, 1.12);
    rim.position.x = -S(0.002);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(S(0.0125), 16, 12), eyeWhite);
    iris.scale.set(0.55, 0.95, 1);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(S(0.0115), 12, 10), black);
    pupil.scale.set(0.3, 0.9, 0.33);
    pupil.position.x = S(0.0048);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(S(0.003), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(S(0.0072), S(0.0045), -side * S(0.003));
    eye.add(rim, iris, pupil, glint);
    head.add(eye);
    eyes.push(eye);

    // Ear: a thin cone leaning out, pink inside.
    const ear = new THREE.Group();
    ear.position.set(S(0.178) - neck[0], S(0.097) - neck[1], side * S(0.038));
    ear.rotation.x = side * 0.32;
    const shell = new THREE.Mesh(new THREE.ConeGeometry(S(0.026), S(0.04), 14), earFur);
    shell.scale.x = 0.5;
    shell.position.y = S(0.017);
    const inside = new THREE.Mesh(new THREE.ConeGeometry(S(0.018), S(0.03), 12), earSkin);
    inside.scale.x = 0.4;
    inside.position.set(S(0.007), S(0.015), 0);
    ear.add(shell, inside);
    head.add(ear);
    ears.push(ear);
  }
  // Whiskers: three a side, fanned.
  const whiskers = [];
  for (const side of [-1, 1]) {
    for (const lift of [-0.012, 0.0, 0.012]) {
      whiskers.push(S(0.247) - neck[0], S(0.042) - neck[1], side * S(0.02));
      whiskers.push(S(0.262) - neck[0], S(0.042 + lift) - neck[1], side * S(0.092));
    }
  }
  const whiskerGeo = new THREE.BufferGeometry();
  whiskerGeo.setAttribute('position', new THREE.Float32BufferAttribute(whiskers, 3));
  head.add(new THREE.LineSegments(whiskerGeo, new THREE.LineBasicMaterial({ color: 0xfaf4e6, transparent: true, opacity: 0.85 })));
  body.add(head);

  // ----------------------------------------------------------------- legs
  // Each leg hangs from a pivot, so it can swing. Front legs from the shoulders, hind shanks from the thighs.
  const legs = [];
  const makeLeg = (front, side) => {
    const hip = new THREE.Group();
    const top = front ? -0.012 : -0.03;
    hip.position.set(S(front ? 0.105 : -0.14), S(top), side * S(front ? 0.04 : 0.046));
    const length = dims.radius + S(top) - S(0.012); // down to just above the floor
    const limb = new THREE.CylinderGeometry(S(front ? 0.018 : 0.017), S(front ? 0.014 : 0.013), length, 12, 6);
    limb.translate(0, -length / 2, 0);
    const paw = new THREE.SphereGeometry(1, 14, 10);
    paw.scale(S(front ? 0.022 : 0.028), S(0.0115), S(0.018));
    paw.translate(S(front ? 0.007 : 0.011), -length - S(0.0005), 0);
    const geo = mergeGeometries([painted(limb, limbCoat(length)), painted(paw, pale)]);
    hip.add(new THREE.Mesh(geo, fur));
    body.add(hip);
    legs.push({ hip, front, right: side > 0, phase: front === (side > 0) ? 0 : Math.PI });
  };
  for (const front of [true, false]) for (const side of [-1, 1]) makeLeg(front, side);

  // ----------------------------------------------------------------- tail
  // A chain of ringed segments: up from the rump and curling at the tip.
  const tail = [];
  const SEGMENTS = 9, SEG = S(0.042);
  let parent = body;
  for (let i = 0; i < SEGMENTS; i++) {
    const joint = new THREE.Group();
    joint.position.set(i === 0 ? S(-0.185) : 0, i === 0 ? S(0.055) : SEG * 0.92, 0);
    const r0 = S(0.016 - i * 0.0007), r1 = S(0.016 - (i + 1) * 0.0007);
    const seg = new THREE.CylinderGeometry(r1, r0, SEG, 10, 3);
    seg.translate(0, SEG / 2, 0);
    const cap = new THREE.SphereGeometry(r1, 10, 8);
    cap.translate(0, SEG, 0);
    const ring = i % 2 === 1 || i === SEGMENTS - 1;
    const colour = (x, y, z, c) => c.copy(ring ? DARK : BASE).lerp(DARK, i >= SEGMENTS - 2 ? 0.8 : 0);
    joint.add(new THREE.Mesh(mergeGeometries([painted(seg, colour), painted(cap, colour)]), fur));
    parent.add(joint);
    tail.push(joint);
    parent = joint;
  }

  group.add(body);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });

  let stride = 0, time = 0, swat = 0, lastSwats = 0, air = 0, turn = 0, lastHeading = null, lowTail = 0, blink = 0, nextBlink = 2;
  const SWAT_TIME = 0.22;

  return {
    group,
    /**
     * @param {number} dt  seconds since the last frame
     * @param {ReturnType<import('../../src/player/cat.js').createCat>} cat
     * @param {{low?: boolean}} [where]  low: no headroom (under the desk or bed), keep the tail down
     */
    update(dt, cat, where = {}) {
      group.position.copy(cat.body.position);
      group.quaternion.copy(cat.body.quaternion);
      time += dt;
      const speed = cat.state.speed;
      const moving = Math.min(1, speed / 1.2);
      stride += speed * dt * 11;

      if (lastHeading !== null && dt > 0) {
        let d = cat.heading - lastHeading;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        turn += (d / dt - turn) * Math.min(1, dt * 10);
      }
      lastHeading = cat.heading;
      air += ((cat.state.grounded ? 0 : 1) - air) * Math.min(1, dt * 14);
      lowTail += ((where.low ? 1 : 0) - lowTail) * Math.min(1, dt * 8);
      if (cat.state.swats !== lastSwats) { lastSwats = cat.state.swats; swat = SWAT_TIME; }
      swat = Math.max(0, swat - dt);
      const swipe = swat > 0 ? Math.sin((1 - swat / SWAT_TIME) * Math.PI) : 0;

      for (const leg of legs) {
        const walk = Math.sin(stride + leg.phase) * 0.62 * moving;
        const reach = (leg.front ? 0.95 : -0.85) * air; // stretched out in the air
        leg.hip.rotation.z = walk * (1 - air) + reach + (leg.front && leg.right ? swipe * 1.5 : 0);
      }
      // Standing still it breathes; walking it bobs; in the air it tips with its flight.
      const still = 1 - moving;
      torso.scale.set(1, 1 + Math.sin(time * 2.4) * 0.012 * still, 1 + Math.sin(time * 2.4) * 0.018 * still);
      body.position.y = Math.abs(Math.sin(stride)) * S(0.006) * moving * (1 - air);
      body.rotation.z = -0.14 * air * Math.sign(cat.body.velocity.y || 1);
      head.rotation.y = Math.max(-0.55, Math.min(0.55, turn * 0.1));
      head.rotation.z = Math.sin(stride * 2) * 0.03 * moving + Math.sin(time * 0.9) * 0.02 * still;

      // Tail: up and curled when it has room, streaming back at a run, flat where there is no headroom.
      const lift = 1.25 - 0.55 * moving - 0.45 * air;
      tail[0].rotation.z = lift * (1 - lowTail) + 1.55 * lowTail;
      tail.forEach((joint, i) => {
        if (i > 0) joint.rotation.z = (-0.21 - 0.05 * Math.sin(time * 1.3 + i * 0.5)) * (1 - lowTail) * (1 - 0.6 * moving);
        joint.rotation.x = Math.sin(time * 2.1 + i * 0.6) * (0.05 + 0.03 * i) * (1 - 0.5 * moving);
      });

      // Blink now and then; ears flick with it.
      nextBlink -= dt;
      if (nextBlink <= 0) { blink = 0.14; nextBlink = 2.5 + Math.random() * 3.5; }
      blink = Math.max(0, blink - dt);
      const lid = blink > 0 ? 0.12 : 1;
      for (const eye of eyes) eye.scale.y = lid;
      ears.forEach((ear, i) => { ear.rotation.z = (blink > 0 ? 0.18 : 0) * (i ? 1 : -1) * 0.5; });
    },
  };
}
