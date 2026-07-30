/**
 * ANIMAL PACKER — the neighborhood's roaming animals into one sheet.
 *
 * Same delivered shape as the residents: a PixelLab tree of one PNG per frame
 * per direction, mostly transparent padding. Cropped to a shared content box
 * and packed, so the browser fetches one image instead of dozens.
 *
 * Only the four cardinal facings are shipped, because Walker steers in four.
 *
 * NOTE ON NORTH. cat-pablo was delivered without a north walk — seven
 * directions, not eight, where cat-chaz has all eight. Rather than freeze a
 * static rotation (a cat sliding across the lawn with its legs still) north
 * falls back to the north-east animation: real motion, angled a few degrees,
 * and at the size a cat renders that is not a difference anyone can see.
 *
 * Output is generated. Re-run with `npm run pack-cats`.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { type Bitmap, decodePng, encodePng } from '../src/core/png.js';

const SHEET_OUT = 'assets/animals.png';
const META_OUT = 'src/data/animals.json';

/** Walker's Dir order: 0 S, 1 W, 2 E, 3 N. */
const DIRS = ['south', 'west', 'east', 'north'] as const;
/** Where to look when a cat was delivered without that direction. */
const FALLBACK: Record<string, string[]> = { north: ['north-east', 'north-west'] };

/**
 * `kind` decides what it says when you click it, nothing else.
 *
 * The delivered canvases are NOT the same size — the cat is 56x56 and the dog
 * 60x60 — so each animal's content box is measured against its own canvas and
 * the results are aligned bottom-center in one shared output frame. Sharing a
 * crop offset across canvases of different sizes would slide one of them.
 */
const ANIMALS = [
  { id: 'pablo', folder: 'cat-pablo', kind: 'cat' },
  { id: 'gus', folder: 'dog-gus', kind: 'dog' },
];

const framesFor = (folder: string, dir: string): string[] => {
  const base = `assets/animals/${folder}/walking/animations/Walking`;
  for (const d of [dir, ...(FALLBACK[dir] ?? [])]) {
    const p = `${base}/${d}`;
    if (existsSync(p) && statSync(p).isDirectory()) {
      const fs = readdirSync(p).filter((f) => f.endsWith('.png')).sort();
      if (fs.length) {
        if (d !== dir) console.log(`  ${folder}: no ${dir} walk, using ${d}`);
        return fs.map((f) => `${p}/${f}`);
      }
    }
  }
  console.error(`${folder}: no frames for ${dir} and no fallback`);
  process.exit(1);
};

type Row = { animal: number; frames: Bitmap[] };
const rows: Row[] = [];
ANIMALS.forEach((a, ai) => {
  for (const dir of DIRS)
    rows.push({ animal: ai, frames: framesFor(a.folder, dir).map((f) => decodePng(readFileSync(f))) });
});

const cols = Math.max(...rows.map((r) => r.frames.length));

/** Content box of one animal, measured against its OWN canvas. */
const boxes = ANIMALS.map((_, ai) => {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const r of rows.filter((r) => r.animal === ai))
    for (const f of r.frames)
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          if (f.rgba[(y * f.w + x) * 4 + 3] === 0) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
});

// One output frame big enough for the largest, with everything aligned
// bottom-center — the ground contact and the body midline have to agree across
// animals or they will not stand on the same spot.
const fw = Math.max(...boxes.map((b) => b.w));
const fh = Math.max(...boxes.map((b) => b.h));
const sheetW = fw * cols;
const sheetH = fh * rows.length;
const out = new Uint8ClampedArray(sheetW * sheetH * 4);

rows.forEach((r, ri) => {
  const b = boxes[r.animal];
  const padX = Math.floor((fw - b.w) / 2);
  const padY = fh - b.h;
  r.frames.forEach((f, ci) => {
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const si = ((b.y0 + y) * f.w + b.x0 + x) * 4;
        const di = ((ri * fh + padY + y) * sheetW + ci * fw + padX + x) * 4;
        out[di] = f.rgba[si];
        out[di + 1] = f.rgba[si + 1];
        out[di + 2] = f.rgba[si + 2];
        out[di + 3] = f.rgba[si + 3];
      }
  });
});

writeFileSync(SHEET_OUT, encodePng(out, sheetW, sheetH));
writeFileSync(
  META_OUT,
  `${JSON.stringify(
    {
      _generated: 'tools/pack-cats.ts — do not hand-edit; run `npm run pack-cats`',
      sheet: SHEET_OUT,
      frameW: fw,
      frameH: fh,
      cols,
      /** row = animalIndex * 4 + direction, directions 0 S, 1 W, 2 E, 3 N. */
      dirs: DIRS.length,
      animals: ANIMALS.map((a) => a.id),
      /** What it says when clicked. */
      kinds: ANIMALS.map((a) => a.kind),
      boxes,
    },
    null,
    2,
  )}\n`,
);

console.log(`${rows.length} rows x ${cols} frames of ${fw}x${fh} -> ${SHEET_OUT} (${sheetW}x${sheetH})`);
ANIMALS.forEach((a, i) => console.log(`  ${a.id} (${a.kind}) content ${boxes[i].w}x${boxes[i].h}`));
