// The owner (C): wakes in stages from the noise, gets out of bed, searches,
// checks hiding spots, chases the cat and catches it.
//
// Built around Christina's state machine and behaviour tree
// (ownerStateMachine.js, behaviorTree.js), which turn the wake level and the
// last noise into a stage (asleep, stirring, sittingUp, standing, awake) and
// an action (idle, investigate, search, checkHidingSpot, returnToBed). This
// module carries the actions out in the room:
//
//  - In bed he hears from his pillow. Sitting up he can see down the bed, and
//    seeing the cat from there wakes him fast.
//  - Standing, he gets up on the north side of the bed and walks A* paths
//    (navigation.js) as a kinematic body, so props and the cat are pushed
//    aside but nothing static is walked through.
//  - search: walk to the noise, look around, then check the hiding spot
//    nearest to it. checkHidingSpot: crouch at the spot's check point and look
//    in with a low eye (A's hiding volumes); the bed skirt still hides a cat
//    under the bed, the desk does not. returnToBed: walk back and wait by the
//    bed until the wake meter has calmed down, then lie down.
//  - Sight (vision.js) while he is up: the cat in view fills a "spotted"
//    meter and he chases it; kept in view long enough (spotTime, quicker up
//    close, slower at the edge of his view), or seen within catchRadius, it is
//    caught. Out of view the meter drains, and after a
//    while he searches where he last saw it.
//
// Christina's state machine also moves its own `position`; that is ignored
// here, the body is the owner's position (see the code review in the README).
//
// Headings follow the cat's: h faces (cos h, 0, -sin h). No Three.js.

import * as CANNON from 'cannon-es';
import { OWNER, PROP, DEBRIS, CAT } from '../core/groups.js';
import { HIDING_VOLUMES } from '../collision/index.js';
import { createOwnerAI } from './ownerStateMachine.js';
import { createNavigator } from './navigation.js';
import { seesCat } from './vision.js';
import { BED_HEAD, BED_LIE, BED_SIT_EYE, IN_BED_FACING, BEDSIDE } from './home.js';

const UP_STAGES = new Set(['standing', 'awake']);
const UP_MOTORS = new Set(['walking', 'scanning', 'crouching', 'waiting', 'chasing']);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const headingTo = (from, to) => Math.atan2(-(to.z - from.z), to.x - from.x);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const VISION_EVERY = 4; // substeps between sight checks (30 Hz at 120 Hz)

/**
 * @param {ReturnType<import('../physics/world.js').createPhysicsWorld>} physics
 * @param {object} opts
 * @param {ReturnType<import('../player/cat.js').createCat>} [opts.cat]
 * @param {{level: number, raise: (to: number) => void}} opts.wake  the noise model's meter
 * @param {() => void} [opts.onCaught]
 * @param {(stage: string, previous: string) => void} [opts.onStage]
 */
export function createOwner(physics, opts) {
  const cfg = physics.tuning.owner;
  const { cat, wake } = opts;
  const brain = createOwnerAI({ thresholds: cfg.thresholds, bedPosition: [BED_LIE.x, 0, BED_LIE.z] });
  const nav = createNavigator({ radius: cfg.radius, height: cfg.height });

  // Never asleep: a sleeping body ignores the velocities set to walk it.
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, allowSleep: false, collisionFilterGroup: OWNER, collisionFilterMask: 0 });
  body.addShape(new CANNON.Cylinder(cfg.radius, cfg.radius, cfg.height, 12));
  body.userData = { kind: 'owner' };
  physics.world.addBody(body);

  const state = {
    motor: 'inBed',     // inBed, gettingUp, walking, scanning, crouching, waiting, chasing, lyingDown, caught
    stage: 'asleep',
    action: 'idle',
    x: BED_LIE.x, z: BED_LIE.z, heading: IN_BED_FACING,
    look: 0,            // extra yaw of his gaze: scanning, or turning his head in bed
    timer: 0,           // time left in a timed motor state
    progress: 0,        // 0..1 through getting up or lying down, for the renderer
    path: [],
    purpose: null,      // why he is walking: 'noise', 'hide', 'bed', 'cat'
    spot: null,         // the hiding volume he is checking
    checked: new Set(), // hiding spots checked since he last got up
    noise: null,        // where the noise he is following came from
    seesCat: false,
    catDistance: Infinity,
    spotted: 0,         // 0..1; full means caught
    caught: false,
    lastSeen: null,
    lostFor: 0,
    eyeHeight: null,    // null while his eyes are closed
    viewRange: 0,
    viewAngle: cfg.visionAngle,
    clock: 0,
  };
  let substeps = 0, repath = 0;

  function place(x, z, heading = state.heading) {
    body.position.set(x, cfg.height / 2, z);
    body.velocity.set(0, 0, 0);
    body.aabbNeedsUpdate = true;
    state.x = x;
    state.z = z;
    state.heading = heading;
  }
  const solid = (on) => { body.collisionFilterMask = on ? (PROP | DEBRIS | CAT) : 0; };
  place(BED_LIE.x, BED_LIE.z, IN_BED_FACING);

  const isUp = () => UP_MOTORS.has(state.motor);
  const here = () => ({ x: state.x, z: state.z });

  /** The hiding spot whose check point is nearest p, skipping the ones checked already. */
  function nearestSpot(p, within = Infinity) {
    let best = null, bestD = within;
    for (const v of HIDING_VOLUMES) {
      if (state.checked.has(v.id)) continue;
      const d = flat({ x: v.checkFrom[0], z: v.checkFrom[2] }, p);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function walkTo(goal, purpose) {
    state.path = nav.path(here(), goal) ?? [nav.inside(goal)];
    state.purpose = purpose;
    state.motor = purpose === 'cat' ? 'chasing' : 'walking';
    state.look = 0;
  }

  function checkSpot(v) {
    state.spot = v;
    walkTo({ x: v.checkFrom[0], z: v.checkFrom[2] }, 'hide');
  }

  /** Between tasks while up: the behaviour tree's action says what next. */
  function decide() {
    const target = brain.getTarget();
    const at = target ? { x: target[0], z: target[2] } : null;
    if ((state.action === 'search' || state.action === 'investigate') && at) {
      state.noise = at;
      return walkTo(at, 'noise');
    }
    if (state.action === 'checkHidingSpot') {
      const v = nearestSpot(at ?? here());
      if (v) return checkSpot(v);
      brain.clearNoise();
    }
    return walkTo(BEDSIDE, 'bed');
  }

  /** The noise he was following has been dealt with. */
  function done() {
    brain.clearNoise();
    state.noise = null;
    state.action = brain.update(0, wake.level).action;
    decide();
  }

  /** Walk along the path; true once there. */
  function follow(dt, speed) {
    while (state.path.length && flat(state.path[0], here()) < 0.1) state.path.shift();
    if (!state.path.length) { body.velocity.set(0, 0, 0); return true; }
    const next = state.path[0];
    const err = wrap(headingTo(here(), next) - state.heading);
    const turn = cfg.turnRate * dt;
    state.heading = wrap(state.heading + Math.max(-turn, Math.min(turn, err)));
    // Turn on the spot first, then walk; never overshoot the point.
    const v = Math.min(Math.abs(err) < 0.9 ? speed * Math.cos(err) : 0, flat(next, here()) / dt);
    body.velocity.set(Math.cos(state.heading) * v, 0, -Math.sin(state.heading) * v);
    return false;
  }

  function faceTowards(p, dt) {
    const err = wrap(headingTo(here(), p) - state.heading);
    const turn = cfg.turnRate * dt;
    state.heading = wrap(state.heading + Math.max(-turn, Math.min(turn, err)));
  }

  function catchCat() {
    state.caught = true;
    state.motor = 'caught';
    state.spotted = 1;
    body.velocity.set(0, 0, 0);
    opts.onCaught?.();
  }

  // ------------------------------------------------------------- sight
  function look(dt) {
    state.eyeHeight = state.motor === 'inBed'
      ? (state.stage === 'sittingUp' ? cfg.sitEyeHeight : null)
      : state.motor === 'gettingUp' ? cfg.sitEyeHeight + (cfg.eyeHeight - cfg.sitEyeHeight) * state.progress
        : state.motor === 'lyingDown' || state.motor === 'caught' ? null
          : state.motor === 'crouching' ? cfg.crouchEyeHeight : cfg.eyeHeight;
    const inBed = state.motor === 'inBed' || state.motor === 'gettingUp';
    state.viewRange = inBed ? cfg.sitVisionRange : cfg.visionRange;
    if (!cat) return;
    if (substeps % VISION_EVERY === 0) {
      if (state.eyeHeight === null) {
        state.seesCat = false;
      } else {
        const base = inBed ? BED_SIT_EYE : { x: state.x + Math.cos(state.heading) * 0.12, z: state.z - Math.sin(state.heading) * 0.12 };
        const eye = { x: base.x, y: state.eyeHeight, z: base.z };
        const r = seesCat(physics.raycast, eye, state.heading + state.look, cat, { range: state.viewRange, angle: cfg.visionAngle, skip: [body] });
        state.seesCat = r.seen;
        state.catDistance = r.distance;
      }
    }
    const c = cat.body.position;
    if (state.seesCat) {
      state.lastSeen = { x: c.x, z: c.z };
      state.lostFor = 0;
      if (isUp()) {
        wake.raise(1);
        // Up close he is sure at once; at the edge of his view it takes longer.
        const sure = Math.min(1.5, Math.max(0.5, 1.5 - state.catDistance / cfg.visionRange));
        state.spotted = Math.min(1, state.spotted + (dt / cfg.spotTime) * sure);
        // Crouched at a hiding spot he keeps looking in; anywhere else he goes for it.
        if (state.motor === 'crouching') state.timer = Math.max(state.timer, 0.3);
        else if (state.motor !== 'chasing') walkTo(state.lastSeen, 'cat');
        if (state.spotted >= 1 || flat(c, here()) <= cfg.catchRadius) catchCat();
      } else {
        // From bed, what he sees wakes him fast.
        wake.raise(wake.level + cfg.sightWake * dt);
      }
    } else {
      state.spotted = Math.max(0, state.spotted - dt / (cfg.spotTime * 1.5));
      state.lostFor += dt;
    }
  }

  // ------------------------------------------------------------- update
  function update(dt) {
    substeps++;
    state.clock += dt;
    state.x = body.position.x;
    state.z = body.position.z;
    if (state.caught) { body.velocity.set(0, 0, 0); return; }

    const before = state.stage;
    const out = brain.update(dt, wake.level);
    state.stage = out.state;
    state.action = out.action;
    if (state.stage !== before) opts.onStage?.(state.stage, before);

    look(dt);
    if (state.caught) return;

    switch (state.motor) {
      case 'inBed': {
        body.velocity.set(0, 0, 0);
        // Stirring or sitting up, he turns his head towards the noise.
        const t = brain.getTarget();
        const want = t && state.stage !== 'asleep' ? wrap(headingTo(BED_SIT_EYE, { x: t[0], z: t[2] }) - IN_BED_FACING) : 0;
        state.look += (Math.max(-1.2, Math.min(1.2, want)) - state.look) * Math.min(1, dt * 3);
        if (UP_STAGES.has(state.stage)) {
          state.motor = 'gettingUp';
          state.timer = cfg.getUpTime;
          state.progress = 0;
          state.checked.clear();
        }
        break;
      }
      case 'gettingUp':
        state.timer -= dt;
        state.progress = Math.min(1, 1 - state.timer / cfg.getUpTime);
        if (state.timer <= 0) {
          place(BEDSIDE.x, BEDSIDE.z, 0); // facing the room
          solid(true);
          state.look = 0;
          if (state.seesCat && state.lastSeen) walkTo(state.lastSeen, 'cat');
          else decide();
        }
        break;
      case 'walking':
        // A new job from the tree (a noise while going back to bed) replaces the walk home.
        if (state.purpose === 'bed' && (state.action === 'search' || state.action === 'checkHidingSpot')) { decide(); break; }
        if (follow(dt, cfg.walkSpeed)) {
          if (state.purpose === 'noise') { state.motor = 'scanning'; state.timer = cfg.scanTime; }
          else if (state.purpose === 'hide') { state.motor = 'crouching'; state.timer = cfg.crouchTime; }
          else { state.motor = 'waiting'; state.timer = 0; }
        }
        break;
      case 'scanning': {
        body.velocity.set(0, 0, 0);
        state.timer -= dt;
        state.look = 1.1 * Math.sin((1 - state.timer / cfg.scanTime) * Math.PI * 2);
        if (state.timer <= 0) {
          state.look = 0;
          // Search nearby: the hiding spot closest to the noise, if it is close.
          const v = nearestSpot(state.noise ?? here(), 3.0);
          if (v) checkSpot(v);
          else done();
        }
        break;
      }
      case 'crouching': {
        body.velocity.set(0, 0, 0);
        const v = state.spot;
        const centre = { x: (v.min[0] + v.max[0]) / 2, z: (v.min[2] + v.max[2]) / 2 };
        faceTowards(centre, dt);
        state.timer -= dt;
        if (state.timer <= 0) {
          state.checked.add(v.id);
          state.spot = null;
          done();
        }
        break;
      }
      case 'waiting':
        // By the bed, looking around, until the meter calms down; any new job sends him off again.
        body.velocity.set(0, 0, 0);
        faceTowards({ x: 0, z: -1.0 }, dt);
        state.timer += dt;
        state.look = 0.6 * Math.sin(state.timer * 0.9);
        if (state.action === 'search' || state.action === 'checkHidingSpot') decide();
        else if (state.stage === 'asleep') {
          state.motor = 'lyingDown';
          state.timer = cfg.lieDownTime;
          state.progress = 0;
          state.look = 0;
          solid(false);
        }
        break;
      case 'chasing': {
        repath -= dt;
        if (state.seesCat && repath <= 0) {
          state.path = nav.path(here(), state.lastSeen) ?? [nav.inside(state.lastSeen)];
          repath = cfg.repathTime;
        }
        const arrived = follow(dt, cfg.chaseSpeed);
        if (!state.seesCat && (arrived || state.lostFor > 2.5)) {
          // Lost it: search where it was last seen.
          state.noise = state.lastSeen;
          if (arrived) { state.motor = 'scanning'; state.timer = cfg.scanTime; }
          else walkTo(state.lastSeen, 'noise');
        }
        break;
      }
      case 'lyingDown':
        state.timer -= dt;
        state.progress = Math.min(1, 1 - state.timer / cfg.lieDownTime);
        if (state.timer <= 0) {
          place(BED_LIE.x, BED_LIE.z, IN_BED_FACING);
          state.motor = 'inBed';
          state.progress = 0;
        }
        break;
      default:
        break;
    }
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), state.heading);
  }

  /**
   * A sound reached him (a NoiseEvent from the noise model). Sounds he makes
   * himself, or right at his feet, don't send him anywhere new.
   */
  function hear(n) {
    if (state.caught) return;
    const impact = n.impact;
    if (impact && (impact.bodyA === body || impact.bodyB === body)) return;
    brain.onNoise({ loudness: Math.min(1, n.heardLoudness), position: [n.position.x, n.position.y, n.position.z] });
    const far = flat(n.position, here()) > 1.5;
    if (isUp() && state.motor !== 'chasing' && state.motor !== 'crouching' && far && n.heardLoudness >= cfg.hearRedirect) {
      state.noise = { x: n.position.x, z: n.position.z };
      walkTo(state.noise, 'noise');
    }
  }

  /** Where he hears from: his pillow in bed, his head when he is up. */
  function head() {
    if (state.motor === 'inBed' || state.motor === 'gettingUp' || state.motor === 'lyingDown') return BED_HEAD;
    return { x: state.x, y: cfg.height - 0.1, z: state.z };
  }

  const unhook = physics.onBeforeStep(update);
  function dispose() {
    unhook();
    if (physics.world.bodies.includes(body)) physics.world.removeBody(body);
  }

  return { body, state, brain, nav, hear, head, update, dispose, get isUp() { return isUp(); } };
}
