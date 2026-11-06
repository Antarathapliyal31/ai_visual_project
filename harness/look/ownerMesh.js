// The owner, drawn: Quaternius's CC0 "Animated Human" (Christina's asset in
// demo/public/models/) posed and animated from the owner simulation's state.
//
// The clips come with the model: Idle, Walk, Run, Working (kneels and looks
// at the floor), Punch, Jump and Death. Asleep he is the Idle pose (breathing)
// laid flat on his back along the bed, head on the pillow; sitting up he turns
// up into the first frame of Working, on his knees in bed; getting up blends
// from there to Idle at the bedside. Up and about he walks, runs when he chases the cat, and kneels
// (Working) to look under the bed or the desk. His head follows where he is
// looking. On the floor, his view is drawn as a fan that turns red as he
// becomes sure he has seen the cat; above his head a z, ? or ! says what he
// is up to.
//
// It only reads the simulation (src/ai/owner.js `state`); nothing here writes to it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BED_LIE, BEDSIDE } from '../../src/ai/home.js';

const MODEL_URL = '../demo/public/models/demo-avatar.glb';
const HEIGHT = 1.72;          // m, to match the collider
const MATTRESS = 0.72;        // m, top of A's mattress
const BED_YAW = Math.PI / 2;  // kneeling in bed he faces +x, down the bed
const UP = new THREE.Vector3(0, 1, 0);
// Lying on his back: the model's up (+y) points to the headboard (-x), its front (+z) to the ceiling.
const Q_LIE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
const Q_KNEEL = new THREE.Quaternion().setFromAxisAngle(UP, BED_YAW);
const LIE_AT = new THREE.Vector3(-3.22 + HEIGHT, MATTRESS + 0.08, BED_LIE.z); // his feet; head on the pillow
const KNEEL_AT = new THREE.Vector3(-2.75, MATTRESS, BED_LIE.z);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
// The model faces +z; the simulation's heading h faces (cos h, 0, -sin h).
const yawFor = (heading) => heading + Math.PI / 2;

function iconTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 86px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(40, 18, 4, 0.9)';
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** @param {{onLoad?: (model: THREE.Object3D) => void}} [opts] */
export function createOwnerMesh(opts = {}) {
  const group = new THREE.Group();
  group.name = 'Owner';

  // --- his view, on the floor
  const fanMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const fan = new THREE.Mesh(new THREE.CircleGeometry(1, 40, 0, 1), fanMat);
  fan.rotation.x = -Math.PI / 2;
  fan.renderOrder = 3;
  fan.userData.noAO = true;
  fan.visible = false;
  const fanPivot = new THREE.Group();
  fanPivot.add(fan);
  group.add(fanPivot);

  // --- what he is up to, above his head
  const icons = {
    sleep: iconTexture('z', '#cfe3ff'),
    wonder: iconTexture('?', '#ffd27a'),
    alarm: iconTexture('!', '#ff6a4a'),
  };
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: icons.sleep, transparent: true, depthTest: false, toneMapped: false }));
  icon.scale.setScalar(0.32);
  icon.renderOrder = 10;
  icon.userData.noAO = true;
  group.add(icon);

  const body = new THREE.Group(); // the model's placement
  group.add(body);
  let model = null, mixer = null, neck = null, headTop = null;
  const actions = {};
  const weights = { kneel: 0, idle: 1, walk: 0, run: 0, work: 0, punch: 0 };
  let rise = 0, time = 0, lastMotor = 'inBed', punchT = 0;
  const pos = LIE_AT.clone();
  const turn = new THREE.Quaternion().copy(Q_LIE);

  new GLTFLoader().load(MODEL_URL, (gltf) => {
    model = gltf.scene;
    model.updateMatrixWorld(true);
    const top = new THREE.Vector3();
    model.getObjectByName('HeadTop_End').getWorldPosition(top);
    model.scale.setScalar(HEIGHT / top.y);
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    neck = model.getObjectByName('Neck');
    headTop = model.getObjectByName('HeadTop_End');
    mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((a) => a.name === name);
    const frozen = (name, at) => {
      const a = mixer.clipAction(clip(name).clone());
      a.play();
      a.paused = true;
      a.time = at === 'end' ? a.getClip().duration - 1e-3 : at;
      return a;
    };
    actions.kneel = frozen('Working', 0.05);
    for (const [key, name] of [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['work', 'Working'], ['punch', 'Punch']]) {
      const a = mixer.clipAction(clip(name));
      a.play();
      actions[key] = a;
    }
    actions.punch.setLoop(THREE.LoopOnce, 1);
    actions.punch.clampWhenFinished = true;
    body.add(model);
    opts.onLoad?.(model);
    applyWeights();
  }, undefined, (error) => console.error(`Couldn't load the owner model ${MODEL_URL}:`, error));

  function applyWeights() {
    if (!mixer) return;
    for (const k of Object.keys(actions)) actions[k].setEffectiveWeight(weights[k]);
  }

  /** Blend all weights towards one pose (or a mix). */
  function blendTo(target, dt, rate = 6) {
    const k = Math.min(1, dt * rate);
    for (const key of Object.keys(weights)) weights[key] += ((target[key] ?? 0) - weights[key]) * k;
  }

  const qNeck = new THREE.Quaternion(), qParent = new THREE.Quaternion(), qTurn = new THREE.Quaternion();
  /** Turn a bone about the world's up axis, on top of what the animation set. */
  function turnBone(bone, angle) {
    if (!bone || !angle) return;
    bone.parent.getWorldQuaternion(qParent);
    qTurn.setFromAxisAngle(UP, angle);
    qNeck.copy(qParent).invert().multiply(qTurn).multiply(qParent);
    bone.quaternion.premultiply(qNeck);
  }

  return {
    group,
    /**
     * @param {number} dt
     * @param {object} s  the owner's `state` from src/ai/owner.js
     */
    update(dt, s) {
      time += dt;
      const m = s.motor;
      const inBed = m === 'inBed';
      const getting = m === 'gettingUp';
      const lyingDown = m === 'lyingDown';

      // In bed he rises from lying to kneeling as he sits up; getting up and lying down pass through kneeling.
      const riseTo = inBed ? (s.stage === 'sittingUp' ? 1 : 0) : getting ? 1 : lyingDown ? (s.progress < 0.5 ? 1 : 0) : 1;
      rise += (riseTo - rise) * Math.min(1, dt * 3);

      if (model) {
        if (inBed || (lyingDown && s.progress >= 0.5)) {
          // In bed: lying flat on his back, turning up onto his knees as he sits up.
          const r = smooth(rise);
          pos.lerpVectors(LIE_AT, KNEEL_AT, r);
          turn.slerpQuaternions(Q_LIE, Q_KNEEL, r);
          blendTo({ idle: 1 - rise, kneel: rise }, dt);
          // Stirring: he shifts under the covers.
          if (s.stage === 'stirring') pos.z += Math.sin(time * 2.2) * 0.03;
        } else if (getting || lyingDown) {
          // Off the bed (or back onto it): kneeling at the head of the bed <-> standing at the bedside.
          const p = getting ? smooth(clamp01(s.progress)) : smooth(clamp01(1 - s.progress * 2));
          const bedside = new THREE.Vector3(BEDSIDE.x, 0, BEDSIDE.z);
          pos.lerpVectors(KNEEL_AT, bedside, p);
          pos.y = MATTRESS * (1 - p) + Math.sin(p * Math.PI) * 0.12;
          turn.setFromAxisAngle(UP, BED_YAW + (yawFor(0) - BED_YAW) * p);
          blendTo({ kneel: 1 - p, walk: Math.sin(p * Math.PI), idle: p }, dt, 12);
        } else {
          pos.set(s.x, 0, s.z);
          turn.setFromAxisAngle(UP, yawFor(s.heading));
          if (m !== lastMotor && m === 'caught') { actions.punch?.reset().play(); punchT = 0; }
          punchT += dt;
          const pose = m === 'walking' ? { walk: 1 }
            : m === 'chasing' ? { run: 1 }
              : m === 'crouching' ? { work: 1 }
                : m === 'caught' ? (punchT < 0.9 ? { punch: 1 } : { idle: 1 })
                  : { idle: 1 };
          blendTo(pose, dt);
        }
        lastMotor = m;
        body.position.copy(pos);
        body.quaternion.copy(turn);
        applyWeights();
        mixer.update(dt);
        model.updateMatrixWorld(true);
        // His head turns to where he is looking (scanning, or towards a noise from bed).
        turnBone(neck, Math.max(-1.1, Math.min(1.1, s.look * (inBed ? 1 : 0.8))));
      }

      // The fan: where he can see, while his eyes are open.
      const open = s.eyeHeight !== null && m !== 'caught';
      fan.visible = open;
      if (open) {
        const inBedView = inBed || getting;
        // Rebuilt only when his view changes size (sitting up in bed sees less far).
        const key = `${s.viewRange}:${s.viewAngle}`;
        if (fan.userData.key !== key) {
          fan.geometry.dispose();
          fan.geometry = new THREE.CircleGeometry(s.viewRange, 40, -s.viewAngle, 2 * s.viewAngle);
          fan.userData.key = key;
        }
        const eye = inBedView ? { x: BED_LIE.x - 0.55, z: BED_LIE.z } : { x: s.x, z: s.z };
        fanPivot.position.set(eye.x, 0.02, eye.z);
        fanPivot.rotation.y = s.heading + s.look;
        fanMat.color.setRGB(1, 0.82 - 0.5 * s.spotted, 0.48 - 0.3 * s.spotted);
        fanMat.opacity = (inBedView ? 0.1 : 0.16) + 0.22 * s.spotted;
      }

      // The icon over his head.
      const sleeping = inBed && (s.stage === 'asleep' || s.stage === 'stirring');
      const alarmed = s.seesCat || m === 'chasing' || m === 'caught';
      icon.material.map = alarmed ? icons.alarm : sleeping ? icons.sleep : icons.wonder;
      const headPos = new THREE.Vector3();
      if (headTop) headTop.getWorldPosition(headPos);
      else headPos.set(pos.x, pos.y + 0.3, pos.z);
      const bob = sleeping ? Math.sin(time * 1.6) * 0.05 : alarmed ? Math.abs(Math.sin(time * 9)) * 0.04 : 0;
      icon.position.set(headPos.x, headPos.y + 0.32 + bob, headPos.z);
      icon.material.opacity = sleeping ? 0.75 : 1;
      icon.scale.setScalar(alarmed ? 0.4 : 0.3);
    },
  };
}
