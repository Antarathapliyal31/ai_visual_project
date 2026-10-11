# Last One Awake

A 3D stealth game about a cat wrecking an apartment at 3 a.m. Every object is a real rigid body, every crash makes noise, noise wakes the owner, and once he's up he hunts you. Nothing about the destruction is scripted.

CS 549 — Computer Graphics & Visual Computing, Fall 2026 · Rutgers.
Group: Rushi Patel (leader), Dharm Patel, Antara Thapliyal, Christina Ross.

**Live build:** _(fill in after first Vercel deploy)_
**Mockup (previous Matter.js version):** https://lastoneawake.netlify.app/
**Repo:** https://github.com/Antarathapliyal31/ai_visual_project
**Current MVP:** on the `antara` branch, single file `last-one-awake-mvp.html` (open it in a browser)

---

## For teammates: read this first

This README is the source of truth for how we build the project. If anything you were told elsewhere contradicts it, this file wins. If you need a change here, open a PR against the README itself so everyone sees the new rule.

Three documents to know:
- **This file** — what the project is, how to run it, how the code is organised, who owns what
- **Assignment 2** (`docs/Assignment2_Last_One_Awake_v2.docx`) — the committed PRD, tech spec and MVP definition
- **Project plan** (`docs/Project_Plan_Team_Split.pdf`) — the four-workstream split, weekly schedule, risks and contracts

If you joined the team mid-week, read those two docs before writing any code.

---

## Pillars

Three course pillars, each anchored to real work in our code:

- **Physics & Dynamics.** Material table (ceramic, wood, paper, plastic, fabric, cat) drives friction, restitution, loudness, and break impulse. Solver iterations and sleep thresholds are tuned to keep a stack of five plates stable. We use `cannon-es` for integration and contact resolution.
- **Collision Detection.** Our own uniform spatial-grid broad phase plugged into `cannon-es`. Ray-vs-AABB and ray-vs-box queries drive the owner's line-of-sight and the cat's ledge checks. A swept-sphere tunneling guard, gated at 1 cm of motion per substep (about 1.2 m/s), stops fast swatted mugs from passing through thin shelves.
- **NPC AI / Behavior Trees.** Wake-state machine (asleep → stirring → sitting up → standing → awake) driven by the noise meter. Once standing, a behavior tree investigates the last noise, searches, checks hiding spots, and returns to bed.

The coupling: the solver's contact impulses are the input to the AI's perception. The two systems share one data path.

---

## What's built so far by Antara(as of Oct 11)

The MVP is a single HTML file on the `antara` branch (`last-one-awake-mvp.html`). It runs end to end: cat moves, bumps things, noise feeds the wake meter, owner wakes up and catches the cat. All built in Three.js + cannon-es, no engine.

**Working:**
- 3D studio apartment: floor, walls, desk with chair, bed with headboard, nightstand with lamp and alarm clock, bookshelf with books and plant, couch with cushions, coffee table with mugs, floor lamp, window with moonlight
- cannon-es physics at a fixed 120 Hz with substeps
- Material system (wood, ceramic, paper, floor) with per-pair friction and restitution
- Swattable knick-knacks that fall only when the cat bumps them
- Cat controller: car-style WASD / arrows, Space to jump, physics body with fixed rotation
- Noise model (D): log-scaled impulse × material loudness × distance attenuation → wake meter
- Wake-state animation: sleeping figure stirs, sits up, stands beside the bed
- Owner catch rule: once standing, walks via a staging waypoint toward the cat; within 0.9 m triggers "CAUGHT!" and a round-end banner
- Tunneling guard: swept-sphere test gated at 5 m/s
- HUD panel with FPS, bodies, pairs, physics step, three test readouts, wake bar, keys-held row
- Three automated test buttons (stacking, tunneling, coupling) with pass/fail banners
- Debug overlay: contact dots, toggles for debug and body sleeping, event log in bottom-left
- Live tuning panel: 9 sliders for noise and wake parameters, saved to localStorage, Reset / Copy JSON actions

---

## What's built so far by Dharm: collision layer (Workstream A, as of Oct 11)

The collision layer is on the `dharm` branch in `src/collision/`. It's plain JS on top of cannon-es with no Three.js, so it runs headless. **All of Workstream A's planned tasks are implemented, and the Tunneling proof passes.** Run `npm install && npm test` to see it: 56 tests across 9 files.

**Working:**
- **Static geometry store** (`staticGeometry.js`). The whole room as data (`STATIC_BOXES`), built once into STATIC bodies. It includes the bed-skirt `OCCLUDERS`, the `HIDING_VOLUMES` (under the bed, under the desk), the named `SURFACES` heights props spawn on, and invisible boundary walls on the cut-away sides so props can't roll off the floor.
- **Uniform grid broadphase** (`UniformGridBroadphase`). A cannon-es `Broadphase` subclass with `collisionPairs()` and `aabbQuery()`; the cell size comes from `tuning.js` (0.5 m). Across 1,000 random scenes it finds exactly the pairs the naive broadphase does. cannon's own `world.raycast*` keeps working with it.
- **`raycast(origin, dir, maxDist, mask)`**: returns `{hit, distance, point, normal, body}`, following the contract. It uses slab and ray-vs-box tests and walks the grid. It matches `world.raycastClosest` on 10,000 random rays.
- **Swept-sphere tunneling guard** (`createSweptGuard`). It runs after every substep and only clamps when discrete collision would actually fail, so resting stacks and sliding props are left alone.
- **Fracture** (`createFracture`). A plate breaks into 3 wedges, a mug into 2 shells plus its base. Pieces keep the parent's velocity and spin, conserving momentum. It's driven by `ImpactEvent`s.
- **Hiding helpers** (`hidingSpotAt`, `lineOfSight`). Hiding works through geometry, not a flag.
- **Overlay data** (`collisionDebugData`, `registerCollisionDebug`): occupied cells, candidate, broadphase and narrow-phase pairs, guard counters.
- **Live demo page** (`harness/collision-demo.html`): tunneling, sight and hiding, fracture, and 400-body broadphase views. Run `python3 -m http.server 8550` in the repo root and open `http://localhost:8550/harness/collision-demo.html`.

**Measured results:**
- **Tunneling, 12 m/s into the 2 cm shelf:** with the guard on, 0 of 100 swats pass through; with it off, 22 of 100 do. The failure speed is 12 m/s without the guard and above 100 m/s with it.
- **Five-plate stack, 60 s:** the plates end in identical positions with the guard on and off, with 0 clamps.
- **400 bodies:** while props are moving, the grid hands about 270 pairs to the narrowphase against about 1,400 for Naive, and the step drops from about 8 ms to about 5 ms. Once settled, every broadphase takes about 7–8 ms, because roughly 230 bodies never fall asleep. That's a sleep-tuning issue, not a broadphase one.

### Integration rules for other workstreams (read before using `src/collision/`)

Import everything from `src/collision/index.js`. These rules apply to people and AI assistants alike:

1. **Fracture must flush between steps.** Feed every `ImpactEvent` to `fracture.onImpact(event)`, then call `fracture.flush()` **after `world.step()` returns**, never inside a cannon `preStep`/`postStep`/`collide` handler. cannon's post-step sleep loop crashes if a body is removed mid-step. *(D: game loop and harvester)*
2. **Mark AABBs dirty after moving bodies by hand.** After setting a body's `position` or `quaternion` directly, set `body.aabbNeedsUpdate = true`. cannon doesn't flag it itself, and its raycasts then test a stale box. My grid always refreshes AABBs, but cannon's own code doesn't. *(B: props, cat, scenarios)*
3. **Keep the cat short enough for the hiding spots.** The cat collider must be **under 26 cm tall** to fit under the desk's modesty panel, and under 28 cm to fit under the bed. *(B)*
4. **Install the guard and broadphase once per world.** Use `world.broadphase = new UniformGridBroadphase()` and `createSweptGuard(world)`. The guard hooks cannon's own substep events, so it works whoever drives `world.step()`. *(D)*
5. **Use the collision helpers for sight.** Call `lineOfSight(raycast, eye, catPos, STATIC, { skip: catBody })`. Occluders (the bed skirt) block sight but bodies pass through them. For a crouch check, stand at a hiding volume's `checkFrom` with a lower eye. *(C)*
6. **Use the owner's material table for break impulses.** Pass each break impulse to `fracture.register(body, { kind, breakImpulse })`, taking it from B's material table. Until that column exists, the defaults in `tuning.js` are used. *(B)*
7. **Replace the stubs freely.** `package.json`, `vitest.config.js`, `src/core/tuning.js` and `src/core/groups.js` on `dharm` are minimal stubs marked `STUB (owner: D)`, added only so the collision tests run. Keep the `collision` block of `tuning.js` and the group bit values.
8. **The tunneling scenario needs the real `swat()`.** `harness/scenarios/tunneling.js` uses `stubSwat()`, which follows the `swat()` contract. Switch it to B's `swat()` when that lands.

### Open decision: one room layout (pending team agreement)

There are currently **two different rooms**, and they need to become one:
- **Antara's MVP (`antara` branch):** the original 12 × 12 m room, with the desk in the middle of the floor, a couch, a coffee table and a chair.
- **`src/collision/staticGeometry.js` (`dharm` branch):** the layout from the concept art (`docs/concept/ref3d.png`). It's a 7 × 6 m cut-away room with the bed and nightstand on the west wall (inner face x = −3.5), and the desk, window sill and bookshelf on the north wall (z = −3.0).

Per the contracts table, static geometry comes from A and feeds the broadphase, the guard and C's hiding checks, so **the renderer should build furniture meshes from `STATIC_BOXES`** rather than placing its own. Otherwise the drawn room and the physical room drift apart. The proposal is to use the concept-art layout, since it's the final target and the hiding spots and the 2 cm shelf are tuned for it. Missing furniture such as the couch or coffee table would be added to the store.

**Until this is agreed:** don't add static colliders outside `src/collision/staticGeometry.js`, and don't change that file's layout without a heads-up to Dharm. If you need furniture moved or added, raise it in the group chat.

---

## Tech stack

- **Three.js** (WebGL) for rendering, fixed isometric camera, shadow maps
- **cannon-es** for rigid-body integration and impulse-based contact resolution
- **Vite** for the dev build; **JavaScript ES modules**; plain HTML/CSS for the HUD
- **Vitest** for headless unit tests of the proofs
- **Vercel** for the live deploy (preview per PR)
- No game engine. Rendering, the collision layer, the noise model and the AI are written by us.

---

## Run it locally

Requires Node 18 or newer.

```bash
git clone https://github.com/Antarathapliyal31/ai_visual_project.git
cd ai_visual_project
# For now the project is a single HTML file on the `antara` branch:
git checkout antara
open last-one-awake-mvp.html   # Chrome or Firefox
# Once the Vite project is set up on `main`:
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Other scripts:

```bash
npm run build       # production bundle to dist/
npm run preview     # serve the production bundle locally
npm test            # headless tests (physics scenarios, noise curves)
npm run test:watch  # test in watch mode
```

---

## How to play

- **Up / W** — move the cat forward along the direction it is facing
- **Down / S** — reverse
- **Left / A** — turn left
- **Right / D** — turn right
- **Space** — jump
- **Right-drag** the view — orbit camera
- **Scroll** — zoom
- Objects fall only when the cat physically collides with them

The HUD shows FPS, active body count, the three mid-term test readouts, the wake meter, and the owner's current stage.

---

## Code layout

```
src/
  core/        loop, event bus, tuning.js, contracts
  physics/     world, materials, props
  player/      cat controller, swat
  collision/   grid broadphase, rays, tunneling guard, fracture
  noise/       impact harvester, loudness, wake meter
  ai/          owner state machine, behavior tree, waypoint A*
  render/      scene, isometric camera, lights, body-to-mesh sync
  ui/          HUD, debug overlay
harness/       test scenarios used by both the browser page and headless tests
               (collision-demo.html: live view of the collision layer)
tests/         Vitest suites, one per proof
docs/          Assignment PDFs, plan, this file
```

One rule: simulation code never imports Three.js. That lets every proof run headless under Vitest as well as in the browser.

---

## Workstreams and ownership

Each workstream owns one folder tree and one of the mid-term proofs.

| Workstream | Owner | Owns | Mid-term proof |
|---|---|---|---|
| **A · Collision layer** | Dharm Patel | `collision/`, raycasts, grid broadphase, swept guard, fracture (from W3) | Tunneling |
| **B · Dynamics and cat** | Rushi Patel | `physics/`, `player/`, material table, props, stack tuning | Stacking |
| **C · Owner AI** | Christina Ross | `ai/`, wake state machine, vision cone, behavior tree, waypoint A* | — |
| **D · Core, noise, UI** | Antara Thapliyal | `core/`, `noise/`, `render/`, `ui/`, harness, repo and build | Coupling, Performance |

**Rule of thumb:** don't edit a folder you don't own without a heads-up in the group chat and an approving review from its owner. Shared contracts (below) are the only places where one person's code touches another's; changes to those need approval from both sides.

---

## Contracts between workstreams

These are the module boundaries. Each one has a day-one stub so nobody waits.

| Contract | From → to | Shape | Day-one stub |
|---|---|---|---|
| `ImpactEvent` | D's harvester → noise, score, fracture | `{bodyA, bodyB, impulse, point, normal, matA, matB}`, impulse in N·s | Overlay button fires a fake impact |
| `NoiseEvent` | D's noise → C's senses, overlay | `{position, loudness, heardLoudness}` | Fixed loudness per impact |
| Wake level | D's meter → C's state machine, HUD | `wake` 0..1; stage thresholds in `tuning.js` | Overlay slider |
| `raycast()` | A → B (ledge), C (sight), overlay | `raycast(origin, dir, maxDist, mask) → {hit, distance, point, normal, body}` | Wraps `cannon-es` `world.raycastClosest` |
| Static geometry | A → broadphase, guard, C's hiding checks | Room boxes + hiding-spot volumes | Hand-placed boxes |
| Material table | B → noise, fracture | Per material: friction, restitution, loudness, break impulse; per-pair overrides | Ceramic, wood, paper only |
| `swat()` | B → gameplay, test scenarios | `swat(target, direction, speed)`, capped at 12 m/s | Sets velocity directly |
| Owner state | C → HUD, round end, coupling test | `owner.state` + `stateChanged` event | Always `asleep` |
| `debug.register()` | D → everyone | Adds a number, drawing layer, or tuning folder to the overlay | Ships by Oct 12 |
| `Scenario` | Proof owners → D's harness | `{setup, step, metrics, pass}`; runs in browser and headless | Ships by Oct 14 |

Shared conventions: units in m, kg and s · Y up · origin at floor centre · collision groups (`STATIC`, `PROP`, `DEBRIS`, `CAT`, `OWNER`) defined once in `core/`.

---

## Mid-term proofs

Each proof has one owner. All four must pass on Chrome and Firefox by **Oct 28**, which leaves the buffer week free for tuning.

| Proof | Owner | Pass criterion | Measured in |
|---|---|---|---|
| **Stacking** | B | Five plates, sleeping disabled, 60 s: max penetration < 2 mm, drift < 5 mm | Overlay + harness log |
| **Tunneling** | A | 100 swats at 12 m/s into a 2 cm shelf, zero pass-throughs; failure speed logged | Harness log, headless |
| **Coupling** | D | Same swat reaches "sitting up" from beside the bed and no further than "stirring" from the far wall | Harness log + recording |
| **Performance** | D | 60 FPS with 60 awake bodies while the other three run | Overlay FPS |

The tunneling test is a real test: at 120 Hz a 12 m/s mug moves 10 cm per step, five times the shelf's thickness, so discrete collision alone can miss it.

---

## Four-week schedule

Kickoff weekend: **Oct 9–11**. Weeks run Monday to Sunday.

| Week | Dates | Milestone |
|---|---|---|
| W0 | Oct 9–11 | Kickoff, stubs, first `main` merge |
| W1 | Oct 12–18 | Walking skeleton by Oct 14: a stub swat makes noise and changes the owner's pose |
| W2 | Oct 19–25 | Complete, playable round by **Oct 22** |
| W3 | Oct 26 – Nov 1 | Feature complete, all four proofs pass by **Oct 28** |
| W4 | Nov 2–5 | Tuning, demo recording, report. **Done by Nov 5.** |

Could-haves (sound, difficulty, replay) only touch W4 if everything else is done.

---

## Working agreements

- **Repo:** `main` is always runnable. Vercel deploys a preview for every PR, and `main` to production.
- **Branches:** one per task, prefixed by workstream, e.g. `a/grid-broadphase`, `b/cat-controller`, `c/behavior-tree`, `d/noise-model`.


---


