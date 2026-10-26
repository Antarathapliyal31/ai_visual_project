// The round (D): the game loop's states, the night's clock and the score.
//
//   menu -> playing <-> paused
//             |-> caught   the owner caught the cat (loss)
//             '-> won      the night ran out before he did (dawn)
//   caught / won -> playing (play again) or menu
//
// Chaos is the score: every prop knocked over and every one broken, from
// tuning.game.points. No Three.js, no DOM: the page draws it.

export function createRound(tuning) {
  const cfg = tuning.game;
  const r = {
    state: 'menu',
    timeLeft: cfg.roundSeconds,
    elapsed: 0,
    knocked: 0,
    broken: 0,
    score: 0,
    best: 0,
    endedBy: null, // 'caught' | 'dawn'
  };

  const score = () => r.knocked * cfg.points.knocked + r.broken * cfg.points.broken;

  function end(state) {
    r.state = state;
    r.endedBy = state === 'won' ? 'dawn' : 'caught';
    r.best = Math.max(r.best, r.score);
  }

  return {
    get state() { return r.state; },
    get timeLeft() { return r.timeLeft; },
    get elapsed() { return r.elapsed; },
    get score() { return r.score; },
    get best() { return r.best; },
    get knocked() { return r.knocked; },
    get broken() { return r.broken; },
    get endedBy() { return r.endedBy; },
    get playing() { return r.state === 'playing'; },

    /** A fresh night. */
    start() {
      Object.assign(r, { state: 'playing', timeLeft: cfg.roundSeconds, elapsed: 0, knocked: 0, broken: 0, score: 0, endedBy: null });
    },
    pause() { if (r.state === 'playing') r.state = 'paused'; },
    resume() { if (r.state === 'paused') r.state = 'playing'; },
    toMenu() { r.state = 'menu'; },
    /** Carry over a best score saved elsewhere (the page keeps it between visits). */
    setBest(best) { r.best = Math.max(r.best, best || 0); },

    /** Advance the clock; dawn ends the round. */
    update(dt) {
      if (r.state !== 'playing') return;
      r.elapsed = Math.min(cfg.roundSeconds, r.elapsed + dt);
      r.timeLeft = cfg.roundSeconds - r.elapsed;
      if (r.timeLeft === 0) end('won');
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
