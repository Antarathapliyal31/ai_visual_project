// The room, drawn from A's static geometry.
//
// Every solid in STATIC_BOXES and every occluder becomes a mesh styled by its
// id (falling back to its material name, so furniture added to the store
// later still gets wood or cloth). On top of that comes dressing that needs
// no collider: rugs, baseboards, the window, pictures, drawer fronts, the
// blanket, and soft contact shadows.
//
// Nothing here is physical. If it should stop the cat, it belongs in
// src/collision/staticGeometry.js, not in this file.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STATIC_BOXES, OCCLUDERS, ROOM, SURFACES } from '../../src/collision/index.js';
import * as tex from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRAIN_TILE, roundedBox, createMaterials } from './materials.js';
import { FURNITURE } from './furniture.js';

export const PALETTE = {
  floorSide: 0x5a3417,
  wall: 0x8b8a7c, wallCut: 0xcfc8b3,
  baseboard: 0x6e4120,
  deskTop: 0xc07f3c, desk: 0xa3662d,
  bed: 0x8f5c2d, mattress: 0xf0eadc, skirt: 0x5876a8, sheet: 0xf6f1e4,
  nightstand: 0x74401f,
  shelf: 0xa0652f, shelfBack: 0x6a4120,
  sill: 0xb7793b,
  wood: 0x9a6230, cloth: 0xb9ae9c,
  brass: 0xd8a84a,
  frame: 0x7a4a22, windowFrame: 0xc98f4a, blinds: 0x3f72b8,
};

function styleFor(spec) {
  const id = spec.id;
  const P = PALETTE;
  if (id === 'bedMattress') return { type: 'cloth', color: P.mattress, radius: 0.05 };
  if (id.startsWith('bedSkirt')) return { type: 'cloth', color: P.skirt, radius: 0.002 };
  if (id.startsWith('bed')) return { type: 'wood', color: P.bed, radius: 0.02 };
  if (id === 'nightstand') return { type: 'wood', color: P.nightstand, radius: 0.015 };
  if (id === 'deskTop') return { type: 'wood', color: P.deskTop, radius: 0.012 };
  if (id.startsWith('desk')) return { type: 'wood', color: P.desk, radius: 0.008 };
  if (id === 'bookshelfBack') return { type: 'wood', color: P.shelfBack, radius: 0.003 };
  if (id.startsWith('bookshelf')) return { type: 'wood', color: P.shelf, radius: 0.006 };
  if (id === 'windowSill') return { type: 'wood', color: P.sill, radius: 0.008 };
  if (id === 'wallShelf') return { type: 'wood', color: P.shelf, radius: 0.004 };
  // Furniture this file has never heard of: dress it by its material.
  if (spec.material === 'fabric') return { type: 'cloth', color: P.cloth, radius: 0.04 };
  return { type: 'wood', color: P.wood, radius: 0.01 };
}

const spec = (id) => STATIC_BOXES.find((s) => s.id === id);
const shadowed = (mesh, cast = true) => {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
};

/**
 * Fold every still, opaque mesh under `root` into one mesh per material. The
 * room is some three hundred small pieces that never move; drawn one by one
 * they cost a draw call each, three times a frame (shadows, colour, ambient
 * occlusion). Anything marked userData.dynamic, anything transparent, and
 * the multi-material shell are left as they are.
 */
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || o.material.transparent || o.userData.noAO || o.renderOrder !== 0) return;
    for (let p = o; p && p !== root.parent; p = p.parent) if (p.userData.dynamic) return;
    const key = `${o.material.uuid}:${o.castShadow}:${o.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(o);
  });
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      return g.applyMatrix4(m.matrixWorld);
    });
    const merged = new THREE.Mesh(mergeGeometries(parts), meshes[0].material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    for (const m of meshes) m.removeFromParent();
    root.add(merged);
  }
}

/**
 * @param {{maxAnisotropy?: number}} [opts]
 * @returns {{group: THREE.Group, materials: object, update: (t: number) => void, setNight: (night: boolean) => void}}
 */
export function buildRoom(opts = {}) {
  const mats = createMaterials(opts.maxAnisotropy);
  const group = new THREE.Group();
  // What the furniture builders share: materials, per-frame callbacks, and lights that follow the mood.
  const ctx = { mats, animate: [], lights: [] };
  const P = PALETTE;
  const add = (mesh, cast = true) => group.add(shadowed(mesh, cast));
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ;

  // ------------------------------------------------------------ the shell
  for (const s of STATIC_BOXES) {
    if (s.visible === false) continue;
    const [w, h, d] = s.half.map((v) => v * 2);
    let mesh;
    if (s.id === 'floor') {
      const planks = tex.plankFloor(w, d);
      const side = mats.plain(P.floorSide, 0.8);
      const top = new THREE.MeshStandardMaterial({ map: planks.map, bumpMap: planks.bumpMap, bumpScale: 1.6, roughness: 0.5, metalness: 0.02 });
      top.userData.env = 0.35;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, side, side, side]);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.position.set(...s.center);
      group.add(mesh);
      continue;
    }
    if (s.id === 'wallWest' || s.id === 'wallNorth') {
      const paint = new THREE.MeshStandardMaterial({ map: tex.plaster({ seed: s.id.length, color: P.wall }), roughness: 0.95 });
      const cut = mats.plain(P.wallCut, 0.9), back = mats.plain(0x6f6b5e, 0.95);
      // Inner face: +x for the west wall, +z for the north wall.
      const faces = s.id === 'wallWest' ? [paint, back, cut, back, cut, cut] : [cut, cut, cut, back, paint, back];
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faces);
      mesh.position.set(...s.center);
      add(mesh, false);
      continue;
    }
    if (FURNITURE[s.id]) {
      group.add(FURNITURE[s.id](s, ctx));
      continue;
    }
    const st = styleFor(s);
    mesh = new THREE.Mesh(roundedBox(w, h, d, st.radius), st.type === 'cloth' ? mats.cloth(st.color) : mats.wood(st.color));
    mesh.position.set(...s.center);
    if (s.rotY) mesh.rotation.y = s.rotY;
    add(mesh);
  }
  // Occluders are the bed skirt: cloth the cat walks through, hung in folds.
  const folds = tex.pleats();
  folds.repeat.set(GRAIN_TILE / 0.45, GRAIN_TILE / 0.26); // UVs are in grain tiles: a fold every ~6 cm, one drop per height
  const skirt = new THREE.MeshStandardMaterial({ color: P.skirt, map: folds, roughness: 0.95 });
  for (const s of OCCLUDERS) {
    const mesh = new THREE.Mesh(roundedBox(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2, 0.002), skirt);
    mesh.position.set(...s.center);
    add(mesh);
  }

  // ---------------------------------------------------------- baseboards
  const base = mats.wood(P.baseboard, 0.7);
  const bbW = new THREE.Mesh(roundedBox(0.025, 0.1, D, 0.006), base);
  bbW.position.set(ROOM.minX + 0.0125, 0.05, (ROOM.minZ + ROOM.maxZ) / 2);
  const bbN = new THREE.Mesh(roundedBox(W, 0.1, 0.025, 0.006), base);
  bbN.position.set((ROOM.minX + ROOM.maxX) / 2, 0.05, ROOM.minZ + 0.0125);
  add(bbW, false);
  add(bbN, false);

  // ------------------------------------------- contact and crease shadows
  // Laid over whatever is underneath: the soft darkening where things meet,
  // which is most of what makes the reference feel painted.
  const decal = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  const blob = decal(tex.softShadow({ strength: 0.42 }));
  const crease = decal(tex.creaseShadow({ strength: 0.4 }));
  let lift = 0.0015;
  const flat = (w, d, x, z, mat, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.userData.noAO = true;
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y ?? (lift += 0.0004), z);
    m.renderOrder = 2;
    group.add(m);
    return m;
  };
  // Along the two walls (v = 0 is the dark edge; the plane's local +y maps to -z after the tilt).
  const cn = flat(W, 0.7, 0, ROOM.minZ + 0.35, crease);
  cn.rotation.z = Math.PI; // dark edge against the north wall
  const cw = flat(D, 0.7, ROOM.minX + 0.35, 0, crease);
  cw.rotation.z = -Math.PI / 2; // dark edge against the west wall
  // Up the corner where the two walls meet.
  for (const west of [true, false]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.wallHeight, 0.55), crease);
    m.rotation.z = Math.PI / 2; // v runs away from the corner
    if (west) { m.rotation.set(0, Math.PI / 2, Math.PI / 2, 'YXZ'); m.position.set(ROOM.minX + 0.002, ROOM.wallHeight / 2, ROOM.minZ + 0.275); }
    else m.position.set(ROOM.minX + 0.275, ROOM.wallHeight / 2, ROOM.minZ + 0.002);
    m.userData.noAO = true;
    m.renderOrder = 2;
    group.add(m);
  }
  // Under the furniture that stands on, or hangs low over, the floor.
  const under = (ids, pad = 0.35) => {
    const boxes = ids.map(spec).filter(Boolean);
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.center[0] - b.half[0])), maxX = Math.max(...boxes.map((b) => b.center[0] + b.half[0]));
    const minZ = Math.min(...boxes.map((b) => b.center[2] - b.half[2])), maxZ = Math.max(...boxes.map((b) => b.center[2] + b.half[2]));
    flat(maxX - minX + pad, maxZ - minZ + pad, (minX + maxX) / 2, (minZ + maxZ) / 2, blob);
  };
  under(['bedPlatform'], 0.5);
  under(['nightstand']);
  under(['deskTop'], 0.3);
  under(['bookshelfPanel0']);
  under(['couchBack', 'couchSeat', 'couchArmNorth', 'couchArmSouth'], 0.4);
  under(['coffeeTableTop'], 0.3);
  under(['aquariumCabinet']);
  under(['chairBase'], 0.25);
  under(['catTreeBase']);

  // ----------------------------------------------------------------- rugs
  const rug = (texture, w, d, x, z, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, transparent: true, alphaTest: 0.5 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.renderOrder = 3;
    group.add(m);
    return m;
  };
  // The big rug lies under the coffee table and runs up to the couch; the patchwork one beside it.
  rug(tex.shagRug({ aspect: 3.4 / 2.2 }), 3.4, 2.2, -0.95, 1.85, 0.006);
  rug(tex.patchworkRug(), 2.5, 1.7, 2.05, 1.95, 0.009);

  // --------------------------------------------------------------- window
  // Above A's window sill, on the north wall.
  const sill = spec('windowSill');
  const windowParts = new THREE.Group();
  let glass = null, shaft = null;
  if (sill) {
    const cx = sill.center[0], wz = ROOM.minZ;
    const ww = sill.half[0] * 2 + 0.06, wh = 0.92, bottom = SURFACES.windowSillTop + 0.02;
    const frame = mats.wood(P.windowFrame, 0.55);
    glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: tex.windowView({ night: false }) }));
    glass.position.set(cx, bottom + wh / 2, wz + 0.006);
    windowParts.add(glass);
    const bar = (w, h, x, y, depth = 0.05) => {
      const m = shadowed(new THREE.Mesh(roundedBox(w, h, depth, 0.008), frame));
      m.position.set(x, y, wz + depth / 2);
      windowParts.add(m);
    };
    bar(ww + 0.1, 0.06, cx, bottom + wh + 0.01);            // head
    bar(ww + 0.1, 0.05, cx, bottom - 0.005);                 // foot
    bar(0.06, wh + 0.06, cx - ww / 2 - 0.02, bottom + wh / 2); // jambs
    bar(0.06, wh + 0.06, cx + ww / 2 + 0.02, bottom + wh / 2);
    bar(0.03, wh, cx, bottom + wh / 2, 0.03);                // mullions
    bar(ww, 0.03, cx, bottom + wh * 0.48, 0.03);
    // Blinds, half drawn.
    const slat = mats.plain(P.blinds, 0.6);
    for (let i = 0; i < 6; i++) {
      const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(ww - 0.02, 0.045, 0.012), slat));
      m.position.set(cx, bottom + wh - 0.04 - i * 0.052, wz + 0.045);
      m.rotation.x = 0.5;
      windowParts.add(m);
    }
    // Moonlight falling into the room: only shown at night.
    const shaftGeo = new THREE.BufferGeometry();
    const top = bottom + wh, reach = 2.6;
    shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx - ww / 2, top, wz + 0.05, cx + ww / 2, top, wz + 0.05, cx + ww / 2 - 0.5, 0.01, wz + reach,
      cx - ww / 2, top, wz + 0.05, cx + ww / 2 - 0.5, 0.01, wz + reach, cx - ww / 2 - 0.9, 0.01, wz + reach - 0.3,
    ], 3));
    shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    shaft.visible = false;
    shaft.userData.noAO = true;
    shaft.renderOrder = 6;
    windowParts.add(shaft);
  }
  group.add(windowParts);

  // ------------------------------------------------------------- pictures
  // `wall` picks the wall; `along` runs along it, `y` is the centre height.
  const picture = (kind, wall, along, y, w, h) => {
    const g = new THREE.Group();
    g.add(shadowed(new THREE.Mesh(roundedBox(w + 0.06, h + 0.06, 0.03, 0.008), mats.wood(P.frame))));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex.picture(kind), roughness: 0.85 }));
    art.position.z = 0.0155;
    g.add(art);
    if (wall === 'north') g.position.set(along, y, ROOM.minZ + 0.016);
    else { g.position.set(ROOM.minX + 0.016, y, along); g.rotation.y = Math.PI / 2; }
    group.add(g);
  };
  picture('leaves', 'north', -2.3, 1.74, 0.5, 0.64); // above the aquarium
  picture('note', 'north', -1.5, 1.6, 0.26, 0.34);
  picture('map', 'north', 0.35, 1.8, 0.7, 0.48);
  picture('sun', 'west', 0.25, 1.7, 0.62, 0.52);

  // -------------------------------------------- drawers, brackets, bedding
  const knobMat = mats.plain(P.brass, 0.35, 0.7);
  const drawers = (id, face, count) => {
    const b = spec(id);
    if (!b) return;
    const front = mats.wood(tex.shade(styleFor(b).color, 0.1));
    const gap = 0.03, total = b.half[1] * 2 - 0.08, each = (total - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const y = b.center[1] - b.half[1] + 0.05 + each / 2 + i * (each + gap);
      const span = (face === 'x' ? b.half[2] : b.half[0]) * 2 - 0.07;
      const panel = shadowed(new THREE.Mesh(face === 'x' ? roundedBox(0.016, each, span, 0.006) : roundedBox(span, each, 0.016, 0.006), front), false);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), knobMat);
      if (face === 'x') {
        panel.position.set(b.center[0] + b.half[0] + 0.006, y, b.center[2]);
        knob.position.set(b.center[0] + b.half[0] + 0.024, y, b.center[2]);
      } else {
        panel.position.set(b.center[0], y, b.center[2] + b.half[2] + 0.006);
        knob.position.set(b.center[0], y, b.center[2] + b.half[2] + 0.024);
      }
      group.add(panel, knob);
    }
  };
  drawers('nightstand', 'x', 2);
  drawers('deskPedestal', 'z', 3);

  const ws = spec('wallShelf');
  if (ws) {
    for (const dz of [-0.32, 0.32]) {
      const br = shadowed(new THREE.Mesh(roundedBox(ws.half[0] * 1.6, 0.03, 0.03, 0.006), mats.wood(P.shelfBack)));
      br.position.set(ws.center[0] - ws.half[0] * 0.2, ws.center[1] - ws.half[1] - 0.015, ws.center[2] + dz);
      group.add(br);
    }
  }

  const mattress = spec('bedMattress');
  if (mattress) {
    const [mx, my, mz] = mattress.center, [hx, hy, hz] = mattress.half;
    // The blanket covers the foot two thirds of the bed and hangs a little over its sides.
    const len = hx * 2 * 0.68;
    const blanketMat = new THREE.MeshStandardMaterial({ map: tex.blanket(), bumpMap: tex.wrinkles(), bumpScale: 5, roughness: 0.95 });
    blanketMat.userData.env = 0.2;
    const blanketGeo = new RoundedBoxGeometry(len, hy * 2 * 0.7, hz * 2 + 0.07, 3, 0.04);
    // The stripes run across the bed, so each end of the blanket is one colour:
    // pin the two end faces (+x, -x) to the texture's own ends.
    const buv = blanketGeo.attributes.uv, perSide = buv.count / 6;
    for (let k = 0; k < 2 * perSide; k++) buv.setX(k, k < perSide ? 0.995 : 0.005);
    const blanket = shadowed(new THREE.Mesh(blanketGeo, blanketMat));
    blanket.position.set(mx + hx - len / 2 + 0.02, my + hy - hy * 0.7 + 0.014, mz);
    group.add(blanket);
    const fold = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.035, hz * 2 + 0.075, 3, 0.017), mats.cloth(PALETTE.sheet)));
    fold.position.set(mx + hx - len + 0.06, my + hy + 0.012, mz);
    group.add(fold);
  }

  mergeStatic(group);

  return {
    group,
    materials: mats,
    /** Move what moves by itself (the fish). `t` in seconds. */
    update(t) {
      for (const fn of ctx.animate) fn(t);
    },
    /** Swap what the window shows and whether moonlight falls in. */
    setNight(night) {
      if (glass) {
        glass.material.map.dispose();
        glass.material.map = tex.windowView({ night });
        glass.material.needsUpdate = true;
      }
      if (shaft) shaft.visible = night;
      // The aquarium counts for more once the room is dark.
      for (const l of ctx.lights) {
        l.light.intensity = night ? 2.4 : 1.1;
        l.glow.material.opacity = night ? 0.42 : 0.22;
      }
    },
  };
}
