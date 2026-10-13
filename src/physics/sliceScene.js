// Slice scene (Workstream B): five plates, two mugs and a book on A's desk.
//
// The vertical-slice contents for the Oct 14 walking skeleton. Everything is
// placed on SURFACES.deskTop from A's static geometry, so it follows the desk
// if the layout changes height.
//
// No Three.js: simulation code must run headless.

import { SURFACES } from '../collision/index.js';
import { stackHeights } from './props.js';

// x, z on the desk top (the desk spans x -0.6..1.8, z -3.0..-2.2).
export const SLICE_LAYOUT = {
  stack: { x: 0.2, z: -2.6, count: 5 },
  mugs: [{ x: 0.85, z: -2.4 }, { x: 1.3, z: -2.7 }],
  book: { x: -0.25, z: -2.5, rotY: 0.3 },
};

/**
 * @param {ReturnType<import('./world.js').createPhysicsWorld>} physics
 * @param {typeof SLICE_LAYOUT} [layout]
 * @returns {{plates: object[], mugs: object[], book: object, all: object[]}} Prop records
 */
export function spawnSliceScene(physics, layout = SLICE_LAYOUT) {
  const y = SURFACES.deskTop;
  const plateHalf = physics.tuning.props.plate.height / 2;
  const plates = stackHeights(y, plateHalf, layout.stack.count).map((py) =>
    physics.spawn('plate', { position: [layout.stack.x, py, layout.stack.z] }));
  const mugs = layout.mugs.map((m) => physics.spawn('mug', { base: [m.x, y, m.z] }));
  const book = physics.spawn('book', { base: [layout.book.x, y, layout.book.z], rotY: layout.book.rotY });
  return { plates, mugs, book, all: [...plates, ...mugs, book] };
}
