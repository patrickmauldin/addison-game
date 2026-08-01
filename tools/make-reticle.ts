/**
 * THE DART-GUN SIGHT, drawn rather than delivered.
 *
 * A cursor, so two hard limits shape it. Browsers ignore a cursor image over
 * 128px, and they will not take an SVG with a hotspot — which is why this is a
 * generated PNG and not a stylesheet. 96px leaves room for the ring to read at
 * a glance without crowding what it is being aimed at.
 *
 * Drawn with a distance field and a hard threshold, so every edge lands on a
 * whole pixel and the ring stair-steps the way the rest of the art does.
 * Anti-aliasing it would put a soft circle on top of a pixel-art street.
 *
 * Re-run with `npm run make-reticle`.
 */

import { writeFileSync } from 'node:fs';
import { encodePng } from '../src/core/png.js';

const SIZE = 96;
const C = (SIZE - 1) / 2;
/** Outer edge of the ring, a couple of pixels inside the canvas. */
const R = 44;
const RING = 4;
/** The washed interior. 10% white, per the reference. */
const FILL: [number, number, number, number] = [255, 255, 255, 26];
const RED: [number, number, number, number] = [232, 78, 70, 255];

/** Crosshair in the middle: a gap, four ticks, and nothing at dead centre —
 *  the point you are aiming at is the one point that must stay visible. */
const TICK_GAP = 5;
const TICK_LEN = 9;

const px = new Uint8ClampedArray(SIZE * SIZE * 4);
const put = (x: number, y: number, c: [number, number, number, number]) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // Painted in order, so the ring and the ticks sit ON the wash rather than
  // blending with it — a translucent red over a translucent white is neither.
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
};

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - C, y - C);
    if (d <= R - RING) put(x, y, FILL);
    else if (d <= R) put(x, y, RED);
  }
}
for (let k = TICK_GAP; k < TICK_GAP + TICK_LEN; k++) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    put(Math.round(C + dx * k), Math.round(C + dy * k), RED);
    // Two pixels thick, so it survives on a busy lawn.
    put(Math.round(C + dx * k) + (dy ? 1 : 0), Math.round(C + dy * k) + (dx ? 1 : 0), RED);
  }
}

writeFileSync('assets/dart-reticle.png', encodePng(px, SIZE, SIZE));
console.log(`assets/dart-reticle.png  ${SIZE}x${SIZE}  ring r=${R} w=${RING}`);
