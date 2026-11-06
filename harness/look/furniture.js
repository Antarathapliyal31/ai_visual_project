// Furniture that is more than a wooden box: the couch, the coffee table, the
// aquarium, the desk chair and the cat tree.
//
// Each builder takes one of A's static boxes and returns what to draw in its
// place, already positioned. The drawing stays within a few centimetres of
// the collider, so what you see is what the cat bumps into. A builder may
// push a function onto ctx.animate to be called every frame with the time.

import * as THREE from 'three';
import { roundedBox } from './materials.js';
import * as tex from './textures.js';

const LEATHER = 0x8c4b25, LEATHER_DARK = 0x6f3a1c;
const WALNUT = 0x7c4524, CABINET = 0x6b3d1f;
const CHAIR_CLOTH = 0x3d4350, CHAIR_FRAME = 0x23252b;
const CARPET = 0xd9c8a2, SISAL = 0xc9a468;

const shadowed = (o) => {
  o.traverse((m) => {
    if (m.isMesh && !m.material.transparent && !m.material.isMeshBasicMaterial) m.castShadow = m.receiveShadow = true;
  });
  return o;
};

/** A group at a static box's centre, turned with it. `build(group, w, h, d)` fills it in the box's own frame. */
function placed(s, build) {
  const g = new THREE.Group();
  g.position.set(...s.center);
  if (s.rotY) g.rotation.y = s.rotY;
  build(g, s.half[0] * 2, s.half[1] * 2, s.half[2] * 2);
  return shadowed(g);
}

const box = (w, h, d, mat, x = 0, y = 0, z = 0, radius = 0.012) => {
  const m = new THREE.Mesh(roundedBox(w, h, d, radius), mat);
  m.position.set(x, y, z);
  return m;
};

// ------------------------------------------------------------------ couch

function couchSeat(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    const leather = mats.leather(LEATHER);
    const cushion = 0.16;
    g.add(box(w, h - cushion, d, mats.leather(LEATHER_DARK), 0, -cushion / 2, 0, 0.03));
    // Two seat cushions, plump, a finger's width apart.
    for (const side of [-1, 1]) g.add(box(w + 0.02, cushion, d / 2 - 0.012, leather, 0.012, h / 2 - cushion / 2 + 0.004, side * d / 4, 0.055));
    // Feet.
    for (const [fx, fz] of [[1, 1], [1, -1]]) g.add(box(0.05, 0.03, 0.05, mats.plain(0x2a1a10, 0.6), fx * (w / 2 - 0.05), -h / 2 + 0.014, fz * (d / 2 - 0.06), 0.006));
  });
}

function couchBack(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h, d, mats.leather(LEATHER_DARK), 0, 0, 0, 0.05));
    // Back cushions lean out over the seat.
    const seatTop = 0.42 - s.center[1];
    for (const side of [-1, 1]) {
      const c = box(0.16, h / 2 - 0.03, d / 2 - 0.14, mats.leather(LEATHER), w / 2 + 0.02, seatTop + (h / 2 - 0.03) / 2 + 0.01, side * (d / 4 - 0.06), 0.06);
      c.rotation.z = 0.16;
      g.add(c);
    }
  });
}

function couchArm(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h - 0.05, d, mats.leather(LEATHER_DARK), 0, -0.025, 0, 0.05));
    g.add(box(w + 0.02, 0.1, d + 0.03, mats.leather(LEATHER), 0.008, h / 2 - 0.05, 0, 0.05)); // the padded roll on top
  });
}

// ----------------------------------------------------------- coffee table

function coffeeTableTop(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h, d, mats.wood(WALNUT, 0.42), 0, 0, 0, 0.012));
    // An apron under the top, set in from the edge.
    for (const side of [-1, 1]) {
      g.add(box(w - 0.1, 0.05, 0.02, mats.wood(WALNUT), 0, -h / 2 - 0.025, side * (d / 2 - 0.045), 0.005));
      g.add(box(0.02, 0.05, d - 0.1, mats.wood(WALNUT), side * (w / 2 - 0.045), -h / 2 - 0.025, 0, 0.005));
    }
  });
}

const coffeeTablePart = (s, { mats }) => placed(s, (g, w, h, d) => g.add(box(w, h, d, mats.wood(WALNUT, 0.5), 0, 0, 0, 0.008)));

// --------------------------------------------------------------- aquarium

function aquariumCabinet(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h, d, mats.wood(CABINET), 0, 0, 0, 0.015));
    g.add(box(w + 0.02, 0.03, d + 0.02, mats.wood(WALNUT, 0.45), 0, h / 2 - 0.015, 0, 0.01)); // top board
    const knob = mats.plain(0xc9ccd4, 0.3, 0.8);
    for (const side of [-1, 1]) {
      g.add(box(w / 2 - 0.035, h - 0.13, 0.016, mats.wood(0x7a4726), side * (w / 4 - 0.004), -0.02, d / 2 + 0.005, 0.008)); // doors
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 10), knob);
      pull.position.set(side * 0.03, 0.02, d / 2 + 0.022);
      g.add(pull);
    }
  });
}

function aquariumTank(s, ctx) {
  const { mats } = ctx;
  return placed(s, (g, w, h, d) => {
    const trim = mats.plain(0x1f2329, 0.5, 0.2);
    // Dark trim round the bottom and top; the glass stands between.
    for (const y of [-h / 2 + 0.012, h / 2 - 0.012]) g.add(box(w, 0.024, d, trim, 0, y, 0, 0.006));

    // Inside: a lit backdrop on the far and side walls, gravel on the floor.
    const inside = new THREE.MeshBasicMaterial({ map: tex.water(), side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, h - 0.04), inside);
    back.position.z = -d / 2 + 0.006;
    g.add(back);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(d - 0.012, h - 0.04), inside);
      wall.rotation.y = -side * Math.PI / 2;
      wall.position.x = side * (w / 2 - 0.006);
      g.add(wall);
    }
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, d - 0.012), new THREE.MeshBasicMaterial({ map: tex.gravel() }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -h / 2 + 0.03;
    g.add(bed);

    // Rocks and weed. Unlit, so they glow like everything else in the tank.
    const rand = tex.mulberry32(77);
    const weeds = [];
    for (let i = 0; i < 9; i++) {
      const tall = 0.12 + rand() * 0.22;
      const blade = new THREE.PlaneGeometry(0.03 + rand() * 0.02, tall, 1, 6);
      blade.translate(0, tall / 2, 0);
      const weed = new THREE.Mesh(blade, new THREE.MeshBasicMaterial({ color: [0x2f9a4a, 0x4fbf5a, 0x1f7a3c, 0x7fcf5a][i % 4], side: THREE.DoubleSide }));
      weed.position.set((rand() - 0.5) * (w - 0.12), -h / 2 + 0.03, (rand() - 0.5) * (d - 0.14) - 0.02);
      weed.rotation.y = rand() * 3;
      weed.userData.dynamic = true; // it sways
      g.add(weed);
      weeds.push({ weed, tall, phase: rand() * 6 });
    }
    for (let i = 0; i < 4; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03 + rand() * 0.035, 0), new THREE.MeshBasicMaterial({ color: [0x6f7a86, 0x8a8f96, 0x5a6470][i % 3] }));
      rock.position.set((rand() - 0.5) * (w - 0.16), -h / 2 + 0.045, (rand() - 0.5) * (d - 0.16));
      rock.scale.y = 0.7;
      g.add(rock);
    }

    // Fish: each patrols its own lane and turns at the glass.
    const fish = [];
    const colours = [0xff8a2a, 0xffd23a, 0xf2542d, 0x4fa8ff, 0xff8a2a, 0xf6f1e4, 0xff5fa2];
    colours.forEach((colour, i) => {
      const f = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: colour });
      const size = 0.022 + rand() * 0.016;
      const body = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), mat);
      body.scale.set(1.5, 0.8, 0.45);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(size * 0.75, size * 1.1, 4), mat);
      tail.rotation.z = -Math.PI / 2;
      tail.scale.z = 0.25;
      tail.position.x = -size * 1.8;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(size * 0.16, 6, 4), new THREE.MeshBasicMaterial({ color: 0x101010 }));
      eye.position.set(size * 0.9, size * 0.2, size * 0.4);
      f.add(body, tail, eye);
      f.userData.dynamic = true; // it swims
      g.add(f);
      fish.push({ f, tail, y: -h / 2 + 0.09 + rand() * (h - 0.2), z: (rand() - 0.5) * (d - 0.12), reach: (w / 2 - 0.09) * (0.55 + rand() * 0.45), speed: 0.25 + rand() * 0.3, phase: rand() * 6.28, offset: (rand() - 0.5) * 0.1 });
    });

    // Bubbles rising from one corner.
    const bubbles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xeaffff, size: 0.012, transparent: true, opacity: 0.8 }));
    const count = 9, bubblePos = new Float32Array(count * 3);
    bubbles.geometry.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
    g.add(bubbles);

    // The water's surface, and the glass itself: mostly reflection.
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, d - 0.012), new THREE.MeshBasicMaterial({ color: 0xc8f6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = h / 2 - 0.045;
    g.add(surface);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.14, roughness: 0.04, clearcoat: 1, depthWrite: false });
    glass.userData.env = 1.6;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.004, h - 0.03), glass);
    front.position.z = d / 2 - 0.002;
    front.renderOrder = 5;
    g.add(front);
    for (const side of [-1, 1]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(d - 0.004, h - 0.03), glass);
      pane.rotation.y = side * Math.PI / 2;
      pane.position.x = side * (w / 2 - 0.002);
      pane.renderOrder = 5;
      g.add(pane);
    }

    // It lights the wall behind it and the floor in front.
    const light = new THREE.PointLight(0x7fdcff, 1.1, 3.2, 1.7);
    light.position.set(0, 0.05, d / 2 + 0.3);
    g.add(light);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow({ color: '120,220,255' }), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 }));
    glow.scale.set(w * 1.5, h * 2.2, 1);
    glow.position.z = d / 2 + 0.02;
    glow.renderOrder = 7;
    g.add(glow);
    ctx.lights.push({ light, glow, kind: 'aquarium' });

    ctx.animate.push((t) => {
      for (const o of fish) {
        const a = t * o.speed + o.phase;
        o.f.position.set(Math.sin(a) * o.reach + o.offset, o.y + Math.sin(a * 2.3) * 0.012, o.z);
        o.f.rotation.y = Math.cos(a) >= 0 ? 0 : Math.PI; // nose first
        o.tail.rotation.y = Math.sin(t * 9 + o.phase) * 0.5;
      }
      for (const o of weeds) o.weed.rotation.z = Math.sin(t * 1.1 + o.phase) * 0.12;
      for (let i = 0; i < count; i++) {
        const rise = ((t * 0.12 + i / count) % 1);
        bubblePos[i * 3] = -w / 2 + 0.08 + Math.sin(t * 2 + i) * 0.008;
        bubblePos[i * 3 + 1] = -h / 2 + 0.05 + rise * (h - 0.11);
        bubblePos[i * 3 + 2] = d / 2 - 0.08;
      }
      bubbles.geometry.attributes.position.needsUpdate = true;
    });
  });
}

const aquariumLid = (s, { mats }) => placed(s, (g, w, h, d) => {
  g.add(box(w, h, d, mats.plain(0x1f2329, 0.45, 0.2), 0, 0, 0, 0.008));
  g.add(box(w * 0.5, 0.008, d * 0.5, mats.plain(0x2c3138, 0.4, 0.2), 0, h / 2 + 0.003, 0, 0.003)); // the feeding hatch
});

// ------------------------------------------------------------------ chair

function chairBase(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    const frame = mats.plain(CHAIR_FRAME, 0.4, 0.5);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.05, 16), frame));
    // Five spokes, a caster at the end of each.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const spoke = box(w / 2 - 0.02, 0.026, 0.04, frame, 0, 0.004, 0, 0.01);
      spoke.position.set(Math.cos(a) * (w / 4 - 0.01), 0.004, Math.sin(a) * (w / 4 - 0.01));
      spoke.rotation.y = -a;
      const caster = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), mats.plain(0x15161a, 0.5));
      caster.position.set(Math.cos(a) * (w / 2 - 0.03), -h / 2 + 0.024, Math.sin(a) * (w / 2 - 0.03));
      g.add(spoke, caster);
    }
  });
}

const chairPost = (s, { mats }) => placed(s, (g, w, h) => {
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 14), mats.plain(0xb8bcc4, 0.25, 0.9));
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, h * 0.55, 14), mats.plain(CHAIR_FRAME, 0.4, 0.5));
  sleeve.position.y = -h * 0.225;
  g.add(lift, sleeve);
});

const chairSeat = (s, { mats }) => placed(s, (g, w, h, d) => {
  g.add(box(w, h, d, mats.cloth(CHAIR_CLOTH), 0, 0.006, 0, 0.035));
  g.add(box(w - 0.06, 0.02, d - 0.06, mats.plain(CHAIR_FRAME, 0.5, 0.3), 0, -h / 2 + 0.004, 0, 0.008)); // the pan underneath
});

const chairBack = (s, { mats }) => placed(s, (g, w, h, d) => {
  g.add(box(w, h, d + 0.02, mats.cloth(CHAIR_CLOTH), 0, 0, 0, 0.03));
  // The bar that carries the back, curving down under the seat.
  const frame = mats.plain(CHAIR_FRAME, 0.4, 0.5);
  g.add(box(0.06, h * 0.75, 0.018, frame, 0, -h * 0.3, d / 2 + 0.014, 0.008));
  g.add(box(0.06, 0.02, 0.2, frame, 0, -h / 2 - 0.1, d / 2 - 0.08, 0.008));
});

// --------------------------------------------------------------- cat tree

const catTreeBase = (s, { mats }) => placed(s, (g, w, h, d) => g.add(box(w, h, d, mats.carpet(CARPET), 0, 0, 0, 0.02)));

function catTreeHouse(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h, d, mats.carpet(CARPET), 0, 0, 0, 0.03));
    // The way in: a dark round doorway on the side facing the room.
    const door = new THREE.Mesh(new THREE.CircleGeometry(Math.min(w, h) * 0.3, 28), new THREE.MeshBasicMaterial({ color: 0x1c140e }));
    door.position.set(0, -0.01, d / 2 + 0.0015);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.3, 0.012, 8, 28), mats.carpet(0xc4b089));
    rim.position.copy(door.position);
    g.add(door, rim);
  });
}

function catTreePost(s) {
  return placed(s, (g, w, h) => {
    const wound = tex.rope();
    wound.repeat.set(1, h / 0.06); // a coil every centimetre and a half
    const mat = new THREE.MeshStandardMaterial({ color: SISAL, map: wound, bumpMap: wound, bumpScale: 1.5, roughness: 1 });
    mat.userData.env = 0.1;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 20), mat));
  });
}

function catTreePerch(s, { mats }) {
  return placed(s, (g, w, h, d) => {
    g.add(box(w, h, d, mats.carpet(CARPET), 0, 0, 0, 0.02));
    // A raised rim, so it reads as a bed.
    const rim = mats.carpet(0xc4b089);
    for (const side of [-1, 1]) {
      g.add(box(w, 0.03, 0.035, rim, 0, h / 2 + 0.006, side * (d / 2 - 0.018), 0.015));
      g.add(box(0.035, 0.03, d, rim, side * (w / 2 - 0.018), h / 2 + 0.006, 0, 0.015));
    }
  });
}

/** Builders by static-box id. A box with no entry here is drawn as plain wood or cloth by room.js. */
export const FURNITURE = {
  couchSeat, couchBack, couchArmNorth: couchArm, couchArmSouth: couchArm,
  coffeeTableTop, coffeeTableShelf: coffeeTablePart,
  coffeeTableLeg0: coffeeTablePart, coffeeTableLeg1: coffeeTablePart, coffeeTableLeg2: coffeeTablePart, coffeeTableLeg3: coffeeTablePart,
  aquariumCabinet, aquariumTank, aquariumLid,
  chairBase, chairPost, chairSeat, chairBack,
  catTreeBase, catTreeHouse, catTreePost, catTreePerch,
};
