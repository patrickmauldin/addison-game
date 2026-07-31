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
 * Output is generated. Re-run with `npm run pack-animals`.
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
 * `kind` decides what it says when you click it. `nocturnal` decides whether it
 * is out at all: an armadillo on a Tuesday afternoon is a dead armadillo, and a
 * raccoon in daylight is a raccoon with a problem. Those two are night only.
 *
 * The delivered canvases are NOT the same size — the cat is 56x56 and the dog
 * 60x60 — so each animal's content box is measured against its own canvas and
 * the results are aligned bottom-center in one shared output frame. Sharing a
 * crop offset across canvases of different sizes would slide one of them.
 */
const ANIMALS = [
  { id: 'pablo', folder: 'cat-pablo', kind: 'cat', nocturnal: false, ambient: true },
  // Two more strays, unnamed. Once the dogs all became somebody's, Pablo was
  // the only animal loose by daylight and turned up on half the street looking
  // like a rendering fault. Three cats is a neighbourhood; one is a bug.
  { id: 'tabby', folder: 'cat2', kind: 'cat', nocturnal: false, ambient: true },
  { id: 'tuxedo', folder: 'cat3', kind: 'cat', nocturnal: false, ambient: true },
  { id: 'gus', folder: 'dog-gus', kind: 'dog', nocturnal: false, ambient: false },
  { id: 'armadillo', folder: 'armadillo', kind: 'armadillo', nocturnal: true, ambient: true },
  { id: 'raccoon', folder: 'raccoon', kind: 'raccoon', nocturnal: true, ambient: true },
  // NAMED PETS ARE NEVER STRAYS. Every one of these belongs to a couple and is
  // out either with them or, if a notice has gone up, lost — in which case it
  // roams and has to be found. What none of them ever is is ambient wildlife
  // turning up loose in a stranger's yard, which is what `ambient` gates.
  // Pablo is the exception and stays ambient: he is the neighbourhood's cat.
  { id: 'juniper', folder: 'dog-juniper', kind: 'dog', nocturnal: false, ambient: false },
  { id: 'pellet', folder: 'dog-pellet', kind: 'dog', nocturnal: false, ambient: false },
  { id: 'lani', folder: 'dog-lani', kind: 'dog', nocturnal: false, ambient: false },
  { id: 'moxy', folder: 'dog-moxy', kind: 'dog', nocturnal: false, ambient: false },
  // The Shift 2 bounty. He roams the lot he is hiding on, which is what makes
  // finding him a search rather than a spot-the-difference.
  { id: 'chaz', folder: 'cat-chaz', kind: 'cat', nocturnal: false, ambient: false },
];

/**
 * FIND the walk rather than know where it is.
 *
 * Every export so far has put the frames at `<something>/animations/<walk>/<dir>`
 * and disagreed about both middle names. Three shapes have turned up already:
 *
 *   cat-pablo    walking/animations/Walking/<dir>
 *   raccoon      Idle/animations/walking/<dir>
 *   dog-pellet   top_down_perspective_tan_pit_mix.../animations/Walking/<dir>
 *
 * The last one is the reason this is a search and not a list: the container is
 * named after the PROMPT that generated the animal, so it is different for
 * every one of them and cannot be enumerated in advance. Matching on the shape
 * — any folder holding `animations/` with a walk inside — is stable against
 * whatever the next export calls itself.
 *
 * Cached per animal: the scan is cheap but it runs once per direction.
 */
const walkBases = new Map<string, string[]>();
function basesFor(folder: string): string[] {
  const hit = walkBases.get(folder);
  if (hit) return hit;
  const root = `assets/animals/${folder}`;
  const found: string[] = [];
  for (const sub of readdirSync(root)) {
    const anim = `${root}/${sub}/animations`;
    if (!existsSync(anim) || !statSync(anim).isDirectory()) continue;
    for (const a of readdirSync(anim)) {
      // "Walking", "walking", "Walk" — the case and the suffix both drift.
      if (a.toLowerCase().startsWith('walk')) found.push(`${anim}/${a}`);
    }
  }
  walkBases.set(folder, found);
  return found;
}

const framesFor = (folder: string, dir: string): string[] => {
  for (const base of basesFor(folder)) {
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
      _generated: 'tools/pack-animals.ts — do not hand-edit; run `npm run pack-animals`',
      sheet: SHEET_OUT,
      frameW: fw,
      frameH: fh,
      cols,
      /** row = animalIndex * 4 + direction, directions 0 S, 1 W, 2 E, 3 N. */
      dirs: DIRS.length,
      /**
       * Frames in each row's own walk cycle, which is NOT `cols`.
       *
       * `cols` is how wide the sheet had to be for the longest walk anybody
       * shipped, and every shorter row is padded out to it with empty frames.
       * Cycling on `cols` therefore ran each animal through however many blanks
       * its row was padded with — one whole frame of nothing per lap, which
       * reads as a blink. Cycle on this instead.
       */
      lens: rows.map((r) => r.frames.length),
      animals: ANIMALS.map((a) => a.id),
      /** What it says when clicked. */
      kinds: ANIMALS.map((a) => a.kind),
      /** Out only on night levels. See makeAnimal. */
      nocturnal: ANIMALS.map((a) => a.nocturnal),
      /** Eligible to turn up loose in a yard. See animalsAbroad. */
      ambient: ANIMALS.map((a) => a.ambient),
      boxes,
    },
    null,
    2,
  )}\n`,
);

console.log(`${rows.length} rows x ${cols} frames of ${fw}x${fh} -> ${SHEET_OUT} (${sheetW}x${sheetH})`);
ANIMALS.forEach((a, i) => console.log(`  ${a.id} (${a.kind}) content ${boxes[i].w}x${boxes[i].h}`));
