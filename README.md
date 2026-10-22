# Last One Awake

A 3D stealth game about a cat wrecking an apartment at 3 a.m. Every object is a real rigid body, every crash makes noise, noise wakes the owner, and once he's up he hunts you. Nothing about the destruction is scripted.

CS 549 — Computer Graphics & Visual Computing, Fall 2026 · Rutgers.
Group: Rushi Patel (leader), Dharm Patel, Antara Thapliyal, Christina Ross.

**Live build:** _(fill in after first Vercel deploy)_
**Mockup (previous Matter.js version):** https://lastoneawake.netlify.app/
**Repo:** https://github.com/Antarathapliyal31/ai_visual_project
**Current MVP:** single file `last-one-awake-mvp.html` in the repo root (open it in a browser)

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

- **Physics & Dynamics.** Material table (ceramic, wood, paper, plastic, fabric, cat) drives friction, restitution, loudness, and break impulse. `cannon-es` integrates the bodies and builds the contact equations; our own Gauss-Seidel pass solves them with warm starting and Coulomb friction, which is what keeps a stack of five plates still and makes the friction column mean something.
- **Collision Detection.** Our own uniform spatial-grid broad phase plugged into `cannon-es`. Ray-vs-AABB and ray-vs-box queries drive the owner's line-of-sight and the cat's ledge checks. A swept-sphere tunneling guard, gated at 1 cm of motion per substep (about 1.2 m/s), stops fast swatted mugs from passing through thin shelves.
- **NPC AI / Behavior Trees.** Wake-state machine (asleep → stirring → sitting up → standing → awake) driven by the noise meter. Once standing, a behavior tree investigates the last noise, searches, checks hiding spots, and returns to bed.

The coupling: the solver's contact impulses are the input to the AI's perception. The two systems share one data path.

---

## What's built so far by Antara(as of Oct 11)

The MVP is a single HTML file in the repo root (`last-one-awake-mvp.html`). It runs end to end: cat moves, bumps things, noise feeds the wake meter, owner wakes up and catches the cat. All built in Three.js + cannon-es, no engine.

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

## What's built so far by Dharm: collision layer (Workstream A, as of Oct 21)

The collision layer is merged into `main` in `src/collision/`. It's plain JS on top of cannon-es with no Three.js, so it runs headless. **All of Workstream A's planned tasks are implemented, and the Tunneling proof passes in Node and in Chrome.** Run `npm install && npm test` to see it: 61 collision tests across 9 files.

**Working:**
- **Static geometry store** (`staticGeometry.js`). The whole room as data (`STATIC_BOXES`), built once into STATIC bodies. It includes the bed-skirt `OCCLUDERS`, the `HIDING_VOLUMES` (under the bed, under the desk), the named `SURFACES` heights props spawn on, and invisible boundary walls on the cut-away sides so props can't roll off the floor. **B's added furniture (couch, coffee table, aquarium, chair, cat tree) is reviewed and accepted:** it stays inside the room, keeps out of both hiding volumes and 30 cm clear of their crouch points, and every new `SURFACES` height matches a box top, all now checked by tests. Crouched sight into both hiding spots is unchanged. For C: the couch, coffee table and chair do add blind floor behind them for a standing owner (74 to 162 of 817 sampled floor points from beside the bed).
- **Uniform grid broadphase** (`UniformGridBroadphase`). A cannon-es `Broadphase` subclass with `collisionPairs()` and `aabbQuery()`; the cell size comes from `tuning.js` (0.5 m). Across 1,000 random scenes it finds exactly the pairs the naive broadphase does. cannon's own `world.raycast*` keeps working with it.
- **`raycast(origin, dir, maxDist, mask)`**: returns `{hit, distance, point, normal, body}`, following the contract. It uses slab and ray-vs-box tests and walks the grid. It matches `world.raycastClosest` on 10,000 random rays.
- **Swept-sphere tunneling guard** (`createSweptGuard`). It runs after every substep and only clamps when discrete collision would actually fail, so resting stacks and sliding props are left alone.
- **Fracture** (`createFracture`). A plate breaks into 3 wedges, a mug into 2 shells plus its base. Pieces keep the parent's velocity and spin, conserving momentum. It's driven by `ImpactEvent`s. The cat's own contacts never break anything (`tuning.collision.fracture.breakOnCat: false`); set it to `true` to make that a feature.
- **Hiding helpers** (`hidingSpotAt`, `lineOfSight`). Hiding works through geometry, not a flag.
- **Overlay data** (`collisionDebugData`, `registerCollisionDebug`): occupied cells, candidate, broadphase and narrow-phase pairs, guard counters.
- **Live demo page** (`harness/collision-demo.html`): tunneling, sight and hiding, fracture, and 400-body broadphase views. Run `python3 -m http.server 8550` in the repo root and open `http://localhost:8550/harness/collision-demo.html`.
- **Browser proof page** (`harness/collision-proofs.html`): runs the tunneling proof and the 200/400-body broadphase profile with the same scenario code as the tests, shows pass or fail, and saves a JSON log. Open it in Chrome and in Firefox for the Oct 28 proofs.

**Measured results:**
- **Tunneling, 12 m/s into the 2 cm shelf, using B's real `swat()`:** with the guard on, 0 of 100 swats pass through; with it off, 22 of 100 do. The failure speed is 12 m/s without the guard and above 100 m/s with it. Same numbers in Node and Chrome 156.
- **Five-plate stack, 60 s:** the plates end in identical positions with the guard on and off, with 0 clamps.
- **400 bodies in B's game world, grid at 0.5 m (Chrome 156):** while props are moving the grid hands 270 pairs to the narrowphase against 1,454 for Naive, with 193 narrow-phase pairs a step on average (target: about 200), and the step takes 6.2 ms against 8.0 ms. Settled, it is 135 narrow-phase pairs and 2.5 ms against 3.5 ms. Only the moment all 400 props land at once peaks at about 430 real contacts.
- **Why the settled numbers dropped:** the perf scenario used to run cannon-es's stock solver, which leaves about 230 of 400 props jittering awake (312 narrow pairs, 7–8 ms). It now builds its world with B's `createPhysicsWorld()` (solver, material table and tuning), as the game does. Cell sizes from 0.3 to 1.0 m change broadphase time only, not pairs, since the grid passes on only true AABB overlaps; 0.5 m was fastest.

### Integration rules for other workstreams (read before using `src/collision/`)

Import everything from `src/collision/index.js`. These rules apply to people and AI assistants alike:

1. **Fracture must flush between steps.** Feed every `ImpactEvent` to `fracture.onImpact(event)`, then call `fracture.flush()` **after `world.step()` returns**, never inside a cannon `preStep`/`postStep`/`collide` handler. cannon's post-step sleep loop crashes if a body is removed mid-step. *(D: game loop and harvester)*
2. **Mark AABBs dirty after moving bodies by hand.** After setting a body's `position` or `quaternion` directly, set `body.aabbNeedsUpdate = true`. cannon doesn't flag it itself, and its raycasts then test a stale box. My grid always refreshes AABBs, but cannon's own code doesn't. *(B: props, cat, scenarios)*
3. **Keep the cat short enough for the hiding spots.** The cat collider must be **under 26 cm tall** to fit under the desk's modesty panel, and under 28 cm to fit under the bed. *(B)*
4. **Install the guard and broadphase once per world.** Use `world.broadphase = new UniformGridBroadphase()` and `createSweptGuard(world)`. The guard hooks cannon's own substep events, so it works whoever drives `world.step()`. *(D)*
5. **Use the collision helpers for sight.** Call `lineOfSight(raycast, eye, catPos, STATIC, { skip: catBody })`. Occluders (the bed skirt) block sight but bodies pass through them. For a crouch check, stand at a hiding volume's `checkFrom` with a lower eye. *(C)*
6. **Use the owner's material table for break impulses.** Pass each break impulse to `fracture.register(body, { kind, breakImpulse })`, taking it from B's material table. Until that column exists, the defaults in `tuning.js` are used. *(B)*
7. **Replace the stubs freely.** `package.json`, `vitest.config.js`, `src/core/tuning.js` and `src/core/groups.js` are minimal stubs marked `STUB (owner: D)`, added only so the collision tests run. Keep the `collision` block of `tuning.js` and the group bit values.
8. **Feed every contact to fracture, cat included.** `fracture.onImpact()` skips the cat's contacts itself while `breakOnCat` is false, so the harvester doesn't need its own cat filter. *(D)*

### Open decision: one room layout (pending team agreement)

There are currently **two different rooms**, and they need to become one:
- **Antara's MVP (`last-one-awake-mvp.html`):** the original 12 × 12 m room, with the desk in the middle of the floor, a couch, a coffee table and a chair.
- **`src/collision/staticGeometry.js`:** the layout from the concept art (`docs/concept/ref3d.png`). It's a 7 × 6 m cut-away room with the bed and nightstand on the west wall (inner face x = −3.5), and the desk, window sill and bookshelf on the north wall (z = −3.0).

Per the contracts table, static geometry comes from A and feeds the broadphase, the guard and C's hiding checks, so **the renderer should build furniture meshes from `STATIC_BOXES`** rather than placing its own. Otherwise the drawn room and the physical room drift apart. The proposal is to use the concept-art layout, since it's the final target and the hiding spots and the 2 cm shelf are tuned for it. Missing furniture such as the couch or coffee table would be added to the store.

**Until this is agreed:** don't add static colliders outside `src/collision/staticGeometry.js`, and don't change that file's layout without a heads-up to Dharm. If you need furniture moved or added, raise it in the group chat.

---

## What's built so far by Rushi: dynamics and cat (Workstream B, as of Oct 12)

Workstream B is on the `Rushi` branch, in `src/physics/` and `src/player/`. It's plain JS on top of cannon-es and A's collision layer, with no Three.js, so it runs headless. **The W1 and W2 tasks are implemented, the Stacking proof passes, and W3's room clusters are in.** `npm test` now runs 211 tests across 18 files (A's 56 plus 155 for B).

**Working:**
- **Physics world wrapper** (`createPhysicsWorld`). One cannon-es world set up from `tuning.js`. It installs A's grid broadphase, swept guard, static room and fracture once, and exposes one `step()` that advances a single 120 Hz substep.
- **Contact solver** (`WarmGSSolver`). Replaces cannon-es's Gauss-Seidel pass; cannon-es still builds the contacts and integrates. It adds warm starting, Coulomb friction, a restitution threshold and contact reduction (6 points per body pair). Each can be switched off in the overlay, and with all of them off it reproduces the stock solver step for step.
- **Material table** (`createMaterialTable`). Seven materials (the six planned plus `plaster` for A's walls), each with friction, restitution, loudness, break impulse and contact stiffness, and per-pair overrides. One cannon `ContactMaterial` per pair.
- **Prop factories** for plate, mug and book (`physics.spawn(kind, ...)`). Each returns its body with a plain `visual` spec made from the collider's own dimensions, for D's meshes. Colliders are coarse (12 sides), meshes are round.
- **Slice scene** (`spawnSliceScene`): five plates, two mugs and a book on A's desk.
- **Room clusters** (`spawnRoomScene`): the slice scene plus a filled bookshelf, two lamps, a monitor and keyboard, an alarm clock, a pillow, four plants, yarn balls and cushions, and a mug and books on the coffee table. 78 props in all, placed from `STATIC_BOXES` and `SURFACES` so they follow the furniture, and seeded so every run sees the same room. New prop kinds: `lamp`, `pot`, `pillow`, `clock`, `ball`, `monitor`, `keyboard`.
- **Cat controller** (`createCat`). A dynamic body with fixed rotation, 24 cm tall, built from two spheres. Car-style steering as in "How to play", or camera-relative via `move`. Ground check by three of A's rays, jump with coyote time and input buffering.
- **`swat(target, direction, speed)`**, capped at 12 m/s, and the cat's paw volume that calls it. Nothing is swatted through a wall or shelf.
- **Stacking scenario** (`harness/scenarios/stacking.js`), following the `Scenario` contract.
- **Overlay data** (`physicsDebugData`, `registerPhysicsDebug`): body, contact and solver numbers, contact points, and the stack-tuning controls.
- **Live demo page** (`harness/dynamics-demo.html`): the cat in the slice scene, the stacking proof, and a friction test. Run `python3 -m http.server 8550` in the repo root and open `http://localhost:8550/harness/dynamics-demo.html`.
- **Playable room in the cozy look** (`harness/play.html`, with the render code in `harness/look/`): the full room with wood planks, rugs, lamps and a wooden HUD, after a reference picture of a warm, cluttered isometric room. Same server, `http://localhost:8550/harness/play.html`. `N` switches between a lamp-lit evening and 3 a.m., `B` the painted brush on and off, `P` between full and plain lighting, `H` resets the view.

**Measured results:**
- **Stacking, five plates, sleeping off, 60 s:** deepest penetration 0.07 mm (limit 2 mm), largest plate drift 0.02 mm (limit 5 mm), measured from the first step after spawning with no settle period. The numbers are identical with A's guard on and off, and identical in Node and Chrome.
- **The same scenario with cannon-es's stock solver settings fails:** 130 mm of drift. The stock pass starts from zero every step, and a stack of three or more plates never converges in 20 passes, so it trembles at about 0.1 m/s and walks.
- **Ten messy stacks** (plates up to 1 cm off centre, any yaw, 20 s each) all stay inside the limits; the worst is 0.08 mm and 0.03 mm. Five books pass the full 60 s too (0.23 mm, 0.31 mm), so the stack stays plates.
- **Friction now follows Coulomb's law.** A box sliding at 3 m/s stops within about 2% of v² / (2μg) for μ = 0.2, 0.5 and 0.7. With the stock solver it stops within 3 mm whatever μ is: cannon-es applies its friction limit, a force, to the per-step impulse, so at 120 Hz friction is 120 times too strong.
- **Tunneling still holds in B's world.** 100 swats at 12 m/s with the real `swat()`, B's solver and the soft ceramic contacts: 0 pass-throughs with the guard on, 22 with it off, the same as A's own numbers.
- **Cat:** jump apex 1.10 m (the desk is 0.94 m). It fits under the desk and the bed; a 28 cm cat is stopped by the desk panel.
- **The full room, 78 props:** nothing moves a millimetre in 10 s with sleeping off, and with sleeping on every prop is asleep within 2 s, so the room costs nothing until the cat touches it.
- **60 awake bodies in a heap:** about 3.6 ms per step in Node, the same as the stock solver. About 0.9 ms of that is the solver; the rest is cannon-es's narrowphase.
- **A's 400-body scenario** with B's solver swapped in: about 120 bodies still awake once settled instead of 227, and about 2.7 ms per step instead of 8 to 9 ms. Much of the "never fall asleep" problem was the stock solver's trembling.

### Using `src/physics/` and `src/player/` (read before integrating)

Import from `src/physics/index.js` and `src/player/index.js`.

1. **Make the world with `createPhysicsWorld()` and step it with `physics.step()`.** Nothing else calls `world.step()`. The wrapper already does A's rules 1, 4 and 6: one broadphase and guard per world, breakables registered with the table's break impulses, and fracture flushed after each step. *(D)*
2. **Hook the harvester with `physics.onAfterStep(fn)`.** It runs after `world.step()` and before the fracture flush, so an `ImpactEvent` fed to `physics.fracture.onImpact()` there breaks the prop the same step. Controllers go in `physics.onBeforeStep(fn)`. Don't set velocities in cannon's own `preStep` event: it fires after the solver. *(D, C)*
3. **Read impulses as `multiplier × dt` from `world.contacts`, summed per body pair.** Only 6 contact points per pair carry impulse; the others read 0, and the pair's sum is unchanged. *(D)*
4. **Take loudness from the table:** `physics.materials.loudness(matA, matB)`, with `physics.materials.nameOf(body)` for the names. *(D)*
5. **Build meshes from `prop.visual`**, and debris meshes from `physics.debris[i].visual`. `physics.props` and `physics.debris` are the live lists. The cat's body yaw is its heading, so a cat model facing +x needs no special case; `cat.dims` has the collider size and `cat.groundBelow()` the point for a drop shadow. *(D)*
6. **Place props with `base: [x, surfaceY, z]`**, not by hand. Props are spawned 10 microns into what they rest on so every contact exists on the first step. A positive gap makes a stack drop like an accordion: the top plate of five arrives at 0.4 m/s and 5 mm deep. *(everyone)*
7. **Don't raise ceramic or paper stiffness to "fix" a soft-looking contact.** The light stackable materials are soft on purpose (a resting plate sinks tens of microns) so their contact points stay in contact every step. Stiff contacts are why the stock stack flickers. *(everyone)*
8. **Feed the cat with `cat.setInput(inputFromKeys(keys))`,** where `keys` is the set of `KeyboardEvent.code` values held. `J` is mapped to swat until the controls are settled. For sight rays, pass `skip: cat.body`. *(D, C)*

### The look (`harness/look/`): a prototype for D to adopt

`harness/play.html` draws the room in the style of the reference picture: an orthographic isometric view that follows the cat, procedural textures (no image files), one shadow-casting light, lamps as point lights, and a wooden HUD. It is render-side only and reads the simulation without writing to it.

- **What makes it look lit, not modelled** (`look/pipeline.js`): an environment map for reflections on glaze and varnish, ambient occlusion for the dark creases and contact shadows, and a little bloom on the lamps. `P` switches to the plain render; the page also steps the quality down by itself if the frame rate stays under 40.
- **What makes it look painted** (`look/pipeline.js`, `look/textures.js`): a brush filter over the finished picture (a Kuwahara filter turned to a wandering stroke direction: flat areas become dabs, edges stay), a faint canvas tooth under it, and loose brush strokes painted into the wall, wood and floor textures. `B` switches the brush off to compare.
- **Furniture that is more than a box** (`look/furniture.js`): the leather couch, the coffee table, the aquarium with its fish, the desk chair and the cat tree are each built from the static box they stand for, within a few centimetres of it.
- **The room is drawn in few pieces.** Everything still and opaque is merged into one mesh per material when the room is built, which cut the draw calls from 975 to 425 per frame.
- **Broken things are drawn as what they are, not as their colliders** (`look/propMeshes.js`). A's plate wedges become sectors of the real plate with ragged break lines and matte break faces; a mug's two box halves become curved pieces of its wall (one keeps the handle) and its base a ragged foot. The colliders are still A's. For this, `physics.debris` records carry `index` (the piece's place in A's pre-cut) and `parentSerial` (the prop it came from).
- **The cat** (`look/catMesh.js`) is modelled round the collider: shaped body and head, eyes, ears, whiskers, ringed tail, and a tabby coat painted from each point's place on the body. It stays inside the collider's height, so it still fits the hiding spots.

- **It lives in `harness/` because `src/render/` and `src/ui/` are D's.** If D adopts it, the modules move to `src/render/` as they are: `room.js` builds every mesh from `STATIC_BOXES` and `OCCLUDERS`, `propMeshes.js` from each prop's `visual` spec, `catMesh.js` from `cat.dims`.
- **Furniture it has never heard of still gets dressed**, by its material name (wood or cloth). So a couch or coffee table added to A's store shows up without touching the look.
- **Dressing has no colliders:** rugs, pictures, the window, drawer fronts, the blanket. Anything that should stop the cat belongs in A's static geometry, not in `harness/look/`.
- **The HUD numbers are B's only.** "Knocked over" and "Broken" come from the physics state. "Noise" is a stand-in fed by contact impulses and the loudness table; it is not D's wake meter, and the page has no owner or wake logic.
- **python's `http.server` sends no cache headers**, so after pulling new code Chrome may keep running old modules. Hard-reload (Cmd+Shift+R) if the page looks stale.

### Changed for other workstreams, and still open

- **`src/core/tuning.js` (D's stub)** gained B's blocks: solver numbers in `physics`, plus `materials`, `materialPairs`, `props`, `cat` and `swat`. A's `collision` block is untouched.
- **Furniture added to A's static store, for A to review.** At the team lead's request B appended a couch, a coffee table, an aquarium on a cabinet, a desk chair and a cat tree to `STATIC_BOXES` in `src/collision/staticGeometry.js` (19 boxes, the chair's four sharing one `rotY`), and seven heights to `SURFACES`. Nothing that was there moved, the hiding volumes and their check points are untouched (the chair stands clear of the under-desk check point), and A's 56 tests pass unchanged. This is the concept-art layout plus the "missing furniture" the layout proposal above already expected; it still wants Dharm's eye, and C should know the couch and chair are now in the owner's way.
- **`swat()` has landed** (A's rule 8). On a resting target it gives bit-for-bit the velocity `stubSwat()` does, so `harness/scenarios/tunneling.js` can switch its import with no change to its numbers. That file is A's, so it hasn't been touched.
- **Open: should the cat itself break things?** The cat is 3 kg. Walking into a plate lying on the floor delivers about 2.4 N·s to it, and landing on one from a jump about 6.7 N·s; a plate breaks at 0.7. If the harvester feeds cat contacts to fracture, the cat shatters every plate it steps on. A and D need to pick: skip `CAT` pairs for fracture, or keep it as a feature.
- **Known limits.** The cat sinks up to 1.6 cm into the floor for a frame or two when it lands a full jump, and 0.8 cm into a wall at full speed: cannon-es has no speculative contacts, and A's guard only steps in for real tunneling. A stack of 12 plates holds for 60 s at the default 30 solver passes; 15 does not.

---

## Code review of `main` (by Dharm Patel, Oct 22)

I reviewed everything merged into `main` on Oct 22 (Rushi's and Christina's work from the `Rushi` branch, Antara's MVP, and my own collision work). All 221 tests pass and every harness page loads in Chrome with no errors, but the review found ten logic bugs the tests don't cover. Each is listed under its owner; please fix yours or reply in the group chat if you disagree.

**Christina (C, owner AI):**
- [ ] **The owner never calms down** (`src/ai/ownerStateMachine.js:41`). Once a noise is stored, `stirring`, `sittingUp` and `standing` never drop to a lower stage as the wake level falls, and the noise is never cleared. Example: `onNoise({loudness: 0.9}); update(dt, 0.75)` gives `standing`, then `update(dt, 0.1)` still returns `standing` with action `search` forever.
- [ ] **The owner teleports to the noise** (`src/ai/ownerStateMachine.js:133`). `onNoise()` sets the owner's position to the noise source instead of only setting a target, so a plate breaking on the desk makes the owner appear at the desk.
- [ ] **Start position and target are ignored** (`src/ai/ownerPlaceholder.js:66`). The end of `createOwnerPlaceholder` overwrites `owner.position` with `bedPosition` and `owner.target` with `null`, so `options.position` and `options.target` are lost (`basePosition` is computed and never used).
- [ ] **The behaviour tree hard-codes its thresholds** (`src/ai/behaviorTree.js:29`). It uses loudness 0.5 and wake 0.7 instead of the state machine's tunable thresholds, so stages and actions disagree once thresholds are tuned (with `standing: 0.5` the owner stands at 0.55 but the tree still picks `checkHidingSpot` until 0.7).

**Rushi (B, physics):**
- [ ] **The sleep toggle has no effect on some worlds** (`src/physics/world.js:90`). `applyTuning()` lets `opts.allowSleep` win over `tuning.physics.allowSleep`, so the overlay's "body sleeping" toggle does nothing on a world created with `allowSleep` (e.g. the stacking scenario).
- [ ] **Debris ignores the sleep tuning** (`src/physics/world.js:93`). Fracture pieces keep cannon's default sleep limits (0.1 m/s, 1 s) because `applyTuning()` only loops over props, so the 200-400 debris bodies sleep at different thresholds than the tuned props.
- [ ] **Odd contact limits keep the wrong number of points** (`src/physics/solver.js:251`). `_reduceContacts` keeps `2 * floor(max / 2)` points, at least 2: a limit of 1 keeps 2, 3 keeps 2, and 5 keeps 4.
- [ ] **The solver pass count reads one low** (`src/physics/solver.js:204`). When the tolerance early-out fires, the `break` comes before `iter++`, so the overlay shows 0 passes after one full pass.
- [ ] **The play pages filter cat contacts before fracture** (`harness/play.html:279`, `harness/dynamics-demo.html:472`). Fracture now skips cat contacts itself (`tuning.collision.fracture.breakOnCat`), so these pre-filters are redundant and make `breakOnCat: true` do nothing in the game. Forward every `ImpactEvent` to `physics.fracture.onImpact()` and let fracture decide.

**Dharm (A, collision):**
- [x] **The perf scenario copied the game solver setup by hand** (`harness/scenarios/broadphasePerf.js`). It built `WarmGSSolver` itself instead of reusing B's tuning-to-solver mapping in `src/physics/world.js`, so a new solver option added there would have been missing from the benchmark. **Fixed:** the scenario now builds its world with `createPhysicsWorld()`. The target still holds (193 narrow-phase pairs active, 135 settled).

---

## Tech stack

- **Three.js** (WebGL) for rendering, fixed isometric camera, shadow maps
- **cannon-es** for rigid-body integration, the narrow phase and the contact equations; our own warm-started Gauss-Seidel pass solves them
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
# Antara's single-file MVP:
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
  physics/     world, solver, materials, props, slice scene, room clusters
  player/      cat controller, swat, key mapping
  collision/   grid broadphase, rays, tunneling guard, fracture
  noise/       impact harvester, loudness, wake meter
  ai/          owner state machine, behavior tree, waypoint A*
  render/      scene, isometric camera, lights, body-to-mesh sync
  ui/          HUD, debug overlay
harness/       test scenarios used by both the browser page and headless tests
               (collision-demo.html: live view of the collision layer;
                dynamics-demo.html: live view of the dynamics and the cat;
                play.html + look/: the playable room in the cozy look)
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


