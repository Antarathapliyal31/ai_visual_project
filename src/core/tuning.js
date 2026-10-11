// STUB (owner: D) — created by A so collision tests run; replace freely.
// Every tuning number lives here and shows in the overlay. A only added the
// `collision` block; the other blocks are placeholders for their owners.
export const tuning = {
  physics: {
    fixedStep: 1 / 120,      // s, one substep (D's loop owns time)
    gravity: -9.82,          // m/s^2
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
    },
  },
};
