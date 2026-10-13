// Render pipeline for the cozy look.
//
// A plain render of the room looks like a model of a room. Three things make
// it look lit instead:
//   environment  soft image-based light and reflections, so glazed ceramic
//                and varnished wood answer the room around them
//   ambient occlusion (GTAO)  the darkening in creases and under things that
//                a painter puts in without thinking
//   bloom        a little glow around the lamps
// then tone mapping, and last of all the brush: a painterly filter that
// resolves the picture into dabs of colour the way a painter's hand does,
// keeping edges and losing the too-clean detail in between, over a canvas
// weave. Set `enabled = false` (or press P in play.html) to fall back to the
// plain render, e.g. on a slow GPU; `paint.enabled` (B) turns just the brush
// off.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** The backdrop behind the room, painted into the scene so the canvas can be opaque. */
function backdropTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 100, 10, 128, 128, 190);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A small tiling texture of smooth random values: which way the brush is moving, across the picture. */
function strokeField() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  let a = 12345;
  const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(rand() * 256);
    data.set([v, v, v, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter; // smooth between the random values
  t.needsUpdate = true;
  return t;
}

/**
 * The tooth of the canvas: a faint weave under irregular grain. Grey around
 * 0.5. The weave is kept weak, because a regular pattern shows as a grid on
 * a flat wall; the grain is what reads as a painted surface.
 */
function canvasWeave() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  let a = 99;
  const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let y = 0; y < 256; y += 4) {
    for (let x = 0; x < 256; x += 4) {
      const over = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = over ? `rgba(255,255,255,${(0.03 + rand() * 0.05).toFixed(3)})` : `rgba(0,0,0,${(0.03 + rand() * 0.05).toFixed(3)})`;
      ctx.fillRect(x, y, over ? 4 : 3, over ? 3 : 4);
    }
  }
  for (let i = 0; i < 16000; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${(rand() * 0.2).toFixed(3)})` : `rgba(0,0,0,${(rand() * 0.2).toFixed(3)})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The brush. For every pixel it looks at four overlapping patches around it,
 * turned to the local stroke direction and stretched along it, and takes the
 * mean colour of the calmest one (a Kuwahara filter). Flat areas become
 * dabs; an edge survives because the patch that straddles it is never the
 * calmest. Runs on the finished, tone-mapped picture.
 */
const PaintShader = {
  uniforms: {
    tDiffuse: { value: null },
    tField: { value: null },
    tCanvas: { value: null },
    step: { value: new THREE.Vector2(1 / 1024, 1 / 1024) }, // one brush step, in uv
    fieldScale: { value: new THREE.Vector2(3, 2) },
    canvasScale: { value: new THREE.Vector2(4, 4) },
    amount: { value: 0.85 },  // 0 = the render, 1 = all paint
    stretch: { value: 1.6 },  // how much longer a dab is than it is wide
    grain: { value: 0.13 },   // how much the canvas shows through
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tField;
    uniform sampler2D tCanvas;
    uniform vec2 step;
    uniform vec2 fieldScale;
    uniform vec2 canvasScale;
    uniform float amount;
    uniform float stretch;
    uniform float grain;
    varying vec2 vUv;
    #define REACH 3

    void main() {
      float angle = texture2D(tField, vUv * fieldScale).r * 6.2832;
      float c = cos(angle), s = sin(angle);
      // Along the stroke and across it, in uv.
      vec2 along = vec2(c, s) * step * stretch;
      vec2 across = vec2(-s, c) * step / stretch;

      vec3 mean[4];
      vec3 square[4];
      for (int k = 0; k < 4; k++) { mean[k] = vec3(0.0); square[k] = vec3(0.0); }
      for (int j = 0; j <= REACH; j++) {
        for (int i = 0; i <= REACH; i++) {
          vec2 a = along * float(i), b = across * float(j);
          vec3 t;
          t = texture2D(tDiffuse, vUv + a + b).rgb; mean[0] += t; square[0] += t * t;
          t = texture2D(tDiffuse, vUv - a + b).rgb; mean[1] += t; square[1] += t * t;
          t = texture2D(tDiffuse, vUv - a - b).rgb; mean[2] += t; square[2] += t * t;
          t = texture2D(tDiffuse, vUv + a - b).rgb; mean[3] += t; square[3] += t * t;
        }
      }
      float n = float((REACH + 1) * (REACH + 1));
      vec3 paint = vec3(0.0);
      float calmest = 1e9;
      for (int k = 0; k < 4; k++) {
        vec3 m = mean[k] / n;
        vec3 v = abs(square[k] / n - m * m);
        float spread = v.r + v.g + v.b;
        if (spread < calmest) { calmest = spread; paint = m; }
      }
      vec3 colour = mix(texture2D(tDiffuse, vUv).rgb, paint, amount);
      // The weave shows most in the mid-tones, as on a real canvas.
      float weave = texture2D(tCanvas, vUv * canvasScale).r - 0.5;
      float mid = 1.0 - abs(dot(colour, vec3(0.299, 0.587, 0.114)) - 0.5) * 1.2;
      colour *= 1.0 + weave * grain * mid;
      gl_FragColor = vec4(colour, 1.0);
    }`,
};

/**
 * Scale every material's reflections under `root`. Each material keeps its
 * own base strength in userData.env (default 0.5).
 */
export function applyEnvironment(root, factor) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && 'envMapIntensity' in m) m.envMapIntensity = (m.userData.env ?? 0.5) * factor;
    }
  });
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPipeline(renderer, scene, camera) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));

  const ao = new GTAOPass(scene, camera, size.x, size.y);
  // World-space radius: creases and contact within most of a metre, fading with distance.
  ao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1, thickness: 2, scale: 2.6, samples: 16, distanceFallOff: 0.6, screenSpaceRadius: false });
  // Denoised hard: the brush would turn any speckle left in the shading into smudges.
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 14, radiusExponent: 1, rings: 3, samples: 24 });
  // Glows, light shafts and shadow decals are not surfaces: keep them out of the depth and normal pass.
  const hide = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = function overrideVisibility() {
    hide();
    scene.traverse((o) => { if (o.userData.noAO || o.isSprite) o.visible = false; });
  };
  // With a texture background three.js draws a 2 m quad at the origin, and
  // under the pass's override material that quad lands in the depth buffer
  // as a slab standing in the middle of the room. Take the background away
  // while the pass runs.
  const renderAo = ao.render.bind(ao);
  ao.render = function render(...args) {
    const background = scene.background;
    scene.background = null;
    renderAo(...args);
    scene.background = background;
  };
  composer.addPass(ao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.75, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const paint = new ShaderPass(PaintShader);
  paint.uniforms.tField.value = strokeField();
  paint.uniforms.tCanvas.value = canvasWeave();
  composer.addPass(paint);

  const pipeline = {
    enabled: true,
    ao, bloom, paint, composer,
    setSize(w, h) {
      const ratio = renderer.getPixelRatio();
      composer.setPixelRatio(ratio);
      composer.setSize(w, h);
      // The brush is sized in screen pixels, so it looks the same at any resolution.
      // Small enough that the cat's stripes and the spines of books survive it.
      const dab = 0.72; // CSS pixels per brush step
      paint.uniforms.step.value.set(dab / w, dab / h);
      paint.uniforms.fieldScale.value.set(w / 420, h / 420); // the stroke direction turns every few hundred pixels
      paint.uniforms.canvasScale.value.set((w * ratio) / 512, (h * ratio) / 512); // one thread is two device pixels
    },
    setBackdrop(inner, outer) {
      scene.background?.dispose?.();
      scene.background = backdropTexture(inner, outer);
    },
    render() {
      if (pipeline.enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
  return pipeline;
}
