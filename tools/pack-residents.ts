/**
 * RESIDENT PACKER — build a street's worth of people out of the char-pack.
 *
 * assets/char-pack/ is a paper-doll set: base body, hair, top, bottom, feet, all
 * on identical 384x1584 sheets (8 cols x 33 rows of 48x48). Compositing the
 * layers in the pack's documented order yields a character; different
 * combinations yield different people. Five skins, twenty hairs, twenty-eight
 * tops and twenty-eight bottoms is far more variety than any single delivered
 * model, which is the whole reason to build them this way.
 *
 * We use three of its sixteen animations. Frames run as one flat stream across
 * the grid, verified against the premade sheets rather than read off the guide
 * image — the check that settles it is that walk[1] and idle[0] are the same
 * bytes in every direction, which only holds if the offsets are right:
 *
 *   idle    0..7   — down 0-1, left 2-3, right 4-5, up 6-7
 *   walk   16..31  — down 16-19, left 20-23, right 24-27, up 28-31
 *   hoe   116..131 | axe 132..147 | watering 196..223, same four-block pattern
 *
 * Output is generated. Re-run with `npm run pack-residents`; do not hand-edit
 * assets/residents.png or src/data/residents.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Bitmap, decodePng, encodePng } from '../src/core/png.js';

const PACK = 'assets/char-pack';
const SHEET_OUT = 'assets/residents.png';
const META_OUT = 'src/data/residents.json';

const F = 48;
const GRID_COLS = 8;
/** Direction order 0 S, 1 W, 2 E, 3 N — matches Walker's own Dir enum. */
const IDLE = [0, 2, 4, 6];
const WALK = [16, 20, 24, 28];
const WALK_LEN = 4;
const IDLE_LEN = 2;

/**
 * Yard tools.
 *
 * The pack ships four implements: hoe, axe, pickaxe and watering can. There is
 * NO shovel — so `shovel` here is the axe animation, whose head is a broad
 * blade in line with the shaft (unlike the pickaxe's two points) and whose
 * swing is a digging motion. At the size these render, the head is a handful of
 * pixels and reads as a spade. If a real shovel is ever added this is one line.
 *
 * `start` is the DOWN-facing block and each direction follows at a fixed stride
 * of `hold.length`, in the pack's own order: down, left, right, up. Frame holds
 * are its suggested timings, in seconds.
 */
const TOOLS = {
  hoe: { start: 116, hold: [0.15, 0.25, 0.15, 0.15] },
  shovel: { start: 132, hold: [0.15, 0.25, 0.15, 0.15] },
  watering: { start: 196, hold: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] },
} as const;
type ToolName = keyof typeof TOOLS;

/**
 * Which way a worker can face while using a tool: down, left, right.
 *
 * Not up. The whole point of the animation is watching somebody work, and with
 * their back turned the tool spends most of the swing hidden behind them.
 */
const TOOL_DIRS = [0, 1, 2] as const;

/**
 * Layers are listed HIGHEST first, matching the pack's own ordering docs
 * (1_Tools > 2_Hats > 3_Hair > 4_Tops > 5_Bottoms > 6_Feet > 7_Base >
 * 8_Tools_Under). `tops` takes a list because overalls are a top worn over
 * another top — the pack's documented recipe, used here for the gardener.
 */
type Outfit = {
  name: string;
  skin: string;
  hair: string;
  tops: string[];
  bottom: string;
  feet: string;
  /** 2_Hats, above the hair. The pack ships exactly one: `straw`. */
  hat?: string;
  /**
   * A named person who turns up as themselves, not as filler.
   *
   * Kept out of the random draw entirely — weight 0 — so they appear only where
   * something puts them. Somebody the player is meant to recognise loses that
   * the moment they can also be the anonymous stranger on the next lot.
   */
  cameo?: boolean;
};

/**
 * Skins that should be uncommon on this street, and how much of the population
 * they add up to between them.
 *
 * Handled as a SELECTION weight rather than by dropping them from the cast:
 * cutting them would cost two characters' worth of variety, and with ten
 * characters the composition alone can only express tenths — 1 is 10% and 2 is
 * 20%, neither of which is 15%. Weighting hits the number exactly and leaves
 * the mix a single constant to retune.
 */
const RARE_SKINS = new Set(['skin1', 'skin2']);
const RARE_SHARE = 0.15;

/**
 * Ten residents, written out rather than generated from random draws: a street
 * should look deliberately populated, and an explicit table is reviewable when
 * one of them turns out to read badly at this size.
 *
 * Skins 3, 4 and 5 carry the street; 1 and 2 appear on two characters and are
 * weighted down to RARE_SHARE between them.
 */
const CAST: Outfit[] = [
  { name: 'tshirt-blue',    skin: 'skin5', hair: 'style1_blonde',      tops: ['tshirt_blue'],                       bottom: 'shorts_grey',       feet: 'boots_brown' },
  { name: 'sleeves-white',  skin: 'skin3', hair: 'style2_dark_brown',  tops: ['long_sleeve_white'],                 bottom: 'pants_blue',        feet: 'boots_brown' },
  { name: 'tshirt-green',   skin: 'skin4', hair: 'style3_red',         tops: ['tshirt_green'],                      bottom: 'short_skirt_white', feet: 'boots_grey' },
  { name: 'vest-red',       skin: 'skin5', hair: 'style4_med_brown',   tops: ['sleeveless_red'],                    bottom: 'shorts_brown',      feet: 'boots_brown' },
  { name: 'sleeves-gray',   skin: 'skin3', hair: 'style1_light_brown', tops: ['long_sleeve_grey'],                  bottom: 'pants_grey',        feet: 'boots_grey' },
  { name: 'tshirt-purple',  skin: 'skin4', hair: 'style3_dark_brown',  tops: ['tshirt_purple'],                     bottom: 'pants_brown',       feet: 'boots_brown' },
  { name: 'skirt-blue',     skin: 'skin1', hair: 'style4_blonde',      tops: ['sleeveless_white'],                  bottom: 'long_skirt_blue',   feet: 'boots_grey'  },
  { name: 'overalls-blue',  skin: 'skin5', hair: 'style2_med_brown',   tops: ['overalls_blue', 'long_sleeve_red'],  bottom: 'pants_blue',        feet: 'boots_brown' },
  { name: 'tshirt-white',   skin: 'skin3', hair: 'style1_red',         tops: ['tshirt_white'],                      bottom: 'shorts_green',      feet: 'boots_grey'  },
  { name: 'skirt-purple',   skin: 'skin2', hair: 'style3_blonde',      tops: ['long_sleeve_purple'],                bottom: 'long_skirt_purple', feet: 'boots_brown' },

  // Named residents, from assets/characters.rtf. APPENDED, never inserted: a
  // character is referred to by its INDEX into this table, so slipping a row
  // into the middle would change who lives on every lot in the game.
  //
  // Six couples, each with a dog. The pets are not built here — they live in
  // assets/animals/ and are the animal packer's business — but they are noted
  // beside their owners so the pairing has one home rather than two.
  { name: 'patrick',        skin: 'skin5', hair: 'style3_med_brown',   tops: ['tshirt_white'],                      bottom: 'pants_blue',        feet: 'boots_brown', cameo: true }, // + savanna, dog-juniper
  { name: 'savanna',        skin: 'skin4', hair: 'style1_blonde',      tops: ['sleeveless_blue'],                   bottom: 'short_skirt_white', feet: 'boots_grey',  cameo: true },
  { name: 'jake',           skin: 'skin5', hair: 'style4_light_brown', tops: ['overalls_blue'],                     bottom: 'pants_blue',        feet: 'boots_brown', hat: 'straw', cameo: true }, // + sam, dog-gus
  { name: 'sam',            skin: 'skin4', hair: 'style2_blonde',      tops: ['sleeveless_green'],                  bottom: 'short_skirt_white', feet: 'boots_brown', cameo: true },
  { name: 'casey',          skin: 'skin4', hair: 'style3_dark_brown',  tops: ['tshirt_red'],                        bottom: 'shorts_grey',       feet: 'boots_brown', cameo: true }, // + jess, dog-pellet
  { name: 'jess',           skin: 'skin5', hair: 'style2_dark_brown',  tops: ['sleeveless_purple'],                 bottom: 'short_skirt_white', feet: 'boots_brown', cameo: true },
  { name: 'garret',         skin: 'skin4', hair: 'style3_dark_brown',  tops: ['overalls_grey'],                     bottom: 'pants_grey',        feet: 'boots_brown', cameo: true }, // + sonya, dog-lani
  { name: 'sonya',          skin: 'skin4', hair: 'style1_dark_brown',  tops: ['tshirt_purple'],                     bottom: 'shorts_white',      feet: 'boots_grey',  cameo: true },
  { name: 'scott',          skin: 'skin4', hair: 'style4_med_brown',   tops: ['long_sleeve_brown'],                 bottom: 'pants_grey',        feet: 'boots_brown', cameo: true }, // + rachel, dog-moxy
  { name: 'rachel',         skin: 'skin4', hair: 'style1_light_brown', tops: ['tshirt_white'],                      bottom: 'shorts_blue',       feet: 'boots_brown', cameo: true },
  { name: 'cj',             skin: 'skin3', hair: 'style3_dark_brown',  tops: ['long_sleeve_white'],                 bottom: 'pants_green',       feet: 'boots_brown', cameo: true }, // + liz, cat-chaz
  { name: 'liz',            skin: 'skin5', hair: 'style1_light_brown', tops: ['long_sleeve_green'],                 bottom: 'short_skirt_white', feet: 'boots_brown', cameo: true },

  // Black head to foot. The pack shipped no black at all until these four
  // layers arrived — one hair, one top, one bottom, one pair of boots — so this
  // is the only outfit that can be built in it, and every piece is spoken for.
  { name: 'thief',          skin: 'skin3', hair: 'style4_black',        tops: ['long_sleeve_black'],                 bottom: 'pants_black',       feet: 'boots_black',  cameo: true },
];

/**
 * Relative odds of each character turning up, normalized to RARE_SHARE.
 *
 * Cameos are excluded from the draw AND from the counts the rest are divided
 * by, so adding a named person does not quietly thin everybody else out.
 */
const drawable = CAST.filter((c) => !c.cameo);
const rareCount = drawable.filter((c) => RARE_SKINS.has(c.skin)).length;
const commonCount = drawable.length - rareCount;
const CAST_WEIGHTS = CAST.map((c) =>
  c.cameo
    ? 0
    : RARE_SKINS.has(c.skin)
      ? RARE_SHARE / Math.max(1, rareCount)
      : (1 - RARE_SHARE) / Math.max(1, commonCount),
);

const load = (rel: string): Bitmap => {
  const p = `${PACK}/${rel}`;
  if (!existsSync(p)) {
    console.error(`missing layer: ${p}`);
    process.exit(1);
  }
  return decodePng(readFileSync(p));
};

/** Straight source-over of one full sheet onto another. */
function over(dst: Bitmap, src: Bitmap): void {
  if (src.w !== dst.w || src.h !== dst.h) {
    console.error('layer sheets differ in size; the pack is supposed to guarantee they do not.');
    process.exit(1);
  }
  for (let i = 0; i < dst.rgba.length; i += 4) {
    const sa = src.rgba[i + 3] / 255;
    if (sa === 0) continue;
    const da = dst.rgba[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++)
      dst.rgba[i + c] = Math.round((src.rgba[i + c] * sa + dst.rgba[i + c] * da * (1 - sa)) / oa);
    dst.rgba[i + 3] = Math.round(oa * 255);
  }
}

/**
 * Composite one outfit, lowest layer up.
 *
 * Tool layers are only added for the rows that need them: a tool sheet has
 * content in frames we do not ship as well, and building the walking rows from
 * a tool-free composite means never having to assume otherwise.
 */
function build(o: Outfit, withTool: boolean): Bitmap {
  const base = load(`7_Base/Base_${o.skin}.png`);
  const sheet: Bitmap = { w: base.w, h: base.h, rgba: new Uint8ClampedArray(base.rgba) };
  if (withTool) {
    // 8_Tools_Under is the LOWEST layer, so it has to go under the body — which
    // means starting from it rather than painting it onto the base.
    const under = load('8_Tools_Under/Tools_Under_basic.png');
    const merged: Bitmap = { w: under.w, h: under.h, rgba: new Uint8ClampedArray(under.rgba) };
    over(merged, sheet);
    sheet.rgba = merged.rgba;
  }
  over(sheet, load(`6_Feet/Feet_${o.feet}.png`));
  over(sheet, load(`5_Bottoms/Bottoms_${o.bottom}.png`));
  // tops are listed highest-first, so paint them back to front
  for (const t of [...o.tops].reverse()) over(sheet, load(`4_Tops/Tops_${t}.png`));
  over(sheet, load(`3_Hair/Hair_${o.hair}.png`));
  if (o.hat) over(sheet, load(`2_Hats/Hats_${o.hat}.png`));
  if (withTool) over(sheet, load('1_Tools/Tools_basic.png'));
  return sheet;
}

const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

const plain = CAST.map((o) => build(o, false));
// Every character gets every tool. Which one somebody is holding is a fact
// about their afternoon, not about who they are, so the LOT picks it — and that
// only works if any resident can be handed any implement.
const armed = CAST.map((o) => build(o, true));

/** Walk cycle then the two idle frames — what every direction row holds. */
const moveFrames = (dir: number): number[] => [
  ...Array.from({ length: WALK_LEN }, (_, i) => WALK[dir] + i),
  ...Array.from({ length: IDLE_LEN }, (_, i) => IDLE[dir] + i),
];

/** Frames of one tool in one direction. Directions are blocks of hold.length. */
const toolFrames = (t: ToolName, dir: number): number[] =>
  TOOLS[t].hold.map((_, i) => TOOLS[t].start + dir * TOOLS[t].hold.length + i);

const COLS = Math.max(
  WALK_LEN + IDLE_LEN,
  ...(Object.keys(TOOLS) as ToolName[]).map((t) => TOOLS[t].hold.length),
);

const src = (s: Bitmap, frame: number, x: number, y: number): number =>
  (((Math.floor(frame / GRID_COLS) * F + y) * s.w) + (frame % GRID_COLS) * F + x) * 4;

/** Content box of a set of frames within one composited sheet. */
function boxOf(sheets: (Bitmap | null)[], frames: (i: number) => number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  sheets.forEach((s, i) => {
    if (!s) return;
    for (const f of frames(i))
      for (let y = 0; y < F; y++)
        for (let x = 0; x < F; x++) {
          if (s.rgba[src(s, f, x, y) + 3] === 0) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
  });
  return { x0, y0, x1, y1 };
}

// The PERSON's box, from walking and idling only. This is what fixes where the
// figure sits — their center line and the ground under their feet.
const person = boxOf(plain, () => [0, 1, 2, 3].flatMap(moveFrames));
// The full box, tools included. A swung hoe reaches well above the head and out
// to one side, so the frame has to be bigger than the person — but it must not
// be allowed to move the person, which is why the two are measured separately.
const full = boxOf(
  [...plain, ...armed],
  (i) => (i < plain.length
    ? [0, 1, 2, 3].flatMap(moveFrames)
    : TOOL_NAMES.flatMap((t) => TOOL_DIRS.flatMap((d) => toolFrames(t, d)))),
);

const x0 = Math.min(person.x0, full.x0);
const y0 = Math.min(person.y0, full.y0);
const x1 = Math.max(person.x1, full.x1);
const y1 = Math.max(person.y1, full.y1);
const fw = x1 - x0 + 1;
const fh = y1 - y0 + 1;

// Where the person is inside that frame — NOT the frame's own middle and floor,
// which the tool sweep has pushed off to one side.
const centerX = (person.x0 + person.x1) / 2 - x0 + 0.5;
const ground = person.y1 - y0 + 1;

/**
 * Rows, in a fixed stride per character: four move directions, then one row per
 * tool. A stride keeps the lookup arithmetic rather than a table.
 */
const ROWS_PER_CHARACTER = 4 + TOOL_NAMES.length * TOOL_DIRS.length;
type Row = { sheet: Bitmap; frames: number[]; label: string };
const rows: Row[] = [];
CAST.forEach((c, ci) => {
  for (let d = 0; d < 4; d++)
    rows.push({ sheet: plain[ci], frames: moveFrames(d), label: `${c.name}:move${d}` });
  for (const t of TOOL_NAMES)
    for (const d of TOOL_DIRS)
      rows.push({ sheet: armed[ci], frames: toolFrames(t, d), label: `${c.name}:${t}${d}` });
});

const sheetW = fw * COLS;
const sheetH = fh * rows.length;
const out = new Uint8ClampedArray(sheetW * sheetH * 4);

rows.forEach((r, ri) => {
  r.frames.forEach((f, col) => {
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        if (sx < 0 || sy < 0 || sx >= F || sy >= F) continue;
        const si = src(r.sheet, f, sx, sy);
        const di = ((ri * fh + y) * sheetW + col * fw + x) * 4;
        out[di] = r.sheet.rgba[si];
        out[di + 1] = r.sheet.rgba[si + 1];
        out[di + 2] = r.sheet.rgba[si + 2];
        out[di + 3] = r.sheet.rgba[si + 3];
      }
  });
});

writeFileSync(SHEET_OUT, encodePng(out, sheetW, sheetH));
writeFileSync(
  META_OUT,
  `${JSON.stringify(
    {
      _generated: 'tools/pack-residents.ts — do not hand-edit; run `npm run pack-residents`',
      sheet: SHEET_OUT,
      frameW: fw,
      frameH: fh,
      cols: COLS,
      walkLen: WALK_LEN,
      idleLen: IDLE_LEN,
      characters: CAST.map((c) => c.name),
      skins: CAST.map((c) => c.skin),
      /** How often each character should turn up. Sums to 1. */
      pick: CAST_WEIGHTS,
      /**
       * Moving:  row = character * rowsPerCharacter + direction
       * Working: row = character * rowsPerCharacter + 4 + toolIndex * toolDirs + dirIndex
       * Directions are 0 S, 1 W, 2 E, 3 N; tools only exist for the first three.
       */
      rowsPerCharacter: ROWS_PER_CHARACTER,
      dirsPerCharacter: 4,
      toolDirs: TOOL_DIRS.length,
      /** Tool rows, in row order after the four move directions. */
      tools: TOOL_NAMES.map((t) => ({ name: t, hold: [...TOOLS[t].hold] })),
      /** Where the PERSON is in the frame; the tool sweep is not centerd on them. */
      centerX,
      ground,
      contentH: person.y1 - person.y0 + 1,
      crop: { x: x0, y: y0, w: fw, h: fh, from: { w: F, h: F } },
    },
    null,
    2,
  )}\n`,
);

console.log(`${rows.length} rows x ${COLS} frames of ${fw}x${fh} -> ${SHEET_OUT} (${sheetW}x${sheetH})`);
console.log(`crop x ${x0}..${x1} y ${y0}..${y1}; person x ${person.x0}..${person.x1} y ${person.y0}..${person.y1}`);
console.log(`centerX ${centerX}, ground ${ground}, person height ${person.y1 - person.y0 + 1}`);
console.log(`${ROWS_PER_CHARACTER} rows each: 4 move + ${TOOL_NAMES.length} tools x ${TOOL_DIRS.length} facings`);
const rareShare = CAST.reduce((n, c, i) => n + (RARE_SKINS.has(c.skin) ? CAST_WEIGHTS[i] : 0), 0);
console.log('skins: ' + [...new Set(CAST.map((c) => c.skin))].sort()
  .map((sk) => `${sk} x${CAST.filter((c) => c.skin === sk).length}`).join(', '));
console.log(`${[...RARE_SKINS].join('+')} are ${(rareShare * 100).toFixed(1)}% of appearances`);
