// Shared geometry and materials for the cozy look.
//
// roundedBox() gives every piece of furniture softened edges and UVs in
// metres, so one wood texture fits a desk top and a bed leg alike.
// createMaterials() hands out one material per tint and finish, so a room of
// furniture is a handful of shader programs.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as tex from './textures.js';

export const GRAIN_TILE = 0.8; // m of wood per texture repeat

/**
 * A rounded box whose UVs are in metres, with the grain (u) along the longer
 * side of every face, so one wood texture fits a desk top and a bed leg alike.
 */
export function roundedBox(w, h, d, radius = 0.012, segments = 2) {
  const r = Math.min(radius, 0.45 * Math.min(w, h, d));
  const geo = new RoundedBoxGeometry(w, h, d, segments, r);
  const uv = geo.attributes.uv;
  const perSide = uv.count / 6;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z: (u, v) sizes
  for (let k = 0; k < uv.count; k++) {
    const [du, dv] = dims[Math.floor(k / perSide)];
    const u = uv.getX(k) * du, v = uv.getY(k) * dv;
    if (dv > du) uv.setXY(k, v / GRAIN_TILE, u / GRAIN_TILE);
    else uv.setXY(k, u / GRAIN_TILE, v / GRAIN_TILE);
  }
  return geo;
}

/** Shared materials, one per tint, so a room of furniture is a handful of programs. */
export function createMaterials(maxAnisotropy = 8) {
  const grain = tex.woodGrain();
  const weave = tex.cloth();
  weave.repeat.set(GRAIN_TILE / 0.25, GRAIN_TILE / 0.25); // UVs are in grain tiles; cloth repeats every 25 cm
  grain.anisotropy = weave.anisotropy = maxAnisotropy;
  const hide = tex.leather(), pile = tex.carpet();
  hide.repeat.set(GRAIN_TILE / 0.5, GRAIN_TILE / 0.5);
  pile.repeat.set(GRAIN_TILE / 0.2, GRAIN_TILE / 0.2);
  const cache = new Map();
  return {
    grain, weave,
    leather(color) {
      const key = `l${color}`;
      if (!cache.has(key)) {
        const m = new THREE.MeshPhysicalMaterial({ color, map: hide, bumpMap: hide, bumpScale: 0.9, roughness: 0.52, clearcoat: 0.3, clearcoatRoughness: 0.45 });
        m.userData.env = 0.6;
        cache.set(key, m);
      }
      return cache.get(key);
    },
    carpet(color) {
      const key = `k${color}`;
      if (!cache.has(key)) {
        const m = new THREE.MeshStandardMaterial({ color, map: pile, bumpMap: pile, bumpScale: 1.6, roughness: 1 });
        m.userData.env = 0.1;
        cache.set(key, m);
      }
      return cache.get(key);
    },
    wood(color, roughness = 0.62) {
      const key = `w${color}:${roughness}`;
      if (!cache.has(key)) {
        const m = new THREE.MeshStandardMaterial({ color, map: grain, bumpMap: grain, bumpScale: 0.6, roughness, metalness: 0.02 });
        m.userData.env = 0.45;
        cache.set(key, m);
      }
      return cache.get(key);
    },
    cloth(color) {
      const key = `c${color}`;
      if (!cache.has(key)) {
        const m = new THREE.MeshStandardMaterial({ color, map: weave, bumpMap: weave, bumpScale: 0.5, roughness: 0.95, metalness: 0 });
        m.userData.env = 0.2;
        cache.set(key, m);
      }
      return cache.get(key);
    },
    plain(color, roughness = 0.7, metalness = 0) {
      const key = `p${color}:${roughness}:${metalness}`;
      if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
      return cache.get(key);
    },
  };
}

