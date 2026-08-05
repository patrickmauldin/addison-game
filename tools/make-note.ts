/**
 * THE STAINED NOTE, assembled from its nine pieces.
 *
 * assets/drawer/note-stained holds a note as 1.png through 9.png — the nine
 * cells of a torn, stained scrap of paper, 32px square, in reading order. CSS
 * can nine-slice a scrap to any size the writing on it needs, but only from ONE
 * image, so the pieces are laid out 3x3 here and `border-image` does the rest.
 *
 * Which is also why this is a build step and not nine stacked backgrounds in
 * the stylesheet: a nine-slice with repeating edges written by hand is nine
 * layers whose paint order has to be reasoned about every time a corner moves.
 *
 * Re-run with `npm run make-note` after the artist touches any of the pieces.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../src/core/png.js';

const DIR = 'assets/drawer/note-stained';
const OUT = 'assets/drawer/note-9slice.png';
/** Every piece is this square, and the atlas is three of them each way. */
const CELL = 32;
const SIZE = CELL * 3;

const out = new Uint8ClampedArray(SIZE * SIZE * 4);

for (let i = 0; i < 9; i++) {
  const tile = decodePng(readFileSync(`${DIR}/${i + 1}.png`));
  if (tile.w !== CELL || tile.h !== CELL) {
    throw new Error(`${DIR}/${i + 1}.png is ${tile.w}x${tile.h}, expected ${CELL}x${CELL}`);
  }
  // Reading order: 1 2 3 across the top, 4 5 6 the middle, 7 8 9 the bottom.
  const col = i % 3;
  const row = (i / 3) | 0;
  for (let y = 0; y < CELL; y++) {
    const src = y * CELL * 4;
    const dst = ((row * CELL + y) * SIZE + col * CELL) * 4;
    out.set(tile.rgba.subarray(src, src + CELL * 4), dst);
  }
}

writeFileSync(OUT, encodePng(out, SIZE, SIZE));
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, nine ${CELL}px slices)`);
