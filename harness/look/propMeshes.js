// Meshes for B's props and A's debris, in the cozy look.
//
// Each mesh is built from the prop's `visual` spec (the collider's own
// dimensions) and dressed by its kind: a plate gets a foot, a rim and a
// painted band, a mug a rounded lip and a handle, a lamp a glowing shade and
// a light. The collider underneath stays the plain convex shape; nothing
// here changes the physics.
//
// Debris is drawn as what it is, not as its collider: a plate wedge becomes
// a sector of the real plate with ragged break lines, a mug's half shells
// become curved pieces of its wall (one keeps the handle). Break faces are
// matte bisque; the rest keeps its glaze.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as tex from './textures.js';

const BOOK_COVERS = [0xb23a2e, 0x2f6ea6, 0x3f8f5a, 0xd9a441, 0x7a4ea3, 0xd96a2b, 0x2b8c8c, 0x8c3b5e, 0x4a5aa8, 0xc9c0a8];
const MUG_GLAZES = [0xf1ece0, 0x3d7fb5, 0xc0483b, 0xe2a93a, 0x4f9a86];
const POT_GLAZES = [0xb5623a, 0xe9e4d8, 0xb5623a, 0x6f8fa8];
const LEAF_GREENS = [0x3f8f4a, 0x57a85a, 0x2f7a45, 0x6dbb62];
const YARNS = [0xc8443a, 0x2f9a94, 0xd9a13a, 0x8a5fb0];
const CUSHIONS = [0xd0a03a, 0xb5553f, 0x4f8a78];
const CERAMIC = 0xf6efdf;
const CREAM = '#f7f1e2';
const BISQUE = 0xe6dcc6; // the unglazed inside of broken ceramic
const WALL = 0.0055;     // m, thickness of a mug's wall

const css = (color) => `#${color.toString(16).padStart(6, '0')}`;

/** Small repeatable random stream per prop, so it looks the same every frame and every reload. */
function stream(seed) {
  const rand = tex.mulberry32((seed + 1) * 2654435761);
  return { rand, pick: (list) => list[Math.floor(rand() * list.length)], between: (a, b) => a + (b - a) * rand() };
}

const lathe = (points, segments = 48) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), segments);

/** Glazed ceramic: a clear coat over the colour, so it picks up the room. */
function glazed(params) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.24, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide, ...params });
  m.userData.env = 1.1;
  return m;
}

/** A texture that only varies along v: `paint(ctx, row)` where row(v) is the canvas row for a v in 0..1. */
function alongV(paint) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const ctx = c.getContext('2d');
  paint(ctx, (v) => 512 * (1 - v)); // canvas rows run down, v runs up
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ plate

/** A plate's cross-section, from the centre of its underside round the rim to the centre of its well: [radius, y]. */
function plateProfile(R, h) {
  const half = h / 2, well = -half + 0.0085;
  return [
    [0, -half + 0.0035], [0.5 * R, -half + 0.0035], [0.54 * R, -half], [0.61 * R, -half], [0.65 * R, -half + 0.003],
    [0.8 * R, -half + 0.0075], [0.93 * R, half - 0.0055], [0.985 * R, half - 0.003], [R, half - 0.0012], [0.99 * R, half],
    [0.955 * R, half - 0.0006], [0.9 * R, half - 0.004], [0.78 * R, well + 0.0035], [0.66 * R, well], [0, well],
  ];
}
const PLATE_POINTS = 15;
// Profile points 9 to 11.6 are the top of the rim: where the painted band goes.
const PLATE_BAND = [9, 11.6];

/** A plate's glaze: cream with a blue band round the rim and a fine ochre line inside it. */
function plateTexture() {
  const at = (i) => i / (PLATE_POINTS - 1);
  return alongV((ctx, row) => {
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0, 0, 8, 512);
    ctx.fillStyle = '#3f6c9c';
    ctx.fillRect(0, row(at(PLATE_BAND[1])), 8, row(at(PLATE_BAND[0])) - row(at(PLATE_BAND[1])));
    ctx.fillStyle = '#b9895a';
    ctx.fillRect(0, row(at(PLATE_BAND[1] + 0.55)), 8, 2.5);
  });
}

function plateMesh(v, mat) {
  return new THREE.Mesh(lathe(plateProfile(v.radiusTop, v.height), 56), mat);
}

// -------------------------------------------------------------------- mug

/** A mug's cross-section: outside from the centre of the base up to the lip, then down the inside. */
function mugProfile(rt, rb, h) {
  const half = h / 2, floor = -half + 0.012;
  const mid = (rt + rb) / 2 + 0.0015; // a slight belly
  return [
    [0, -half + 0.003], [rb - 0.012, -half + 0.003], [rb - 0.008, -half], [rb - 0.002, -half], [rb, -half + 0.004],
    [mid, 0], [rt, half - 0.007], [rt - 0.0008, half - 0.002], [rt - WALL / 2, half], [rt - WALL + 0.0008, half - 0.002],
    [rt - WALL, half - 0.007], [mid - WALL, 0], [rb - WALL, floor + 0.004], [rb - WALL - 0.004, floor], [0, floor],
  ];
}
const MUG_POINTS = 15;
const MUG_LIP = 8.6;      // profile position where the glaze ends: outside before it, inside after
const MUG_STRIPE = [5.6, 6.2];

/** Colour along a mug's profile: the glaze outside with a pale stripe, cream inside. */
function mugTexture(glaze) {
  const at = (i) => i / (MUG_POINTS - 1);
  return alongV((ctx, row) => {
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, 8, 512);
    ctx.fillStyle = css(glaze);
    ctx.fillRect(0, row(at(MUG_LIP)), 8, 512);
    ctx.fillStyle = 'rgba(255,250,235,0.85)';
    ctx.fillRect(0, row(at(MUG_STRIPE[1])), 8, row(at(MUG_STRIPE[0])) - row(at(MUG_STRIPE[1])));
  });
}

/** Glaze on the lower half of v, cream on the upper: a shard's outside and inside. */
function twoToneTexture(glaze) {
  return alongV((ctx, row) => {
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, 8, 512);
    ctx.fillStyle = css(glaze);
    ctx.fillRect(0, row(0.5), 8, 512);
  });
}

/** A D-shaped handle on the +x side of a mug of this size. */
function mugHandle(rt, rb, h, mat) {
  const r = (y) => rb + (rt - rb) * (y / h + 0.5) + 0.0015; // wall radius at height y
  const top = h * 0.26, bottom = -h * 0.3, out = h * 0.3;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(r(top) - 0.004, top, 0), new THREE.Vector3(r(top) + out * 0.55, top + 0.004, 0),
    new THREE.Vector3(r(0) + out, (top + bottom) / 2 + 0.006, 0), new THREE.Vector3(r(bottom) + out * 0.62, bottom - 0.002, 0),
    new THREE.Vector3(r(bottom) - 0.004, bottom + 0.004, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0078, 10), mat);
  handle.scale.z = 1.25; // a strap, not a ring
  return handle;
}

function mugMesh(v, glaze) {
  const g = new THREE.Group();
  const rt = v.radiusTop, rb = v.radiusBottom, h = v.height;
  g.add(new THREE.Mesh(lathe(mugProfile(rt, rb, h), 40), glazed({ map: mugTexture(glaze) })));
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(rt - WALL - 0.0005, 28), glazed({ color: 0x35200f, roughness: 0.08 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = h / 2 - 0.026;
  g.add(coffee, mugHandle(rt, rb, h, glazed({ color: glaze })));
  return g;
}

// ------------------------------------------------------------------ shards

/** A ragged line: a few random knots, read by position 0..1. */
function jagged(rand, knots = 6) {
  const k = Array.from({ length: knots }, () => rand());
  return (t) => {
    const x = Math.min(0.9999, Math.max(0, t)) * (knots - 1);
    const i = Math.floor(x);
    return k[i] + (k[i + 1] - k[i]) * (x - i);
  };
}

/**
 * A cross-section swept through a series of positions, as one geometry with
 * two groups: 0 = the glazed skin, 1 = the break faces.
 * @param {THREE.Vector3[][]} columns  columns[j][i]: point i of the cross-section at step j of the sweep
 * @param {object} [opts]
 * @param {[number, number][][]} [opts.flat]  flat[j][i]: the cross-section in 2D; given, the two ends are capped as break faces
 * @param {boolean} [opts.ring]          the sweep joins its own start (no ends)
 * @param {boolean} [opts.closeSection]  the cross-section joins its own start
 * @param {number[]} [opts.breakStrips]  strips (between point i and i + 1) that are torn edges, not skin
 */
function sweep(columns, opts = {}) {
  const { flat = null, ring = false, closeSection = false, breakStrips = [] } = opts;
  const pos = [], uv = [], skin = [], breaks = [];
  const n = columns[0].length, J = columns.length;
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < n; i++) {
      const p = columns[j][i];
      pos.push(p.x, p.y, p.z);
      uv.push(j / (J - 1), i / (n - 1));
    }
  }
  const strips = closeSection ? n : n - 1;
  for (let j = 0; j < (ring ? J : J - 1); j++) {
    const a = j * n, b = ((j + 1) % J) * n;
    for (let i = 0; i < strips; i++) {
      const i2 = (i + 1) % n;
      (breakStrips.includes(i) ? breaks : skin).push(a + i, b + i, a + i2, b + i, b + i2, a + i2);
    }
  }
  if (flat) {
    for (const j of [0, J - 1]) {
      const base = pos.length / 3;
      for (const p of columns[j]) { pos.push(p.x, p.y, p.z); uv.push(0.5, 0.5); }
      const contour = flat[j].map(([x, y]) => new THREE.Vector2(x, y));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) breaks.push(base + a, base + b, base + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...skin, ...breaks]);
  g.addGroup(0, skin.length, 0);
  g.addGroup(skin.length, breaks.length, 1);
  g.computeVertexNormals();
  return g;
}

/**
 * One wedge of a broken plate: the plate's own cross-section swept through
 * the wedge's angle, with the two break lines wandering instead of running
 * straight to the centre. Stays inside A's wedge collider.
 */
function plateShard(v, s, glaze, bisque) {
  const [cx, cz] = v.polygon[0]; // the plate's centre, in the piece's frame
  const first = v.polygon[1], end = v.polygon[v.polygon.length - 1];
  const R = Math.hypot(first[0] - cx, first[1] - cz);
  const a0 = Math.atan2(first[1] - cz, first[0] - cx);
  let a1 = Math.atan2(end[1] - cz, end[0] - cx);
  while (a1 <= a0) a1 += 2 * Math.PI;
  const profile = plateProfile(R, v.halfHeight * 2);
  // How far each break line strays into the wedge, by distance from the centre.
  const jagA = jagged(s.rand), jagB = jagged(s.rand);
  const trimA = s.between(0.02, 0.16), trimB = s.between(0.02, 0.16), reach = s.between(0.16, 0.34);
  const steps = 14;
  const columns = [], flat = [];
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    columns.push(profile.map(([r, y]) => {
      const k = r / R;
      const from = a0 + trimA + jagA(k) * reach * (0.35 + 0.65 * k);
      const to = a1 - trimB - jagB(k) * reach * (0.35 + 0.65 * k);
      const a = from + (to - from) * t;
      return new THREE.Vector3(cx + r * Math.cos(a), y, cz + r * Math.sin(a));
    }));
    flat.push(profile);
  }
  return new THREE.Mesh(sweep(columns, { flat }), [glaze, bisque]);
}

/**
 * Half of a broken mug's wall: an arc of the wall with a clean lip on top and
 * ragged edges everywhere it tore. `side` is which half (A cuts the mug
 * along x); the +x half keeps the handle.
 */
function mugShellShard(v, side, s, skin, bisque, handleMat) {
  const [hx, hy, hz] = v.half;
  const rho = hz, axis = -side * hx; // the mug's radius and its axis, in the piece's frame
  const jagL = jagged(s.rand), jagR = jagged(s.rand), jagBottom = jagged(s.rand, 8);
  const spread = s.between(0.25, 0.5), bite = s.between(0.25, 0.55);
  const steps = 12, rows = 6;
  const columns = [], flat = [];
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    // The cross-section here: up the outside, over the lip, down the inside.
    const bottom = -hy + jagBottom(t) * bite * hy;
    const outer = [], inner = [], section = [];
    for (let k = 0; k <= rows; k++) {
      const y = bottom + (hy - bottom) * (k / rows);
      const height = (y + hy) / (2 * hy);
      const from = -Math.PI / 2 + 0.06 + jagL(height) * spread, to = Math.PI / 2 - 0.06 - jagR(height) * spread;
      const a = from + (to - from) * t;
      outer.push(new THREE.Vector3(axis + side * rho * Math.cos(a), y, rho * Math.sin(a)));
      inner.push(new THREE.Vector3(axis + side * (rho - WALL) * Math.cos(a), y, (rho - WALL) * Math.sin(a)));
      section.push([rho, y]);
    }
    columns.push([...outer, ...inner.reverse()]);
    flat.push([...section, ...section.map(([r, y]) => [r - WALL, y]).reverse()]);
  }
  const g = new THREE.Group();
  const n = columns[0].length;
  // The strip that joins the inside back to the outside along the bottom is where it tore off the base.
  g.add(new THREE.Mesh(sweep(columns, { flat, closeSection: true, breakStrips: [n - 1] }), [skin, bisque]));
  if (side > 0 && handleMat) {
    const mugHeight = (hy * 2) / 0.8; // A's shells are the top four fifths of the mug
    const handle = mugHandle(rho, rho, mugHeight, handleMat);
    handle.position.set(axis, -mugHeight * 0.1, 0);
    g.add(handle);
  }
  return g;
}

/** The foot of a broken mug: its floor and a ragged ring of wall. */
function mugBaseShard(v, s, skin, bisque) {
  const R = v.radius, half = v.height / 2;
  const jag = jagged(s.rand, 9);
  const steps = 24;
  const columns = [];
  for (let j = 0; j < steps; j++) {
    const a = (j / steps) * Math.PI * 2;
    const top = -half + 0.012 + jag(j / steps) * (v.height - 0.012) * 1.6;
    const at = (r, y) => new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
    columns.push([at(0, -half), at(R - 0.003, -half), at(R, -half + 0.004), at(R, top), at(R - WALL, top), at(R - WALL, -half + 0.011), at(0, -half + 0.011)]);
  }
  // Strip 3 runs across the top of the wall: the torn edge.
  return new THREE.Mesh(sweep(columns, { ring: true, breakStrips: [3] }), [skin, bisque]);
}

// --------------------------------------------------------------- the rest

/** A geometry with every vertex one colour, ready to merge with others into a single mesh. */
function tinted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A book as one mesh: cover, the block of pages, two label bands on the spine. */
function bookMesh(v, s, paper) {
  const half = v.half;
  const cover = s.pick(BOOK_COVERS);
  // Thickness is the thinnest axis, height the longest; the spine is on the third.
  const order = [0, 1, 2].sort((a, b) => half[a] - half[b]);
  const [thin, depth, tall] = order;
  const standing = tall === 1;
  const spineSign = standing ? 1 : -1; // standing books show their spines to the room
  const parts = [tinted(new RoundedBoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2, 1, Math.min(0.004, half[thin] * 0.5)), cover)];
  // The block of pages shows on the three sides that are not the spine.
  const size = [half[0] * 2, half[1] * 2, half[2] * 2];
  size[thin] *= 0.78;
  size[tall] += 0.001;
  size[depth] -= 0.004;
  const offset = [0, 0, 0];
  offset[depth] = -spineSign * 0.0026;
  parts.push(tinted(new THREE.BoxGeometry(...size).translate(...offset), 0xf0e6cc));
  // Two label bands on the spine.
  for (const [at, length, lighten] of [[s.between(0.25, 0.6), s.between(0.1, 0.2), 0.55], [-0.7, 0.05, 0.3]]) {
    const band = [0.001, 0.001, 0.001], where = [0, 0, 0];
    band[thin] = half[thin] * 2 * 0.82;
    band[tall] = half[tall] * 2 * length;
    where[depth] = spineSign * (half[depth] + 0.0006);
    where[tall] = half[tall] * at;
    parts.push(tinted(new THREE.BoxGeometry(...band).translate(...where), tex.shade(cover, lighten)));
  }
  return new THREE.Mesh(mergeGeometries(parts), paper);
}

function lampMesh(v, glowTexture) {
  const g = new THREE.Group();
  const half = v.height / 2;
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.35, metalness: 0.75 });
  metal.userData.env = 1;
  const base = new THREE.Mesh(lathe([[0, -half], [v.radiusBottom * 0.95, -half], [v.radiusBottom * 0.98, -half + 0.008], [v.radiusBottom * 0.6, -half + 0.022], [0.016, -half + 0.03], [0, -half + 0.03]], 32), metal);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, v.height * 0.52, 14), metal);
  stem.position.y = -half + 0.03 + v.height * 0.26;
  const shadeH = v.height * 0.45;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf0bd62, emissive: 0xff9d3a, emissiveIntensity: 0.55, roughness: 0.85, side: THREE.DoubleSide });
  shadeMat.userData.env = 0.1;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(v.radiusTop * 0.74, v.radiusTop * 0.98, shadeH, 36, 1, true), shadeMat);
  shade.position.y = half - shadeH / 2;
  // Trim rings at the top and bottom of the shade.
  for (const [r, y] of [[v.radiusTop * 0.74, half - 0.002], [v.radiusTop * 0.98, half - shadeH + 0.002]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035, 8, 36), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe2a6 }));
  bulb.position.y = half - shadeH * 0.55;
  g.add(base, stem, shade, bulb);

  const light = new THREE.PointLight(0xffb869, 2.2, 4.5, 1.6);
  light.position.y = half - shadeH * 0.5;
  g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  glow.scale.set(0.75, 0.75, 1);
  glow.position.y = half - shadeH * 0.5;
  glow.renderOrder = 7;
  g.add(glow);
  g.userData.lamp = { light, glow, shadeMat };
  return g;
}

function potMesh(v, s) {
  const g = new THREE.Group();
  const rt = v.radiusTop, rb = v.radiusBottom, half = v.height / 2;
  const glaze = new THREE.MeshStandardMaterial({ color: s.pick(POT_GLAZES), roughness: 0.55 });
  glaze.userData.env = 0.6;
  g.add(new THREE.Mesh(lathe([
    [0, -half], [rb, -half], [rb + 0.003, -half + 0.006], [rt * 0.93, half - v.height * 0.22], [rt, half - v.height * 0.2], [rt, half - 0.006], [rt * 0.985, half],
    [rt * 0.9, half], [rt * 0.87, half - 0.012], [0, half - 0.012],
  ], 36), glaze));
  const soil = new THREE.Mesh(new THREE.CircleGeometry(rt * 0.88, 24), new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = half - 0.01;
  g.add(soil);
  // Leaves: blades that bow outwards, all one mesh. They have no collider.
  const count = 11, blades = [];
  for (let i = 0; i < count; i++) {
    const len = rt * s.between(1.7, 3.2), width = len * s.between(0.16, 0.24);
    const blade = new THREE.SphereGeometry(1, 10, 10);
    blade.scale(width, len, width * 0.22);
    // Bow it: the further up, the further it leans.
    const p = blade.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) / len; // -1..1
      p.setZ(k, p.getZ(k) + Math.max(0, y + 0.4) ** 2 * len * 0.22);
    }
    blade.computeVertexNormals();
    const colour = s.pick(LEAF_GREENS);
    // Stand it on the soil, lean it out, turn it to its place round the pot.
    blade.translate(0, len * 0.9, 0);
    blade.rotateX(i < 3 ? s.between(-0.1, 0.12) : s.between(0.25, 0.7)); // a few upright, the rest leaning out
    blade.rotateY((i / count) * Math.PI * 2 + s.between(-0.3, 0.3));
    blade.translate(0, half - 0.012, 0);
    blades.push(tinted(blade, colour));
  }
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  leafMat.userData.env = 0.7;
  g.add(new THREE.Mesh(mergeGeometries(blades), leafMat));
  return g;
}

function clockMesh(v, faceTexture) {
  const g = new THREE.Group();
  const [hx, hy, hz] = v.half;
  const shell = new THREE.MeshStandardMaterial({ color: 0x2b1d16, roughness: 0.4 });
  shell.userData.env = 0.8;
  g.add(new THREE.Mesh(new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, 0.012), shell));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(hx * 1.7, hy * 1.5), new THREE.MeshBasicMaterial({ map: faceTexture }));
  face.position.z = hz + 0.0008;
  g.add(face);
  return g;
}

/** A flat screen on a stand, facing +z, its desktop glowing. */
function monitorMesh(v, screenTexture) {
  const g = new THREE.Group();
  const [hx, hy, hz] = v.half;
  const shell = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.45, metalness: 0.2 });
  shell.userData.env = 0.8;
  const foot = new THREE.Mesh(new RoundedBoxGeometry(hx * 0.9, 0.012, hz * 1.9, 2, 0.005), shell);
  foot.position.y = -hy + 0.006;
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.045, hy * 0.5, 0.014, 2, 0.005), shell);
  neck.position.set(0, -hy + hy * 0.25, -hz * 0.35);
  const panelH = hy * 2 * 0.8;
  const panel = new THREE.Mesh(new RoundedBoxGeometry(hx * 2, panelH, 0.024, 3, 0.008), shell);
  panel.position.set(0, hy - panelH / 2, 0);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 - 0.026, panelH - 0.026), new THREE.MeshBasicMaterial({ map: screenTexture }));
  display.position.set(0, hy - panelH / 2, 0.0125);
  g.add(foot, neck, panel, display);
  // The screen lights whatever is in front of it.
  const spill = new THREE.PointLight(0x8fb8ff, 0.5, 1.6, 1.8);
  spill.position.set(0, hy - panelH / 2, 0.25);
  g.add(spill);
  return g;
}

function keyboardMesh(v, keysTexture) {
  const g = new THREE.Group();
  const [hx, hy, hz] = v.half;
  const deck = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.5 });
  deck.userData.env = 0.6;
  g.add(new THREE.Mesh(new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, 0.006), deck));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 - 0.012, hz * 2 - 0.012), new THREE.MeshStandardMaterial({ map: keysTexture, roughness: 0.55 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = hy + 0.0006;
  g.add(top);
  return g;
}

/**
 * @param {{cloth: (color: number) => THREE.Material}} mats  the room's shared materials
 * @returns {(record: object) => THREE.Object3D} mesh for a Prop or debris record
 */
export function createPropLook(mats) {
  const plateGlaze = glazed({ map: plateTexture() });
  const bisque = new THREE.MeshStandardMaterial({ color: BISQUE, roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
  bisque.userData.env = 0.15;
  const glowTexture = tex.glow();
  const faceTexture = tex.clockFace();
  const yarnTexture = tex.yarn();
  yarnTexture.repeat.set(2, 2);
  const screenTexture = tex.screen();
  const keysTexture = tex.keys();
  // Every book is one mesh in this one material; its colours are in its vertices.
  const paper = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76 });
  paper.userData.env = 0.3;

  function debris(record) {
    const v = record.visual;
    const from = record.parentSerial ?? record.body.id;
    // Every piece of one prop shares its glaze; each piece gets its own break lines.
    const s = stream(from * 31 + (record.index ?? 0) + 7);
    if (record.debrisOf === 'plate' && v.type === 'prism') return plateShard(v, s, plateGlaze, bisque);
    if (record.debrisOf === 'mug') {
      const glaze = stream(from).pick(MUG_GLAZES); // the same pick the whole mug made
      // A's pieces come as: the -x half shell, the +x half shell, the base.
      if (v.type === 'box') return mugShellShard(v, record.index === 0 ? -1 : 1, s, glazed({ map: twoToneTexture(glaze) }), bisque, glazed({ color: glaze }));
      if (v.type === 'cylinder') return mugBaseShard(v, s, glazed({ map: twoToneTexture(glaze) }), bisque);
    }
    // A kind of debris this file has not met: draw the collider.
    const plain = glazed({ color: CERAMIC });
    if (v.type === 'box') return new THREE.Mesh(new THREE.BoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2), plain);
    if (v.type === 'prism') return plateShard(v, s, plain, bisque);
    return new THREE.Mesh(new THREE.CylinderGeometry(v.radiusTop ?? v.radius, v.radiusBottom ?? v.radius, v.height, 20), plain);
  }

  return function meshFor(record) {
    const v = record.visual;
    // Seeded by spawn order, so a book keeps its cover across resets.
    const s = stream(record.serial ?? record.body.id);
    let mesh;
    switch (record.kind) {
      case 'plate': mesh = plateMesh(v, plateGlaze); break;
      case 'mug': mesh = mugMesh(v, s.pick(MUG_GLAZES)); break;
      case 'book': mesh = bookMesh(v, s, paper); break;
      case 'lamp': mesh = lampMesh(v, glowTexture); break;
      case 'pot': mesh = potMesh(v, s); break;
      case 'clock': mesh = clockMesh(v, faceTexture); break;
      case 'monitor': mesh = monitorMesh(v, screenTexture); break;
      case 'keyboard': mesh = keyboardMesh(v, keysTexture); break;
      case 'pillow':
        mesh = new THREE.Mesh(new RoundedBoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2, 5, Math.min(v.half[1] * 0.95, 0.06)),
          mats.cloth(record.tag === 'cushion' ? s.pick(CUSHIONS) : 0xf7f3ea));
        break;
      case 'ball': {
        const wool = new THREE.MeshStandardMaterial({ color: s.pick(YARNS), map: yarnTexture, bumpMap: yarnTexture, bumpScale: 1.5, roughness: 0.95 });
        wool.userData.env = 0.15;
        mesh = new THREE.Mesh(new THREE.SphereGeometry(v.radius, 24, 16), wool);
        break;
      }
      case 'debris': mesh = debris(record); break;
      default:
        mesh = v.type === 'box'
          ? new THREE.Mesh(new THREE.BoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2), plateGlaze)
          : new THREE.Mesh(new THREE.CylinderGeometry(v.radiusTop, v.radiusBottom, v.height, 32), plateGlaze);
    }
    mesh.traverse((o) => {
      if (o.isMesh && !(Array.isArray(o.material) ? o.material[0] : o.material).isMeshBasicMaterial) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return mesh;
  };
}
