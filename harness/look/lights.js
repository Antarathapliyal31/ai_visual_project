// Lighting for the cozy look.
//
// Two moods over the same room:
//   evening  warm and bright, like the reference: a soft warm key from above
//            the camera, warm bounce from the floor, lamps as accents
//   3 a.m.   the game's own hour: the key becomes dim moonlight, and the
//            lamps carry the room
//
// One shadow-casting light either way; the lamps' point lights cast none.

import * as THREE from 'three';

const MOODS = {
  evening: {
    sky: 0xfff0d6, ground: 0x8a5f38, hemi: 0.42, env: 0.7,
    key: 0xffe4bd, keyIntensity: 2.3, keyFrom: [-3.5, 9, 6],
    fill: 0xcfe0ff, fillIntensity: 0.4,
    exposure: 0.98, lamp: 2.4, glow: 0.42, backdrop: ['#2a3a63', '#131a33'],
  },
  night: {
    sky: 0x8499d6, ground: 0x2c2230, hemi: 0.42, env: 0.22,
    key: 0x9db6ff, keyIntensity: 0.95, keyFrom: [4.5, 7, -6.5],
    fill: 0x6f86c8, fillIntensity: 0.25,
    exposure: 1.12, lamp: 6.5, glow: 0.85, backdrop: ['#141a36', '#070914'],
  },
};

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 */
export function createLights(scene, renderer) {
  const hemi = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 0.5, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 5;
  key.target.position.set(0, 0, 0);
  const fill = new THREE.DirectionalLight();
  fill.position.set(6, 5, -3);
  scene.add(hemi, key, key.target, fill);

  let mood = MOODS.evening;
  function setMood(name) {
    mood = MOODS[name] ?? MOODS.evening;
    hemi.color.set(mood.sky);
    hemi.groundColor.set(mood.ground);
    hemi.intensity = mood.hemi;
    key.color.set(mood.key);
    key.intensity = mood.keyIntensity;
    key.position.set(...mood.keyFrom);
    fill.color.set(mood.fill);
    fill.intensity = mood.fillIntensity;
    renderer.toneMappingExposure = mood.exposure;
    return mood;
  }
  setMood('evening');

  return {
    setMood,
    get mood() { return mood; },
    /** Bring a lamp mesh (from propMeshes) in line with the mood; dim it when it lies on its side. */
    tuneLamp(lampMesh) {
      const parts = lampMesh.userData.lamp;
      if (!parts) return;
      parts.light.intensity = mood.lamp;
      parts.glow.material.opacity = mood.glow;
    },
  };
}
