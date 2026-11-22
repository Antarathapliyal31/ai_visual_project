// The room, drawn from a level's pieces (src/levels).
//
// The shell (the floor, the two walls the camera sees, baseboards and the
// creases where they meet) is the same in every level. Each piece of
// furniture is drawn where it stands in the original room, from its
// canonical boxes in the inventory, inside a group that moves and turns it
// to where the level puts it: the same transform (piece.T) that placed its
// colliders. So the original room is drawn exactly as before, and a desk on
// the west wall is the same desk, turned.
//
// Every solid becomes a mesh styled by its id (falling back to its material
// name, so furniture added later still gets wood or cloth). On top of that
// comes dressing that needs no collider: rugs, the window, pictures, drawer
// fronts, the blanket, tape on the boxes, and soft contact shadows.
//
// Nothing here is physical. If it should stop the cat, it belongs in the
// colliders (src/collision/staticGeometry.js, src/levels/inventory.js).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STATIC_BOXES, ROOM, SURFACES } from '../../src/collision/index.js';
import { SHELL_IDS } from '../../src/levels/inventory.js';
import { ORIGINAL, compileLevel } from '../../src/levels/index.js';
import { pictureSpots, rugSpots } from '../../src/levels/decor.js';
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
  // The pieces that came with the levels.
  tableTop: 0x8a5a32, tablecloth: 0xe6d8bd,
  armchair: 0x6f8a62, armchairLeg: 0x4a2e18,
  cardboard: 0xb98b57, tape: 0xd9c38f,
  wardrobe: 0x8a5530, wardrobeDoor: 0x9a6239,
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
  if (id.startsWith('diningTable')) return { type: 'wood', color: P.tableTop, radius: 0.01 };
  if (id.startsWith('armchairLeg')) return { type: 'wood', color: P.armchairLeg, radius: 0.008 };
  if (id.startsWith('armchair')) return { type: 'cloth', color: P.armchair, radius: 0.045 };
  if (id.startsWith('box')) return { type: 'plain', color: P.cardboard, radius: 0.004 };
  if (id.startsWith('wardrobe')) return { type: 'wood', color: P.wardrobe, radius: 0.012 };
  // Furniture this file has never heard of: dress it by its material.
  if (spec.material === 'fabric') return { type: 'cloth', color: P.cloth, radius: 0.04 };
  return { type: 'wood', color: P.wood, radius: 0.01 };
}

const shadowed = (mesh, cast = true) => {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
};

// Soft shadows under each kind of piece: which of its boxes, and how far past them.
const UNDER = [
  ['bed', ['bedPlatform'], 0.5], ['nightstand', ['nightstand']], ['desk', ['deskTop'], 0.3], ['bookshelf', ['bookshelfPanel0']],
  ['couch', ['couchBack', 'couchSeat', 'couchArmNorth', 'couchArmSouth'], 0.4], ['coffeeTable', ['coffeeTableTop'], 0.3],
  ['aquarium', ['aquariumCabinet']], ['chair', ['chairBase'], 0.25], ['catTree', ['catTreeBase']],
  ['diningTable', ['diningTableTop'], 0.35], ['armchair', ['armchairSeat', 'armchairBack', 'armchairArmL', 'armchairArmR'], 0.3],
  ['cardboardBox', ['boxTop'], 0.22], ['boxStack', ['boxStackLow'], 0.25], ['wardrobe', ['wardrobeBody'], 0.3],
];

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

let originalPieces = null;

/**
 * @param {object} [opts]
 * @param {number} [opts.maxAnisotropy]
 * @param {object} [opts.level]  a loadLevel() result (src/levels); left out, the original room
 * @param {ReturnType<typeof createMaterials>} [opts.materials]  another room's materials, to
 *   share them (and the props' look, which uses them) when the level changes
 * @returns {{group: THREE.Group, materials: object, update: (t: number) => void, setNight: (night: boolean) => void}}
 */
export function buildRoom(opts = {}) {
  const mats = opts.materials ?? createMaterials(opts.maxAnisotropy);
  const level = opts.level ?? null;
  const pieces = level?.pieces ?? (originalPieces ??= compileLevel(ORIGINAL).pieces);
  const original = !level || level.legacy;
  const group = new THREE.Group();
  // What the furniture builders share: materials, per-frame callbacks, and lights that follow the mood.
  const ctx = { mats, animate: [], lights: [] };
  const P = PALETTE;
  const add = (mesh, cast = true, parent = group) => parent.add(shadowed(mesh, cast));
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ;
  const boxOf = (piece, id) => piece.item.boxes.find((b) => b.id === id);
  const ofItem = (id) => pieces.filter((p) => p.item.id === id);

  // ------------------------------------------------------------ the shell
  for (const s of STATIC_BOXES) {
    if (!SHELL_IDS.includes(s.id) || s.visible === false) continue;
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
    } else if (s.id === 'wallWest' || s.id === 'wallNorth') {
      const paint = new THREE.MeshStandardMaterial({ map: tex.plaster({ seed: s.id.length, color: P.wall }), roughness: 0.95 });
      const cut = mats.plain(P.wallCut, 0.9), back = mats.plain(0x6f6b5e, 0.95);
      // Inner face: +x for the west wall, +z for the north wall.
      const faces = s.id === 'wallWest' ? [paint, back, cut, back, cut, cut] : [cut, cut, cut, back, paint, back];
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faces);
      mesh.position.set(...s.center);
      add(mesh, false);
    }
  }

  // ----------------------------------------------------------- the pieces
  // Hanging cloth the cat walks through (occluders), in folds.
  const folds = tex.pleats();
  folds.repeat.set(GRAIN_TILE / 0.45, GRAIN_TILE / 0.26); // UVs are in grain tiles: a fold every ~6 cm, one drop per height
  const hangings = { skirt: new THREE.MeshStandardMaterial({ color: P.skirt, map: folds, roughness: 0.95 }) };
  const hangingFor = (id) => {
    if (id.startsWith('diningCloth')) return (hangings.cloth ??= new THREE.MeshStandardMaterial({ color: P.tablecloth, map: folds, roughness: 0.95 }));
    if (id.startsWith('armchairSkirt')) return (hangings.armchair ??= new THREE.MeshStandardMaterial({ color: P.armchair, map: folds, roughness: 0.95 }));
    return hangings.skirt;
  };
  const meshOf = (s) => {
    const [w, h, d] = s.half.map((v) => v * 2);
    const st = styleFor(s);
    const mat = st.type === 'cloth' ? mats.cloth(st.color) : st.type === 'plain' ? mats.plain(st.color, 0.92) : mats.wood(st.color);
    const mesh = new THREE.Mesh(roundedBox(w, h, d, st.radius), mat);
    mesh.position.set(...s.center);
    if (s.rotY) mesh.rotation.y = s.rotY;
    return mesh;
  };
  // Each piece is built in its canonical place, in `inner`; `outer` moves and turns it.
  const frames = new Map();
  for (const piece of pieces) {
    const { item, T } = piece;
    const outer = new THREE.Group(), inner = new THREE.Group();
    outer.position.set(T.to.x, 0, T.to.z);
    outer.rotation.y = T.yaw;
    inner.position.set(-T.from.x, 0, -T.from.z);
    outer.add(inner);
    group.add(outer);
    frames.set(piece, inner);
    for (const s of item.boxes) {
      if (s.visible === false) continue;
      if (FURNITURE[s.id]) inner.add(FURNITURE[s.id](s, ctx));
      else add(meshOf(s), true, inner);
    }
    for (const s of item.occluders) {
      const mesh = new THREE.Mesh(roundedBox(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2, 0.002), hangingFor(s.id));
      mesh.position.set(...s.center);
      add(mesh, true, inner);
    }
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
  const flat = (w, d, x, z, mat, y, parent = group) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.userData.noAO = true;
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y ?? (lift += 0.0004), z);
    m.renderOrder = 2;
    parent.add(m);
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
  // Under the furniture that stands on, or hangs low over, the floor (in each piece's own frame).
  const under = (piece, ids, pad = 0.35) => {
    const boxes = ids.map((id) => boxOf(piece, id)).filter(Boolean);
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.center[0] - b.half[0])), maxX = Math.max(...boxes.map((b) => b.center[0] + b.half[0]));
    const minZ = Math.min(...boxes.map((b) => b.center[2] - b.half[2])), maxZ = Math.max(...boxes.map((b) => b.center[2] + b.half[2]));
    flat(maxX - minX + pad, maxZ - minZ + pad, (minX + maxX) / 2, (minZ + maxZ) / 2, blob, undefined, frames.get(piece));
  };
  for (const [itemId, ids, pad] of UNDER) for (const piece of ofItem(itemId)) under(piece, ids, pad);

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
  if (original) {
    // The big rug lies under the coffee table and runs up to the couch; the patchwork one beside it.
    rug(tex.shagRug({ aspect: 3.4 / 2.2 }), 3.4, 2.2, -0.95, 1.85, 0.006);
    rug(tex.patchworkRug(), 2.5, 1.7, 2.05, 1.95, 0.009);
  } else {
    // The shag rug under the coffee table (or the dining table), the patchwork one where he gets out of bed.
    for (const r of rugSpots(level)) {
      if (r.kind === 'shag') rug(tex.shagRug({ aspect: r.w / r.d }), r.w, r.d, r.x, r.z, 0.006);
      else rug(tex.patchworkRug(r.alongZ ? { cols: 4, rows: 6 } : {}), r.w, r.d, r.x, r.z, 0.009);
    }
  }

  // --------------------------------------------------------------- window
  // Above the window sill, in the wall behind it (the north wall where the sill stands canonically).
  const windows = [];
  for (const piece of ofItem('windowSill')) {
    const sill = boxOf(piece, 'windowSill');
    const windowParts = new THREE.Group();
    const cx = sill.center[0], wz = ROOM.minZ;
    const ww = sill.half[0] * 2 + 0.06, wh = 0.92, bottom = SURFACES.windowSillTop + 0.02;
    const frame = mats.wood(P.windowFrame, 0.55);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: tex.windowView({ night: false }) }));
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
    const shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    shaft.visible = false;
    shaft.userData.noAO = true;
    shaft.renderOrder = 6;
    windowParts.add(shaft);
    frames.get(piece).add(windowParts);
    windows.push({ glass, shaft });
  }

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
  if (original) {
    picture('leaves', 'north', -2.3, 1.74, 0.5, 0.64); // above the aquarium
    picture('note', 'north', -1.5, 1.6, 0.26, 0.34);
    picture('map', 'north', 0.35, 1.8, 0.7, 0.48);
    picture('sun', 'west', 0.25, 1.7, 0.62, 0.52);
  } else {
    for (const p of pictureSpots(pieces)) picture(p.kind, p.wall, p.along, p.y, p.w, p.h);
  }

  // --------------------------------- drawers, brackets, bedding, the rest
  const knobMat = mats.plain(P.brass, 0.35, 0.7);
  const drawers = (piece, id, face, count) => {
    const b = boxOf(piece, id);
    if (!b) return;
    const parent = frames.get(piece);
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
      parent.add(panel, knob);
    }
  };
  for (const piece of ofItem('nightstand')) drawers(piece, 'nightstand', 'x', 2);
  for (const piece of ofItem('desk')) drawers(piece, 'deskPedestal', 'z', 3);

  for (const piece of ofItem('wallShelf')) {
    const ws = boxOf(piece, 'wallShelf');
    for (const dz of [-0.32, 0.32]) {
      const br = shadowed(new THREE.Mesh(roundedBox(ws.half[0] * 1.6, 0.03, 0.03, 0.006), mats.wood(P.shelfBack)));
      br.position.set(ws.center[0] - ws.half[0] * 0.2, ws.center[1] - ws.half[1] - 0.015, ws.center[2] + dz);
      frames.get(piece).add(br);
    }
  }

  for (const piece of ofItem('bed')) {
    const mattress = boxOf(piece, 'bedMattress');
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
    const fold = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.035, hz * 2 + 0.075, 3, 0.017), mats.cloth(PALETTE.sheet)));
    fold.position.set(mx + hx - len + 0.06, my + hy + 0.012, mz);
    frames.get(piece).add(blanket, fold);
  }

  // The tablecloth's top, over the table top (its sides are the occluders).
  for (const piece of ofItem('diningTable')) {
    const t = boxOf(piece, 'diningTableTop');
    const cloth = shadowed(new THREE.Mesh(roundedBox(t.half[0] * 2 + 0.04, 0.008, t.half[2] * 2 + 0.04, 0.003), mats.cloth(P.tablecloth)));
    cloth.position.set(t.center[0], t.center[1] + t.half[1] - 0.003, t.center[2]);
    frames.get(piece).add(cloth);
  }

  // Packing tape over the boxes.
  const tape = mats.plain(P.tape, 0.45);
  const strip = (parent, w, h, d, x, y, z) => {
    const m = shadowed(new THREE.Mesh(roundedBox(w, h, d, 0.001), tape), false);
    m.position.set(x, y, z);
    parent.add(m);
  };
  for (const piece of ofItem('cardboardBox')) {
    const top = boxOf(piece, 'boxTop');
    strip(frames.get(piece), 0.06, 0.003, top.half[2] * 2, top.center[0], top.center[1] + top.half[1] + 0.0015, top.center[2]);
  }
  for (const piece of ofItem('boxStack')) {
    const low = boxOf(piece, 'boxStackLow'), high = boxOf(piece, 'boxStackHigh');
    strip(frames.get(piece), 0.06, 0.003, high.half[2] * 2, high.center[0], high.center[1] + high.half[1] + 0.0015, high.center[2]);
    strip(frames.get(piece), 0.06, low.half[1] * 2 - 0.02, 0.003, low.center[0], low.center[1], low.center[2] + low.half[2] + 0.0015);
  }

  // The wardrobe's two doors, their knobs, and a cornice.
  for (const piece of ofItem('wardrobe')) {
    const b = boxOf(piece, 'wardrobeBody');
    const parent = frames.get(piece);
    const front = b.center[2] + b.half[2];
    const door = mats.wood(P.wardrobeDoor);
    for (const side of [-1, 1]) {
      const panel = shadowed(new THREE.Mesh(roundedBox(b.half[0] - 0.03, b.half[1] * 2 - 0.14, 0.016, 0.006), door), false);
      panel.position.set(b.center[0] + side * (b.half[0] / 2 + 0.005), b.center[1] + 0.02, front + 0.008);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), knobMat);
      knob.position.set(b.center[0] + side * 0.05, b.center[1] + 0.05, front + 0.028);
      parent.add(panel, knob);
    }
    const cornice = shadowed(new THREE.Mesh(roundedBox(b.half[0] * 2 + 0.06, 0.05, b.half[2] * 2 + 0.04, 0.01), mats.wood(tex.shade(P.wardrobe, -0.1))));
    cornice.position.set(b.center[0], b.center[1] + b.half[1] + 0.025, b.center[2] + 0.02);
    parent.add(cornice);
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
      for (const { glass, shaft } of windows) {
        glass.material.map.dispose();
        glass.material.map = tex.windowView({ night });
        glass.material.needsUpdate = true;
        shaft.visible = night;
      }
      // The aquarium counts for more once the room is dark.
      for (const l of ctx.lights) {
        l.light.intensity = night ? 2.4 : 1.1;
        l.glow.material.opacity = night ? 0.42 : 0.22;
      }
    },
  };
}
