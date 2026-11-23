import { describe, it, expect } from 'vitest';
import { contentsOf, goalFor, starsFor, describe as say, validateMissions, defaultMissions, createMissionTracker } from '../../src/core/missions.js';
import { createPhysicsWorld } from '../../src/physics/world.js';
import { createCat } from '../../src/player/cat.js';
import { createNoise } from '../../src/noise/index.js';
import { createOwner } from '../../src/ai/index.js';
import { LEVELS, loadLevel } from '../../src/levels/index.js';
import { MISSIONS } from '../../src/levels/missions.js';
import { validateLevel } from '../../src/levels/validate.js';
import { tuning } from '../../src/core/tuning.js';
import { freshTuning } from '../helpers/tuning.js';

/** A room's props, spawned and still at home, and what they are. */
function room(id = 'original') {
  const level = loadLevel(id);
  const physics = createPhysicsWorld({ ...(level.legacy ? {} : { room: { boxes: level.boxes, occluders: level.occluders } }), guard: false, fracture: false });
  level.spawnProps(physics);
  return { level, physics, contents: contentsOf(level, physics.props) };
}
const fakeOwner = (state, isUp = true) => ({ state: { x: 0, z: 0, seesCat: false, caught: false, motor: 'walking', ...state }, isUp });

describe('what a room holds', () => {
  it('knows which piece each prop starts on', () => {
    const { contents } = room();
    expect(contents.count('plate', 'desk')).toBe(5);
    expect(contents.count('monitor', 'desk')).toBe(1);
    expect(contents.count('book', 'bookshelf')).toBeGreaterThan(20);
    expect(contents.count('pillow', 'bed')).toBe(1);
    expect(contents.count('breakable')).toBe(8);
    expect(contents.props.some((p) => p.piece === null)).toBe(true); // clutter on the floor
  });

  it('sets the goal at a share of all the chaos the room could make', () => {
    const { contents } = room();
    // 70 props x 10 + 8 plates and mugs x 40 = 1020; a quarter, to the nearest 10.
    expect(goalFor(contents, tuning)).toBe(260);
  });

  it('gives one star for a won night and one per mission, none for a lost one', () => {
    expect(starsFor({ won: true, done: 0 })).toBe(1);
    expect(starsFor({ won: true, done: 2 })).toBe(3);
    expect(starsFor({ won: false, done: 2 })).toBe(0);
  });
});

describe('missions in words', () => {
  it('says each kind of mission from its data', () => {
    expect(say({ type: 'break', kind: 'plate', count: 3, piece: 'desk' })).toBe('Break 3 plates from the desk');
    expect(say({ type: 'break', kind: 'any', count: 1 })).toBe('Break a plate or mug');
    expect(say({ type: 'knock', kind: 'monitor', count: 1, piece: 'desk' })).toBe('Knock the monitor off the desk');
    expect(say({ type: 'knock', kind: 'clock', count: 1 })).toBe('Knock over an alarm clock');
    expect(say({ type: 'knock', kind: 'book', count: 5, piece: 'bookshelf' })).toBe('Knock 5 books off the bookshelf');
    expect(say({ type: 'clear', piece: 'nightstand' })).toBe('Clear everything off the nightstand');
    expect(say({ type: 'hide', spot: 'underBed' })).toBe("Stay under the bed while he's right next to it");
    expect(say({ type: 'sneak' })).toMatch(/within a metre of him/);
  });
});

describe('checking missions against a room', () => {
  const { contents } = room();
  const ok = (m) => validateMissions([m, { type: 'sneak', title: 'Close call' }], contents, ['underBed']);

  it('accepts missions the room can hold', () => {
    expect(ok({ type: 'break', kind: 'plate', count: 3, piece: 'desk', title: 'Plate smash' })).toEqual([]);
    expect(ok({ type: 'clear', piece: 'nightstand', title: 'Bedside sweep' })).toEqual([]);
    expect(ok({ type: 'hide', spot: 'underBed', title: 'Under his nose' })).toEqual([]);
    expect(validateMissions(defaultMissions(contents, ['underBed']), contents, ['underBed'])).toEqual([]);
  });

  it('says what is wrong, in words a model can act on', () => {
    expect(ok({ type: 'break', kind: 'plate', count: 6, piece: 'desk', title: 'Too many' })[0]).toMatch(/only 5 plates on the desk; ask for at most 3/);
    expect(ok({ type: 'knock', kind: 'monitor', count: 1, piece: 'coffeeTable', title: 'Wrong place' })[0]).toMatch(/no monitors on the coffee table/);
    expect(ok({ type: 'knock', kind: 'lamp', count: 1, piece: 'diningTable', title: 'No table' })[0]).toMatch(/no dining table with things on it/);
    expect(ok({ type: 'clear', piece: 'bookshelf', title: 'Too much' })[0]).toMatch(/too many to clear/);
    expect(ok({ type: 'hide', spot: 'underTable', title: 'No table' })[0]).toMatch(/not a hiding place he can't see into/);
    expect(validateMissions([{ type: 'sneak', title: 'A' }, { type: 'sneak', title: 'B' }], contents, [])[0]).toMatch(/different jobs/);
    expect(validateMissions([{ type: 'sneak', title: 'Only one' }], contents, [])).toEqual(['Give exactly two missions.']);
  });

  it('every room in the game has two missions it can hold', () => {
    for (const spec of LEVELS) {
      const { contents: c } = room(spec.id);
      const safe = validateLevel(spec, { settle: false }).metrics.safeSpotIds;
      const missions = MISSIONS[spec.id]?.missions ?? defaultMissions(c, safe);
      expect(validateMissions(missions, c, safe), spec.id).toEqual([]);
    }
  });
});

describe('following a night', () => {
  it('counts knocked props, clears and breaks as they happen', () => {
    const { contents } = room();
    const monitor = contents.props.find((p) => p.kind === 'monitor');
    const onNightstand = contents.props.filter((p) => p.piece === 'nightstand');
    const plates = contents.props.filter((p) => p.kind === 'plate' && p.piece === 'desk');
    const t = createMissionTracker([
      { type: 'knock', kind: 'monitor', count: 1, piece: 'desk', title: 'Screen time' },
      { type: 'clear', piece: 'nightstand', title: 'Bedside sweep' },
      { type: 'break', kind: 'plate', count: 2, piece: 'desk', title: 'Plate smash' },
    ], contents);
    const knocked = new Set();
    expect(t.frame({ knocked })).toEqual([]);
    knocked.add(monitor.body);
    expect(t.frame({ knocked }).map((m) => m.title)).toEqual(['Screen time']);
    knocked.add(onNightstand[0].body); // one of its things still on it
    t.frame({ knocked });
    expect(t.list()[1]).toMatchObject({ done: false, progress: 1, need: onNightstand.length });
    for (const p of onNightstand) knocked.add(p.body);
    t.onBroken(plates[0].body);
    t.onBroken(plates[1].body);
    expect(t.frame({ knocked }).map((m) => m.title).sort()).toEqual(['Bedside sweep', 'Plate smash']);
    expect(t.done).toBe(3);
  });

  it('counts sneaking up on him only while he is up and does not see the cat', () => {
    const { contents } = room();
    const t = createMissionTracker([{ type: 'sneak', title: 'Close call' }], contents);
    const catAt = { x: 0.5, y: 0.12, z: 0 };
    t.frame({ knocked: new Set(), catAt, owner: fakeOwner({ seesCat: true }) });
    t.frame({ knocked: new Set(), catAt, owner: fakeOwner({}, false) });
    expect(t.done).toBe(0);
    t.frame({ knocked: new Set(), catAt, owner: fakeOwner({}) });
    expect(t.done).toBe(1);
  });

  it('counts hiding once he has been right next to the spot with the cat in it, unseen, and moved off', () => {
    const { level, contents } = room();
    const bed = level.hidingVolumes.find((v) => v.id === 'underBed');
    const under = { x: (bed.min[0] + bed.max[0]) / 2, y: 0.12, z: (bed.min[2] + bed.max[2]) / 2 };
    const beside = { x: under.x, z: bed.max[2] + 0.6 }; // 60 cm off the bed's side
    const away = { x: 2.5, z: 2.5 };
    const hide = () => createMissionTracker([{ type: 'hide', spot: 'underBed', title: 'Under his nose' }], contents);
    const frame = (t, at, { catAt = under, isUp = true, ...state } = {}) =>
      t.frame({ knocked: new Set(), catAt, owner: fakeOwner({ ...at, ...state }, isUp) });

    const t = hide();
    frame(t, away);
    frame(t, away);
    expect(t.done).toBe(0); // across the room: nothing
    frame(t, beside);
    expect(t.done).toBe(0); // right there: not yet
    frame(t, away);
    expect(t.done).toBe(1); // and gone again

    const seen = hide();
    frame(seen, beside, { seesCat: true });
    frame(seen, away, { motor: 'chasing' });
    expect(seen.done).toBe(0);

    const leftFirst = hide(); // the cat slips out while he is still there
    frame(leftFirst, beside);
    frame(leftFirst, beside, { catAt: away });
    frame(leftFirst, away, { catAt: away });
    expect(leftFirst.done).toBe(0);

    const inBed = hide(); // lying in his bed is not being up and about
    frame(inBed, beside, { isUp: false, motor: 'inBed' });
    frame(inBed, away);
    expect(inBed.done).toBe(0);
  });

  it('in a real night: he gets up and walks about by the bed with the cat under it, never looks under it, and the mission is done', () => {
    const level = loadLevel('original');
    const t = freshTuning();
    const physics = createPhysicsWorld({ tuning: t });
    const props = level.spawnProps(physics);
    const contents = contentsOf(level, physics.props);
    const bed = level.hidingVolumes.find((v) => v.id === 'underBed');
    const cat = createCat(physics, { position: [-2.4, t.cat.radius + 0.001, -0.1] });
    let owner;
    const noise = createNoise(physics, { listener: () => owner.head(), onNoise: (n) => owner.hear(n) });
    owner = createOwner(physics, { cat, wake: noise.meter });
    const tracker = createMissionTracker([{ type: 'hide', spot: 'underBed', title: 'Under his nose' }], contents);
    expect(props.all.length).toBeGreaterThan(0);
    noise.meter.raise(0.85);
    owner.hear({ position: { x: -2.0, y: 0.05, z: 0.4 }, loudness: 0.9, heardLoudness: 0.9 });
    let crouched = false;
    for (let i = 0; i < 45 * 120 && !tracker.done; i++) {
      physics.step();
      if (owner.state.motor === 'crouching') crouched = true;
      tracker.frame({ knocked: new Set(), catAt: cat.body.position, owner });
    }
    expect(crouched).toBe(false);
    expect(tracker.done).toBe(1);
    expect(owner.state.caught).toBe(false);
    expect(bed).toBeTruthy();
  });
});

describe('a model writing missions', () => {
  it("gets the room's contents, and the reasons back until its missions can be done", async () => {
    const { generateMissions } = await import('../../src/levels/generate.js');
    const { MISSIONS_SCHEMA } = await import('../../src/levels/missionPrompt.js');
    const { contents } = room();
    const answers = [
      { missions: [{ type: 'break', title: 'Plate party', kind: 'plate', count: 9, piece: 'desk' }, { type: 'sneak', title: 'Close call' }] },
      { missions: [{ type: 'break', title: 'Plate party', kind: 'plate', count: 3, piece: 'desk' }, { type: 'hide', title: 'Under his nose', spot: 'underBed' }] },
    ];
    const turns = [];
    const ask = async (turn) => {
      turns.push(structuredClone(turn));
      const text = JSON.stringify(answers.shift());
      return { text, model: 'fake', stop: 'done', assistant: { role: 'assistant', content: text } };
    };
    const out = await generateMissions({ ask, spec: { name: 'The original', blurb: 'The studio.' }, contents, safeSpots: ['underBed'], goal: 280 });
    expect(out.ok).toBe(true);
    expect(out.missions[1]).toMatchObject({ type: 'hide', spot: 'underBed' });
    expect(out.rounds[0].errors[0]).toMatch(/only 5 plates on the desk/);
    expect(turns[0].schema).toEqual(MISSIONS_SCHEMA);
    expect(turns[0].messages[0].content).toContain('- on the desk (desk): 5 plates (plate)');
    expect(turns[0].messages[0].content).toContain('under the bed (underBed)');
    expect(turns[1].messages.at(-1).content).toMatch(/can't be done in this room/);
  });
});

