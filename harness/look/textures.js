// Procedural textures for the cozy look.
//
// Everything is painted on a canvas at load time: no image files, nothing to
// download, and the room looks the same on every reload (seeded noise).
// Browser only (needs <canvas>); the simulation never imports this.

import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Lighten (k > 0) or darken (k < 0) a 0xRRGGBB colour, k in -1..1. */
export function shade(color, k) {
  const c = new THREE.Color(color);
  if (k >= 0) c.lerp(new THREE.Color(0xffffff), k);
  else c.lerp(new THREE.Color(0x000000), -k);
  return c.getHex();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { repeat = false, mirror = false, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  return t;
}

/** Fine speckle over the whole canvas, alpha-blended. */
function speckle(ctx, w, h, rand, count, { light = 'rgba(255,255,255,', dark = 'rgba(0,0,0,', alpha = 0.06, size = 2 } = {}) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `${rand() < 0.5 ? light : dark}${(rand() * alpha).toFixed(3)})`;
    const s = 1 + rand() * size;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

/**
 * Loose brush strokes laid over a surface: translucent, each a touch lighter
 * or darker, warmer or cooler than what is under it, with a few bristle marks
 * along it. This is what makes a flat-coloured surface read as painted
 * rather than filled.
 * @param {object} [o]
 * @param {number} [o.count]             how many strokes
 * @param {[number, number]} [o.length]  px
 * @param {[number, number]} [o.width]   px
 * @param {number} [o.alpha]             strength of a stroke
 * @param {number} [o.angle]             main direction, radians
 * @param {number} [o.spread]            how far strokes stray from it (Math.PI = any direction)
 */
function brushwork(ctx, w, h, rand, { count = 260, length = [40, 150], width = [14, 44], alpha = 0.07, angle = 0, spread = Math.PI } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = angle + (rand() - 0.5) * 2 * spread;
    const len = length[0] + rand() * (length[1] - length[0]);
    const wide = width[0] + rand() * (width[1] - width[0]);
    const x = rand() * w, y = rand() * h;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const bend = (rand() - 0.5) * len * 0.3;
    const light = rand() < 0.5, warm = rand() < 0.55;
    const tint = light ? (warm ? '255,238,208' : '232,242,255') : (warm ? '74,44,22' : '34,42,66');
    const strength = alpha * (0.4 + rand() * 0.9);
    const stroke = (offset, lineWidth, k) => {
      const ox = -Math.sin(a) * offset, oy = Math.cos(a) * offset;
      ctx.strokeStyle = `rgba(${tint},${(strength * k).toFixed(3)})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + dx / 2 - Math.sin(a) * bend, y + oy + dy / 2 + Math.cos(a) * bend, x + ox + dx, y + oy + dy);
      ctx.stroke();
    };
    stroke(0, wide, 1);
    // Bristle marks.
    for (let b = 0; b < 3; b++) stroke((rand() - 0.5) * wide * 0.8, 1 + rand() * 1.6, 1.6);
  }
  ctx.restore();
}

/**
 * The floor: warm planks running along x, staggered, each its own shade.
 * One texture for the whole floor, so no tiling shows.
 * @param {number} width  m along x
 * @param {number} depth  m along z
 */
export function plankFloor(width, depth, { seed = 11, plank = 0.125, tones = [0xad6e2e, 0xb57632, 0xa6672b, 0xbc7e37, 0xa06329, 0xb17230] } = {}) {
  const rand = mulberry32(seed);
  const ppm = 2048 / width;
  const W = 2048, H = Math.round(depth * ppm);
  const [canvas, ctx] = makeCanvas(W, H);
  const [bump, bctx] = makeCanvas(W, H);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hex(tones[0]);
  ctx.fillRect(0, 0, W, H);

  const rowH = plank * ppm;
  for (let row = 0, y = 0; y < H; row++, y += rowH) {
    let x = -rand() * 1.2 * ppm;
    while (x < W) {
      const len = (0.9 + rand() * 1.3) * ppm;
      const tone = shade(tones[Math.floor(rand() * tones.length)], (rand() - 0.5) * 0.07);
      // The plank, lit a touch from its upper edge.
      const g = ctx.createLinearGradient(0, y, 0, y + rowH);
      g.addColorStop(0, hex(shade(tone, 0.07)));
      g.addColorStop(0.2, hex(tone));
      g.addColorStop(1, hex(shade(tone, -0.08)));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, len, rowH);
      // Grain: long thin streaks.
      for (let k = 0; k < 9; k++) {
        const gy = y + 2 + rand() * (rowH - 4);
        ctx.strokeStyle = `rgba(${rand() < 0.6 ? '70,35,10' : '255,225,170'},${(0.05 + rand() * 0.1).toFixed(3)})`;
        ctx.lineWidth = 0.6 + rand() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x + rand() * len * 0.3, gy);
        ctx.bezierCurveTo(x + len * 0.35, gy + (rand() - 0.5) * 5, x + len * 0.65, gy + (rand() - 0.5) * 5, x + len * (0.7 + rand() * 0.3), gy + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      if (rand() < 0.12) {
        // A knot.
        const kx = x + len * (0.2 + rand() * 0.6), ky = y + rowH * (0.3 + rand() * 0.4);
        ctx.fillStyle = 'rgba(70,35,12,0.35)';
        ctx.beginPath();
        ctx.ellipse(kx, ky, 5 + rand() * 5, 2.5 + rand() * 2.5, 0, 0, 7);
        ctx.fill();
      }
      // Seams: the joint at the end of the plank and the gap below it.
      ctx.fillStyle = 'rgba(52,26,8,0.6)';
      ctx.fillRect(x + len - 1, y, 1.8, rowH);
      bctx.fillStyle = '#2a2a2a';
      bctx.fillRect(x + len - 2, y, 3.5, rowH);
      x += len;
    }
    ctx.fillStyle = 'rgba(48,24,8,0.68)';
    ctx.fillRect(0, y + rowH - 1.6, W, 2);
    ctx.fillStyle = 'rgba(255,225,170,0.1)';
    ctx.fillRect(0, y, W, 1.2);
    bctx.fillStyle = '#262626';
    bctx.fillRect(0, y + rowH - 2.5, W, 3.5);
  }
  speckle(ctx, W, H, rand, 16000, { alpha: 0.05 });
  brushwork(ctx, W, H, rand, { count: 520, length: [80, 320], width: [14, 46], alpha: 0.05, angle: 0, spread: 0.35 });
  return { map: toTexture(canvas, { anisotropy: 16 }), bumpMap: toTexture(bump, { anisotropy: 4 }) };
}

/**
 * Wood grain to tint with a material colour: near white with streaks along u.
 * Tiles (mirrored), about 0.8 m per repeat.
 */
export function woodGrain({ seed = 3 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#f1e7da';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 150; i++) {
    const y = rand() * 512;
    const dark = rand() < 0.65;
    ctx.strokeStyle = dark ? `rgba(90,50,20,${(0.05 + rand() * 0.16).toFixed(3)})` : `rgba(255,250,240,${(0.1 + rand() * 0.25).toFixed(3)})`;
    ctx.lineWidth = 0.8 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    const a = (rand() - 0.5) * 16, b = (rand() - 0.5) * 16;
    ctx.bezierCurveTo(170, y + a, 340, y + b, 512, y); // ends where it starts: tiles along u
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const kx = 60 + rand() * 390, ky = 60 + rand() * 390;
    for (let r = 14; r > 2; r -= 3) {
      ctx.strokeStyle = `rgba(90,50,20,${(0.1 + (14 - r) * 0.015).toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, r * 1.9, r, 0, 0, 7);
      ctx.stroke();
    }
  }
  speckle(ctx, 512, 512, rand, 5000, { alpha: 0.05 });
  brushwork(ctx, 512, 512, rand, { count: 46, length: [120, 380], width: [18, 54], alpha: 0.06, angle: 0, spread: 0.18 });
  return toTexture(canvas, { repeat: true, mirror: true });
}

/** Painted plaster: soft blotches, darker towards the floor (v = 0). */
export function plaster({ seed = 5, color = 0x9d9887 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, hex(shade(color, 0.1)));
  g.addColorStop(0.55, hex(color));
  g.addColorStop(1, hex(shade(color, -0.2)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 90; i++) {
    const x = rand() * 1024, y = rand() * 512, r = 40 + rand() * 120;
    const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tint = rand() < 0.5 ? '255,250,235' : '40,35,25';
    blot.addColorStop(0, `rgba(${tint},${(0.02 + rand() * 0.035).toFixed(3)})`);
    blot.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = blot;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  speckle(ctx, 1024, 512, rand, 9000, { alpha: 0.035 });
  // Walls carry the most open brushwork in the room, but they are the background: keep it quiet.
  brushwork(ctx, 1024, 512, rand, { count: 420, length: [60, 220], width: [18, 56], alpha: 0.034 });
  return toTexture(canvas);
}

/** A shaggy rug with a darker bound edge. Transparent outside its rounded corners. */
export function shagRug({ seed = 7, color = 0xbdb6a8, aspect = 1.4 } = {}) {
  const rand = mulberry32(seed);
  const W = 1024, H = Math.round(1024 / aspect);
  const [canvas, ctx] = makeCanvas(W, H);
  const r = 26;
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, r);
  ctx.clip();
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, W, H);
  // Trodden paler in the middle, greyer towards one end.
  const worn = ctx.createRadialGradient(W * 0.45, H * 0.42, 20, W * 0.5, H * 0.5, W * 0.62);
  worn.addColorStop(0, 'rgba(255,250,238,0.28)');
  worn.addColorStop(1, 'rgba(70,66,60,0.2)');
  ctx.fillStyle = worn;
  ctx.fillRect(0, 0, W, H);
  // Pile: short strokes in every direction.
  for (let i = 0; i < 42000; i++) {
    const x = rand() * W, y = rand() * H, a = rand() * 6.28, l = 3 + rand() * 7;
    ctx.strokeStyle = rand() < 0.5 ? `rgba(255,252,244,${(0.08 + rand() * 0.2).toFixed(3)})` : `rgba(60,52,40,${(0.06 + rand() * 0.16).toFixed(3)})`;
    ctx.lineWidth = 1 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // Bound edge.
  ctx.strokeStyle = hex(shade(color, -0.3));
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, r);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,250,240,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(22, 22, W - 44, H - 44, r - 8);
  ctx.stroke();
  return toTexture(canvas);
}

/** A woven patchwork rug: squares of warm tones with a basket weave. */
export function patchworkRug({ seed = 9, tones = [0xc9792f, 0xb5662a, 0xd88d3f, 0xbf6f2c, 0xa85d27, 0xdc9a4a], cols = 6, rows = 4 } = {}) {
  const rand = mulberry32(seed);
  const W = 1024, H = Math.round((1024 * rows) / cols);
  const [canvas, ctx] = makeCanvas(W, H);
  const cw = W / cols, ch = H / rows;
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const tone = shade(tones[Math.floor(rand() * tones.length)], (rand() - 0.5) * 0.12);
      ctx.fillStyle = hex(tone);
      ctx.fillRect(cx * cw, cy * ch, cw, ch);
      // Weave: alternate patches run the other way.
      const across = (cx + cy) % 2 === 0;
      ctx.strokeStyle = 'rgba(70,32,8,0.22)';
      ctx.lineWidth = 2;
      for (let k = 6; k < (across ? ch : cw); k += 9) {
        ctx.beginPath();
        if (across) { ctx.moveTo(cx * cw, cy * ch + k); ctx.lineTo((cx + 1) * cw, cy * ch + k); } else { ctx.moveTo(cx * cw + k, cy * ch); ctx.lineTo(cx * cw + k, (cy + 1) * ch); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,225,170,0.14)';
      for (let k = 2; k < (across ? ch : cw); k += 9) {
        ctx.beginPath();
        if (across) { ctx.moveTo(cx * cw, cy * ch + k); ctx.lineTo((cx + 1) * cw, cy * ch + k); } else { ctx.moveTo(cx * cw + k, cy * ch); ctx.lineTo(cx * cw + k, (cy + 1) * ch); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(60,28,8,0.55)';
      ctx.lineWidth = 4;
      ctx.strokeRect(cx * cw + 2, cy * ch + 2, cw - 4, ch - 4);
    }
  }
  speckle(ctx, W, H, rand, 9000, { alpha: 0.06 });
  return toTexture(canvas);
}

/** Striped blanket. Stripes run across u. */
export function blanket({ seed = 13, color = 0x3f6fb5, stripe = 0x6f9bd6 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, 512, 512);
  for (const [x, w] of [[70, 44], [200, 70], [330, 44], [430, 26]]) {
    ctx.fillStyle = hex(stripe);
    ctx.fillRect(x, 0, w, 512);
    ctx.fillStyle = hex(shade(color, -0.25));
    ctx.fillRect(x - 5, 0, 5, 512);
    ctx.fillRect(x + w, 0, 5, 512);
  }
  // Knit: faint cross-hatch.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 512; k += 6) {
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(512, k); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 512); ctx.stroke();
  }
  speckle(ctx, 512, 512, rand, 7000, { alpha: 0.06 });
  return toTexture(canvas);
}

/** Plain woven cloth to tint (pillow, mattress, skirt). */
export function cloth({ seed = 17 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(90,80,60,0.07)';
  for (let k = 0; k < 256; k += 4) {
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(256, k); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 256); ctx.stroke();
  }
  speckle(ctx, 256, 256, rand, 2500, { alpha: 0.05 });
  return toTexture(canvas, { repeat: true });
}

/** Hanging cloth to tint: soft vertical folds every few centimetres (the bed skirt). */
export function pleats({ seed = 19 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 64);
  ctx.fillStyle = '#f2efe8';
  ctx.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 32) {
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, 'rgba(30,30,50,0.34)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(30,30,50,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 32, 64);
  }
  speckle(ctx, 256, 64, rand, 900, { alpha: 0.05 });
  return toTexture(canvas, { repeat: true });
}

/** A wound ball of yarn to tint: strands crossing in bands. */
export function yarn({ seed = 23 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 128);
  ctx.fillStyle = '#e9e4dc';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 90; i++) {
    const y = rand() * 128, tilt = (rand() - 0.5) * 90;
    ctx.strokeStyle = rand() < 0.5 ? `rgba(40,30,30,${(0.12 + rand() * 0.2).toFixed(2)})` : `rgba(255,255,255,${(0.2 + rand() * 0.3).toFixed(2)})`;
    ctx.lineWidth = 1.5 + rand() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + tilt);
    ctx.stroke();
  }
  return toTexture(canvas, { repeat: true });
}

/** Fur to tint: near white, combed into short strands along v. Also used as the bump map. */
export function fur({ seed = 27 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#ece6dc';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const x = rand() * 256, y = rand() * 256, len = 5 + rand() * 11, lean = (rand() - 0.5) * 3;
    ctx.strokeStyle = rand() < 0.55 ? `rgba(50,35,20,${(0.06 + rand() * 0.16).toFixed(3)})` : `rgba(255,255,255,${(0.1 + rand() * 0.25).toFixed(3)})`;
    ctx.lineWidth = 0.7 + rand() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y + len);
    ctx.stroke();
  }
  return toTexture(canvas, { repeat: true });
}

/**
 * Soft dark blob for contact shadows: warm black fading to nothing.
 * Alpha-blended, not multiplied: on a transparent canvas a multiply blend
 * also scales the canvas's own alpha and lets the page show through.
 */
export function softShadow({ strength = 0.55 } = {}) {
  const [canvas, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, `rgba(28,14,6,${strength})`);
  g.addColorStop(0.55, `rgba(28,14,6,${(strength * 0.42).toFixed(3)})`);
  g.addColorStop(1, 'rgba(28,14,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas);
}

/** A dark edge fading out along v: for the creases where walls meet the floor and each other. */
export function creaseShadow({ strength = 0.5 } = {}) {
  const [canvas, ctx] = makeCanvas(8, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, `rgba(24,14,8,${strength})`);
  g.addColorStop(0.45, `rgba(24,14,8,${(strength * 0.25).toFixed(3)})`);
  g.addColorStop(1, 'rgba(24,14,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  return toTexture(canvas);
}

/** Round additive glow for lamps. */
export function glow({ color = '255,196,110' } = {}) {
  const [canvas, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},0.9)`);
  g.addColorStop(0.25, `rgba(${color},0.38)`);
  g.addColorStop(0.6, `rgba(${color},0.1)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas);
}

/** The view through the window. `night` is a moon over rooftops, otherwise a garden at dusk. */
export function windowView({ night = false } = {}) {
  const rand = mulberry32(31);
  const [canvas, ctx] = makeCanvas(256, 320);
  const sky = ctx.createLinearGradient(0, 0, 0, 320);
  if (night) {
    sky.addColorStop(0, '#0d1633');
    sky.addColorStop(1, '#25345f');
  } else {
    sky.addColorStop(0, '#f6c98a');
    sky.addColorStop(0.5, '#f1dfae');
    sky.addColorStop(1, '#a9cf8a');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 320);
  if (night) {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.3 + rand() * 0.6).toFixed(2)})`;
      ctx.fillRect(rand() * 256, rand() * 200, 1.6, 1.6);
    }
    const halo = ctx.createRadialGradient(176, 86, 0, 176, 86, 70);
    halo.addColorStop(0, 'rgba(230,236,255,0.55)');
    halo.addColorStop(1, 'rgba(230,236,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(100, 10, 150, 150);
    ctx.fillStyle = '#f3f1e4';
    ctx.beginPath(); ctx.arc(176, 86, 24, 0, 7); ctx.fill();
  }
  // Foliage along the bottom.
  for (let i = 0; i < 60; i++) {
    const g = night ? `rgba(${18 + rand() * 14},${34 + rand() * 20},${40 + rand() * 16},0.95)` : `rgba(${50 + rand() * 50},${120 + rand() * 60},${50 + rand() * 30},0.9)`;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(rand() * 256, 250 + rand() * 80, 18 + rand() * 30, 0, 7);
    ctx.fill();
  }
  return toTexture(canvas);
}

/** A small framed picture. `kind`: 'leaves' | 'sun' | 'map' | 'note'. */
export function picture(kind) {
  const rand = mulberry32(kind.length * 7 + kind.charCodeAt(0));
  const [canvas, ctx] = makeCanvas(256, 320);
  if (kind === 'leaves') {
    ctx.fillStyle = '#2f5d3a';
    ctx.fillRect(0, 0, 256, 320);
    for (let i = 0; i < 26; i++) {
      ctx.save();
      ctx.translate(rand() * 256, rand() * 320);
      ctx.rotate(rand() * 6.28);
      ctx.fillStyle = `rgb(${60 + rand() * 60},${140 + rand() * 70},${60 + rand() * 40})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 40 + rand() * 26, 13 + rand() * 9, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,30,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(50, 0); ctx.stroke();
      ctx.restore();
    }
  } else if (kind === 'sun') {
    ctx.fillStyle = '#3a5672';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#e0a03c';
    ctx.beginPath(); ctx.arc(128, 150, 54, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b4159';
    ctx.fillRect(0, 232, 256, 88);
  } else if (kind === 'map') {
    ctx.fillStyle = '#d9c79c';
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = 'rgba(110,80,40,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(rand() * 256, rand() * 320);
      ctx.bezierCurveTo(rand() * 256, rand() * 320, rand() * 256, rand() * 320, rand() * 256, rand() * 320);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,150,110,0.5)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(rand() * 256, rand() * 320, 30 + rand() * 30, 18 + rand() * 20, rand() * 3, 0, 7); ctx.fill(); }
  } else {
    ctx.fillStyle = '#f1ead6';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = 'rgba(70,60,50,0.55)';
    for (let y = 40; y < 290; y += 26) ctx.fillRect(28, y, 120 + rand() * 80, 5);
  }
  return toTexture(canvas);
}

/** Leather to tint: near white, fine pores and a few soft creases. Also its own bump map. */
export function leather({ seed = 33 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#ece5dc';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(40,20,10,${(0.04 + rand() * 0.1).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(rand() * 256, rand() * 256, 0.6 + rand() * 1.2, 0, 7);
    ctx.fill();
  }
  ctx.filter = 'blur(1.2px)';
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = rand() < 0.7 ? `rgba(40,20,10,${(0.1 + rand() * 0.14).toFixed(2)})` : `rgba(255,250,240,${(0.2 + rand() * 0.25).toFixed(2)})`;
    ctx.lineWidth = 1 + rand() * 2.2;
    ctx.beginPath();
    const x = rand() * 256, y = rand() * 256;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 60, x + (rand() - 0.5) * 160, y + (rand() - 0.5) * 80, x + (rand() - 0.5) * 220, y + (rand() - 0.5) * 100);
    ctx.stroke();
  }
  ctx.filter = 'none';
  return toTexture(canvas, { repeat: true, mirror: true });
}

/** Looped carpet to tint: a field of small nubs. Also its own bump map. */
export function carpet({ seed = 35 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#e8e2d8';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const x = rand() * 256, y = rand() * 256, r = 1.2 + rand() * 1.8;
    ctx.fillStyle = `rgba(60,45,30,${(0.08 + rand() * 0.14).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x + 0.8, y + 0.8, r, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,252,246,${(0.25 + rand() * 0.35).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 7); ctx.fill();
  }
  return toTexture(canvas, { repeat: true });
}

/** Sisal rope wound round a post, to tint: one coil per row, strands slanting across. */
export function rope() {
  const [canvas, ctx] = makeCanvas(64, 64);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 4; row++) {
    const y = row * 16;
    const g = ctx.createLinearGradient(0, y, 0, y + 16);
    g.addColorStop(0, 'rgba(60,40,15,0.5)');
    g.addColorStop(0.3, 'rgba(255,250,235,0.35)');
    g.addColorStop(1, 'rgba(60,40,15,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, 64, 16);
    ctx.strokeStyle = 'rgba(70,45,15,0.3)';
    ctx.lineWidth = 1.2;
    for (let x = -16; x < 64; x += 6) { ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x + 9, y); ctx.stroke(); }
  }
  return toTexture(canvas, { repeat: true });
}

/** Inside the aquarium: deep teal at the bottom up to pale water, with light slanting down. */
export function water() {
  const rand = mulberry32(41);
  const [canvas, ctx] = makeCanvas(512, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#9fe9f2');
  g.addColorStop(0.35, '#3fb6d8');
  g.addColorStop(1, '#0f5f8f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 9; i++) {
    const x = rand() * 512, w = 16 + rand() * 40;
    const ray = ctx.createLinearGradient(0, 0, 0, 256);
    ray.addColorStop(0, 'rgba(235,255,255,0.3)');
    ray.addColorStop(1, 'rgba(235,255,255,0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w + 50, 256); ctx.lineTo(x + 40, 256);
    ctx.fill();
  }
  return toTexture(canvas);
}

/** Aquarium gravel. */
export function gravel() {
  const rand = mulberry32(43);
  const [canvas, ctx] = makeCanvas(256, 128);
  ctx.fillStyle = '#b79a72';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 1500; i++) {
    const v = 110 + rand() * 120;
    ctx.fillStyle = `rgb(${v},${v * 0.86},${v * 0.66})`;
    ctx.beginPath(); ctx.ellipse(rand() * 256, rand() * 128, 2 + rand() * 3, 1.5 + rand() * 2, rand() * 3, 0, 7); ctx.fill();
  }
  return toTexture(canvas);
}

/** What is on the monitor: a desktop with a couple of windows. */
export function screen() {
  const [canvas, ctx] = makeCanvas(512, 288);
  const bg = ctx.createLinearGradient(0, 0, 512, 288);
  bg.addColorStop(0, '#2f6fd0');
  bg.addColorStop(0.6, '#3fa0e6');
  bg.addColorStop(1, '#7fd0f0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 288);
  const win = (x, y, w, h, title) => {
    ctx.fillStyle = 'rgba(10,25,60,0.25)';
    ctx.fillRect(x + 5, y + 6, w, h);
    ctx.fillStyle = '#f4f6fb';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = title;
    ctx.fillRect(x, y, w, 16);
    ctx.fillStyle = 'rgba(60,80,120,0.5)';
    for (let r = y + 30; r < y + h - 10; r += 13) ctx.fillRect(x + 12, r, w * (0.45 + ((r * 7) % 40) / 100), 5);
  };
  win(60, 44, 230, 160, '#3b4f86');
  win(250, 96, 200, 138, '#c8553d');
  ctx.fillStyle = 'rgba(15,30,70,0.75)';
  ctx.fillRect(0, 268, 512, 20);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#f1b53a', '#6ac47a', '#e05a3a', '#f4f6fb', '#7fa8e0', '#c98be0'][i]; ctx.fillRect(14 + i * 26, 272, 14, 12); }
  return toTexture(canvas);
}

/** The top of a keyboard: rows of pale keys on a dark deck. */
export function keys() {
  const [canvas, ctx] = makeCanvas(512, 176);
  ctx.fillStyle = '#2a2c33';
  ctx.fillRect(0, 0, 512, 176);
  for (let row = 0; row < 5; row++) {
    const n = row === 4 ? 9 : 14, y = 12 + row * 32;
    for (let k = 0; k < n; k++) {
      const w = row === 4 && k === 4 ? 160 : (488 - (row === 4 ? 160 : 0)) / (row === 4 ? n - 1 : n) - 5;
      const x = row === 4 ? (k < 4 ? 12 + k * 41 : k === 4 ? 176 : 341 + (k - 5) * 41) : 12 + k * (488 / n);
      ctx.fillStyle = '#d9dbe2';
      ctx.fillRect(x, y, row === 4 && k !== 4 ? 36 : w, 25);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x + 2, y + 2, (row === 4 && k !== 4 ? 36 : w) - 4, 8);
    }
  }
  return toTexture(canvas);
}

/** Soft folds for bedding, as a bump map: long pale and dark streaks that wander. */
export function wrinkles({ seed = 29 } = {}) {
  const rand = mulberry32(seed);
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 512);
  ctx.filter = 'blur(7px)';
  for (let i = 0; i < 46; i++) {
    ctx.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${(0.2 + rand() * 0.3).toFixed(2)})` : `rgba(0,0,0,${(0.2 + rand() * 0.3).toFixed(2)})`;
    ctx.lineWidth = 6 + rand() * 16;
    ctx.beginPath();
    let x = rand() * 512, y = rand() * 512;
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (rand() - 0.5) * 220; y += (rand() - 0.2) * 200;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.filter = 'none';
  const t = toTexture(canvas, { repeat: true, mirror: true });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** The alarm clock's face. */
export function clockFace(text = '3:00') {
  const [canvas, ctx] = makeCanvas(256, 128);
  ctx.fillStyle = '#160a08';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#ff5a3c';
  ctx.shadowColor = '#ff3a1c';
  ctx.shadowBlur = 16;
  ctx.font = 'bold 88px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 70);
  return toTexture(canvas);
}
