// Keyboard to cat input (Workstream B).
//
// Pure functions: D's UI owns the key listeners and hands over the set of
// keys that are down (KeyboardEvent.code values); these turn it into the
// controller's input.
//
//   W / Up      forward        A / Left    turn left
//   S / Down    reverse        D / Right   turn right
//   Space       jump           J           swat

const down = (keys, ...codes) => codes.some((c) => keys.has(c));

/** Every key the cat uses, for preventDefault() in the page. */
export const CAT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyJ',
]);

/**
 * Car-style input (the README's controls).
 * @param {{has: (code: string) => boolean}} keys  codes currently held
 * @returns {import('./cat.js').CatInput}
 */
export function inputFromKeys(keys) {
  return {
    forward: (down(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (down(keys, 'KeyS', 'ArrowDown') ? 1 : 0),
    turn: (down(keys, 'KeyA', 'ArrowLeft') ? 1 : 0) - (down(keys, 'KeyD', 'ArrowRight') ? 1 : 0),
    move: null,
    jump: down(keys, 'Space'),
    swat: down(keys, 'KeyJ'),
  };
}

/**
 * Camera-relative input: W runs up the screen, D runs to its right.
 * @param {{has: (code: string) => boolean}} keys
 * @param {{x: number, z: number}} cameraForward  the camera's view direction on the ground plane
 * @returns {import('./cat.js').CatInput}
 */
export function cameraRelativeInput(keys, cameraForward) {
  const up = (down(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (down(keys, 'KeyS', 'ArrowDown') ? 1 : 0);
  const right = (down(keys, 'KeyD', 'ArrowRight') ? 1 : 0) - (down(keys, 'KeyA', 'ArrowLeft') ? 1 : 0);
  const len = Math.hypot(cameraForward.x, cameraForward.z) || 1;
  const fx = cameraForward.x / len, fz = cameraForward.z / len;
  // Screen right on the ground is forward x up = (-fz, fx).
  const x = fx * up - fz * right, z = fz * up + fx * right;
  const mag = Math.hypot(x, z);
  return {
    forward: 0,
    turn: 0,
    move: mag > 0 ? { x: x / mag, z: z / mag } : { x: 0, z: 0 },
    jump: down(keys, 'Space'),
    swat: down(keys, 'KeyJ'),
  };
}
