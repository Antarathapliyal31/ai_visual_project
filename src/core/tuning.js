// STUB (owner: D) — created by A so collision tests run; replace freely.
// Every tuning number lives here and shows in the overlay. A added the
// `collision` block and B the `physics` solver numbers plus `materials`,
// `materialPairs`, `props`, `cat` and `swat`; keep those blocks when the real
// scaffold replaces this file.
export const tuning = {
  physics: {
    fixedStep: 1 / 120,      // s, one substep (D's loop owns time)
    gravity: -9.82,          // m/s^2

    // --- B: solver and contact tuning (stack tuning, live in the overlay) ---
    solverIterations: 30,    // Gauss-Seidel passes per step
    solverTolerance: 1e-7,   // early-out threshold; keep tiny so stacks get every pass
    warmStart: 1.0,          // share of last step's contact impulse each contact starts from (0 = cannon-es behaviour)
    coulombFriction: true,   // friction limit = mu * normal impulse (false = cannon-es's mu * g * mass per step)
    restitutionThreshold: 0.5, // m/s; contacts closing slower than this don't bounce
    maxContactsPerPair: 6,   // outermost contact points kept per body pair (0 = all)
    contactStiffness: 1e7,   // N/m per contact point, for anything without a material row
    contactRelaxation: 3,    // steps a contact takes to relax; higher = softer
    frictionStiffness: 1e7,
    frictionRelaxation: 3,
    defaultFriction: 0.5,    // bodies without a material
    defaultRestitution: 0.05,
    allowSleep: true,
    sleepSpeedLimit: 0.05,   // m/s; props slower than this for sleepTimeLimit fall asleep
    sleepTimeLimit: 0.8,     // s
  },

  collision: {
    grid: {
      cellSize: 0.5,         // m, uniform grid cell edge
      maxCellsPerBody: 64,   // bodies covering more cells go to the oversize list
    },
    guard: {
      enabled: true,
      minDisplacement: 0.01, // m per substep (~1.2 m/s at 120 Hz), half the thinnest shelf
      skin: 0.002,           // m, gap left between the clamped sphere and the surface
    },
    fracture: {
      shrink: 0.97,          // pre-cut pieces are scaled down so they never spawn overlapping
      defaultBreakImpulse: { mug: 0.9, plate: 0.7 }, // N·s, until B's material table has a column
      breakOnCat: false,     // cat contacts never break props (it is 3 kg; true makes it a feature)
    },
  },

  // --- B: material table -------------------------------------------------
  // friction and restitution feed the solver; loudness is D's noise scale
  // (1 = reference crash); breakImpulse is A's fracture threshold in N·s for
  // a prop with breakScale 1 (null = never breaks).
  // stiffness is the contact spring in N/m per contact point. A resting
  // contact sinks load / stiffness, and the light stackable materials are
  // deliberately soft (tens of microns of sink) so their many contact points
  // stay in contact every step instead of flickering on and off at the
  // surface. Heavy bodies need stiff contacts or they squash into things.
  // A pair uses sqrt(fA * fB) for friction and loudness, and the lower of the
  // two for restitution and stiffness, unless `materialPairs` overrides it.
  materials: {
    ceramic: { friction: 0.50, restitution: 0.10, loudness: 1.6, breakImpulse: 0.8, stiffness: 3e4 },
    wood:    { friction: 0.60, restitution: 0.05, loudness: 0.9, breakImpulse: null, stiffness: 1e7 },
    paper:   { friction: 0.70, restitution: 0.02, loudness: 0.3, breakImpulse: null, stiffness: 3e4 },
    plastic: { friction: 0.40, restitution: 0.25, loudness: 0.8, breakImpulse: null, stiffness: 1e6 },
    fabric:  { friction: 0.90, restitution: 0.00, loudness: 0.1, breakImpulse: null, stiffness: 1e5 },
    plaster: { friction: 0.60, restitution: 0.05, loudness: 0.7, breakImpulse: null, stiffness: 1e7 },
    // The controller owns the cat's horizontal motion, so its surface is
    // frictionless: it never sticks to walls or fights the solver.
    cat:     { friction: 0.00, restitution: 0.00, loudness: 0.15, breakImpulse: null, stiffness: 5e6 },
  },
  // Per-pair overrides, keys sorted alphabetically ("a|b"). Any of friction,
  // restitution, loudness, stiffness.
  materialPairs: {
    'ceramic|ceramic': { friction: 0.50, restitution: 0.05, loudness: 1.6 },
    'ceramic|wood':    { friction: 0.55, restitution: 0.08, loudness: 1.4 },
    'paper|paper':     { friction: 0.70, restitution: 0.02, loudness: 0.3 },
    'paper|wood':      { friction: 0.70, restitution: 0.02, loudness: 0.4 },
  },

  // --- B: prop colliders (the visual mesh is built from the same numbers) ---
  props: {
    // segments = collider side count; keep it coarse (8-12), the mesh is round.
    plate: { radius: 0.18, height: 0.025, mass: 0.25, segments: 12, material: 'ceramic', breakScale: 0.875, linearDamping: 0.02, angularDamping: 0.05 },
    mug:   { radiusTop: 0.08, radiusBottom: 0.07, height: 0.14, mass: 0.3, segments: 12, material: 'ceramic', breakScale: 1.125, linearDamping: 0.01, angularDamping: 0.05 },
    book:  { half: [0.11, 0.025, 0.08], mass: 0.4, material: 'paper', breakScale: 1, linearDamping: 0.05, angularDamping: 0.1 },
    // Room clusters. The mesh adds the detail (shade, leaves, digits); the
    // collider stays one convex shape.
    lamp:   { radiusTop: 0.10, radiusBottom: 0.07, height: 0.32, mass: 0.8, segments: 10, material: 'plastic', linearDamping: 0.05, angularDamping: 0.1 },
    pot:    { radiusTop: 0.065, radiusBottom: 0.05, height: 0.11, mass: 0.5, segments: 10, material: 'ceramic', linearDamping: 0.03, angularDamping: 0.08 },
    pillow: { half: [0.20, 0.06, 0.28], mass: 0.4, material: 'fabric', linearDamping: 0.3, angularDamping: 0.4 },
    clock:  { half: [0.07, 0.04, 0.04], mass: 0.25, material: 'plastic', linearDamping: 0.05, angularDamping: 0.1 },
    // On the desk: a flat-screen standing on its edge (easy to tip, loud when it goes) and a keyboard.
    monitor:  { half: [0.25, 0.17, 0.03], mass: 2.2, material: 'plastic', linearDamping: 0.05, angularDamping: 0.1 },
    keyboard: { half: [0.19, 0.011, 0.065], mass: 0.5, material: 'plastic', linearDamping: 0.05, angularDamping: 0.1 },
    // A ball of yarn. cannon-es has no rolling friction, so the angular damping is what stops it.
    ball:   { sphere: 0.055, mass: 0.06, material: 'fabric', linearDamping: 0.15, angularDamping: 0.6 },
  },

  // --- B: cat controller -------------------------------------------------
  cat: {
    mass: 3.0,               // kg
    radius: 0.12,            // m; collider is 2r = 24 cm tall, under the 26 cm desk gap
    bodyHalfLength: 0.10,    // m; two spheres at +-this along the heading (0 = one sphere)
    speed: 3.0,              // m/s forward
    reverseFactor: 0.6,      // backing up is slower
    turnRate: 3.2,           // rad/s, car-style turning
    moveTurnRate: 12,        // rad/s when steering by a world direction (camera-relative input)
    groundAccel: 30,         // m/s^2 towards the target velocity on the ground
    brakeAccel: 40,          // m/s^2 with no input on the ground
    airAccel: 8,             // m/s^2 of air control
    jumpHeight: 1.1,         // m apex; the desk top is at 0.94
    coyoteTime: 0.08,        // s after leaving a ledge when a jump still counts
    jumpBuffer: 0.10,        // s a jump press is remembered before landing
    groundProbe: 0.04,       // m the ground rays reach below the feet
  },

  // --- B: swat -----------------------------------------------------------
  swat: {
    maxSpeed: 12,            // m/s, contract cap on the target's exit speed
    speed: 4.0,              // m/s, the paw's gameplay swat
    lift: 0.25,              // upward part of the paw's direction (0 = flat)
    reach: 0.20,             // m, paw centre ahead of the cat's nose
    radius: 0.16,            // m, paw volume radius
    cooldown: 0.35,          // s between swats
    maxTargets: 3,           // nearest bodies hit by one swat
    spin: 0.2,               // 0..1, how far off-centre the paw strikes (0 = no spin)
    maxSpin: 20,             // rad/s cap on a swatted body's spin
  },
};
