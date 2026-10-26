import { describe, it, expect } from 'vitest';
import { createRound } from '../../src/core/round.js';
import { freshTuning } from '../helpers/tuning.js';

const t = freshTuning((x) => { x.game.roundSeconds = 10; x.game.points = { knocked: 10, broken: 40 }; });

describe('round', () => {
  it('starts at the menu and only runs the clock while playing', () => {
    const r = createRound(t);
    expect(r.state).toBe('menu');
    r.update(5);
    expect(r.timeLeft).toBe(10);
    r.start();
    expect(r.state).toBe('playing');
    r.update(4);
    expect(r.timeLeft).toBeCloseTo(6, 9);
    r.pause();
    r.update(4);
    expect(r.state).toBe('paused');
    expect(r.timeLeft).toBeCloseTo(6, 9);
    r.resume();
    r.update(1);
    expect(r.timeLeft).toBeCloseTo(5, 9);
  });

  it('is won at dawn, when the night runs out', () => {
    const r = createRound(t);
    r.start();
    r.update(10.5);
    expect(r.state).toBe('won');
    expect(r.endedBy).toBe('dawn');
    expect(r.timeLeft).toBe(0);
  });

  it('is lost when the owner catches the cat, and nothing counts after that', () => {
    const r = createRound(t);
    r.start();
    r.tally(2, 1);
    r.caught();
    expect(r.state).toBe('caught');
    expect(r.endedBy).toBe('caught');
    r.tally(9, 9);
    r.update(20);
    expect(r.score).toBe(60);
    expect(r.state).toBe('caught');
  });

  it('scores chaos: knocked over and broken props, never going down', () => {
    const r = createRound(t);
    r.start();
    r.tally(3, 0);
    expect(r.score).toBe(30);
    r.tally(5, 2);
    expect(r.score).toBe(5 * 10 + 2 * 40);
    r.tally(4, 2); // something rolled back home: the count stays
    expect(r.knocked).toBe(5);
  });

  it('keeps the best score across rounds and starts each night fresh', () => {
    const r = createRound(t);
    r.setBest(70);
    r.start();
    r.tally(2, 0);
    r.caught();
    expect(r.best).toBe(70);
    r.start();
    expect(r.score).toBe(0);
    expect(r.timeLeft).toBe(10);
    r.tally(3, 2);
    r.update(11);
    expect(r.best).toBe(110);
    r.toMenu();
    expect(r.state).toBe('menu');
  });
});
