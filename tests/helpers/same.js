// Identity checks for physics objects.
//
// A cannon-es body links to its world and through it to every other body, so
// when expect(body).toBe(other) or expect(bodies).toContain(body) fails,
// Vitest tries to print the whole graph and the worker runs out of memory
// instead of reporting the failure. These compare by identity and only ever
// put booleans and short labels in front of expect().
import { expect } from 'vitest';

const label = (o) => (o ? `${o.userData?.kind ?? o.userData?.staticId ?? o.kind ?? 'object'} #${o.id ?? '?'}` : String(o));

/** a and b are the very same object. */
export function expectSame(a, b) {
  expect(a === b, `expected ${label(a)} to be ${label(b)}`).toBe(true);
}

/** `list` holds exactly the objects in `items` (by identity; order-free unless `ordered`). */
export function expectSameItems(list, items, { ordered = false } = {}) {
  expect(list.length, 'length').toBe(items.length);
  const ok = ordered ? items.every((x, i) => list[i] === x) : items.every((x) => list.includes(x));
  expect(ok, `expected the ${ordered ? 'same items in order' : 'same items'}: ${items.map(label).join(', ')}`).toBe(true);
}

/** `list` includes `item` (or not, with `present: false`). */
export function expectIncludes(list, item, present = true) {
  expect(list.includes(item), `expected ${label(item)} ${present ? 'in' : 'not in'} the list`).toBe(present);
}
