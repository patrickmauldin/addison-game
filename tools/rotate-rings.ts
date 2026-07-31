/**
 * Turn the binder coil on its side.
 *
 * The rulebook's spiral runs down the left edge; the calendar's runs across the
 * top. Same wire, same art — but a background-image cannot be rotated in CSS,
 * and the middle tile has to REPEAT, which rules out the usual trick of
 * rotating the element itself (the repeat axis would rotate with it, and the
 * element's length would have to be known at author time).
 *
 * So the sprites are rotated once, here, and committed alongside the originals.
 * Re-run after editing any binder-ring-*.png or the two sets drift apart:
 *
 *     npm run rotate-rings
 *
 * Clockwise, deliberately. In the book the coil sits to the LEFT of the paper,
 * so the sprite's right edge is the one touching the page. On the calendar the
 * coil sits ABOVE the paper, so that same edge has to end up pointing down —
 * which is what a clockwise quarter turn does.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { type Bitmap, decodePng, encodePng } from '../src/core/png.js';

const DIR = 'assets/rulebook';
const NAMES = ['binder-ring-top', 'binder-ring-mid', 'binder-ring-bot'];

/** Quarter turn clockwise: (x, y) -> (h - 1 - y, x). */
function rotateCW(src: Bitmap): Bitmap {
  const out: Bitmap = {
    w: src.h,
    h: src.w,
    rgba: new Uint8ClampedArray(src.w * src.h * 4),
  };
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const from = (y * src.w + x) * 4;
      const to = (x * out.w + (src.h - 1 - y)) * 4;
      out.rgba[to] = src.rgba[from];
      out.rgba[to + 1] = src.rgba[from + 1];
      out.rgba[to + 2] = src.rgba[from + 2];
      out.rgba[to + 3] = src.rgba[from + 3];
    }
  }
  return out;
}

for (const name of NAMES) {
  const src = decodePng(readFileSync(`${DIR}/${name}.png`));
  const out = rotateCW(src);
  writeFileSync(`${DIR}/${name}-h.png`, encodePng(out.rgba, out.w, out.h));
  console.log(`  ${name}  ${src.w}x${src.h}  ->  ${name}-h  ${out.w}x${out.h}`);
}
