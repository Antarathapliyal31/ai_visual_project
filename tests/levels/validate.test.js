import { describe, it, expect } from 'vitest';
import { validateLevel } from '../../src/levels/validate.js';
import { feedbackPrompt, freeWall, asExample } from '../../src/levels/prompt.js';
import { EXAMPLE_LEVELS, loadLevel } from '../../src/levels/index.js';

// The validator's messages are what a model gets back when its room fails, so
// they must say where things are and what to change.
const quick = (spec) => validateLevel({ cat: { x: 0, z: 1 }, ...spec }, { settle: false });
const moving = asExample(EXAMPLE_LEVELS.find((l) => l.id === 'moving-day'));

describe('what the validator tells a designer', () => {
  it('gives the range a piece outside the room must move into', () => {
    const r = quick({ pieces: [{ item: 'bed', wall: 'north', at: -2.9 }, { item: 'diningTable', x: 3.2, z: 0, turn: 1 }] });
    const [bed, table] = r.errors.filter((e) => e.code === 'out-of-room').map((e) => e.message);
    expect(bed).toMatch(/"at" must be between -2\.69 and 2\.69/);
    expect(table).toMatch(/centre must be within x -3\.03\.\.3\.03, z -2\.42\.\.2\.42/);
  });

  it('says where two overlapping pieces are, and to move the free-standing or smaller one', () => {
    const r = quick({ pieces: [{ item: 'bed', wall: 'north', at: 1.5 }, { item: 'boxStack', x: 1.4, z: -0.8, turn: 0 }, { item: 'windowSill', wall: 'north', at: 0.5 }] });
    const msgs = r.errors.filter((e) => e.code === 'overlap').map((e) => e.message);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatch(/covers x 0\.69\.\.2\.31, z -3\.00\.\.-0\.89/);
    expect(msgs[0]).toMatch(/Move the boxStack clear of the bed/);
    expect(msgs[1]).toMatch(/Move the windowSill clear of the bed/);
  });

  it('names what stands where the owner crouches to look under the desk', () => {
    const r = validateLevel({ ...moving, pieces: moving.pieces.map((p) => (p.item === 'chair' ? { ...p, x: -0.3 } : p)) }, { settle: false });
    const e = r.errors.find((x) => x.code === 'owner-cant-reach');
    expect(e.message).toMatch(/underDesk/);
    expect(e.message).toMatch(/in the way there: chair \(x -0\.3, z -1\.72, turn 0\) covers/);
  });

  it('tells which way an open box faces and which turn would hide it', () => {
    const r = validateLevel({ ...moving, pieces: moving.pieces.map((p) => (p.item === 'cardboardBox' && p.x === 1.4 ? { ...p, turn: 2 } : p)) }, { settle: false });
    const e = r.errors.find((x) => x.code === 'not-hidden');
    expect(e.message).toMatch(/its opening faces north \(-z\)/);
    expect(e.message).toMatch(/turn 0 would face the wall 1\.30 m away/);
  });

  it('sends back a floor plan and the free stretches of wall with the errors', () => {
    const r = validateLevel({ ...moving, pieces: moving.pieces.map((p) => (p.item === 'chair' ? { ...p, x: -0.3 } : p)) }, { settle: false });
    const text = feedbackPrompt(r);
    expect(text).toContain('- desk (north wall, at 0): x -1.20..1.20, z -3.00..-2.20');
    expect(text).toContain('- north wall: x -3.50..-1.20, x 1.20..1.60, x 2.20..2.50');
    expect(text).toMatch(/keep everything else where it is/);
    // Every wall is listed, even one with nothing free.
    expect(freeWall(loadLevel(EXAMPLE_LEVELS[0]))).toHaveLength(4);
  });
});
