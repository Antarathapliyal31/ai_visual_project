// The round (D): the game loop's states, the night's clock and the score.
//
//   menu -> playing <-> paused
//             |-> caught   the owner caught the cat (loss)
//             |-> won      dawn, with the night's chaos goal reached
//             '-> quiet    dawn, but not enough chaos: a quiet night (not a win)
//   caught / won / quiet -> playing (play again) or menu
//
// Chaos is the score: every prop knocked over and every one broken, from
// tuning.game.points. Each night has a goal (start({ goal })); surviving
// until dawn wins only if the chaos reached it. A goal of 0 (the default)
// makes every dawn a win, as before. No Three.js, no DOM: the page draws it.

export function createRound(tuning) {
  const cfg = tuning.game;
  const r = {
    state: 'menu',
    timeLeft: cfg.roundSeconds,
    elapsed: 0,
    knocked: 0,
    broken: 0,
    score: 0,
    goal: 0,
    best: 0,
    endedBy: null, // 'caught' | 'dawn'
  };

  const score = () => r.knocked * cfg.points.knocked + r.broken * cfg.points.broken;

  function end(state) {
    r.state = state;
    r.endedBy = state === 'caught' ? 'caught' : 'dawn';
    r.best = Math.max(r.best, r.score);
  }

  return {
    get state() { return r.state; },
    get timeLeft() { return r.timeLeft; },
    get elapsed() { return r.elapsed; },
    get score() { return r.score; },
    get goal() { return r.goal; },
    /** The chaos so far is enough to win at dawn. */
    get goalReached() { return r.score >= r.goal; },
    get best() { return r.best; },
    get knocked() { return r.knocked; },
    get broken() { return r.broken; },
    get endedBy() { return r.endedBy; },
    get playing() { return r.state === 'playing'; },

    /** A fresh night, with the chaos it takes to win it. */
    start({ goal = 0 } = {}) {
      Object.assign(r, { state: 'playing', timeLeft: cfg.roundSeconds, elapsed: 0, knocked: 0, broken: 0, score: 0, goal, endedBy: null });
    },
    pause() { if (r.state === 'playing') r.state = 'paused'; },
    resume() { if (r.state === 'paused') r.state = 'playing'; },
    toMenu() { r.state = 'menu'; },
    /** Carry over a best score saved elsewhere (the page keeps it between visits). */
    setBest(best) { r.best = Math.max(r.best, best || 0); },

    /** Advance the clock; dawn ends the round, won if the chaos reached the goal. */
    update(dt) {
      if (r.state !== 'playing') return;
      r.elapsed = Math.min(cfg.roundSeconds, r.elapsed + dt);
      r.timeLeft = cfg.roundSeconds - r.elapsed;
      if (r.timeLeft === 0) end(r.score >= r.goal ? 'won' : 'quiet');
    },
    /** What the cat has done so far; counts only go up. */
    tally(knocked, broken) {
      if (r.state !== 'playing') return;
      r.knocked = Math.max(r.knocked, knocked);
      r.broken = Math.max(r.broken, broken);
      r.score = score();
    },
    caught() { if (r.state === 'playing') end('caught'); },
  };
}
