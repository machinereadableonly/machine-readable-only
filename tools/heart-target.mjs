// The heart the code is driven towards. One shared definition so the generator,
// the tests and the preview renderer can never disagree about the shape.

// Classic implicit heart: f(x, y) <= 0 is inside the curve.
export function heartF(x, y) {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y;
}

// Partial derivatives. Needed because f is not a distance: its value grows at
// very different rates around the curve, so ranking cells by raw f picks blobs
// rather than an even outline. Dividing by the gradient magnitude turns f into
// an approximate distance to the boundary.
export function heartFx(x, y) {
  const a = x * x + y * y - 1;
  return 6 * x * a * a - 2 * x * y * y * y;
}
export function heartFy(x, y) {
  const a = x * x + y * y - 1;
  return 6 * y * a * a - 3 * x * x * y * y;
}

export const SPAN = 2.35;   // how much of the heart's coordinate space fits the grid
export const Y_OFFSET = 0.15; // lifts the curve so the lobes and point sit evenly

// Build the target bitmap for a size x size module grid, plus a priority order
// saying which modules to claim first when the budget runs out -- and it always
// runs out: at version 5 the free bits control roughly 400 of 1369 modules.
//
// The order claims the heart's BODY first, deepest modules before shallow ones,
// and only then the ground outside it. Measured on the same 400 free bits, this
// fills 72.8% of the heart body against 65.9% for a boundary-first order, and
// scores slightly higher overall too (64.9% against 64.1%). Boundary-first spent
// the budget drawing a crisp edge around a body full of holes, which reads as
// noise rather than as a heart.
export function heartTarget(size) {
  const mid = (size - 1) / 2;
  const scale = SPAN / size;
  const want = new Uint8Array(size * size);
  const prio = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col - mid) * scale;
      const y = -((row - mid) * scale) + Y_OFFSET; // grid y grows downward
      const v = heartF(x, y);
      const i = row * size + col;
      want[i] = v <= 0 ? 1 : 0;
      const grad = Math.hypot(heartFx(x, y), heartFy(x, y)) || 1e-9;
      prio.push({ i, inside: want[i], dist: Math.abs(v) / grad });
    }
  }
  // Inside before outside; within each group, deepest before shallowest.
  prio.sort((a, b) => (b.inside - a.inside) || (b.dist - a.dist));
  return { want, order: prio.map(p => p.i) };
}
