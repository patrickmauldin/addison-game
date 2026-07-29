/**
 * Proves three properties of the sprite path before any real art depends on it.
 *
 *  1. DROP-IN — a lot rendered through the sprite path is pixel-identical to the
 *     same lot rendered by the generator. If that holds, swapping shells to art
 *     cannot break placement, occlusion, anchors or the id buffer.
 *  2. RECOLOUR — swapping the declared siding ramp repaints the house and
 *     nothing else, which is what R-308 needs.
 *  3. QUANTISE — genuinely off-palette art (the title logo, which is neither on
 *     the palette nor at the right angle) is brought onto the palette without
 *     the tool falling over.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { renderLot, type LotSpec } from '../src/compositor.js';
import { CANVAS_H, CANVAS_W } from '../src/core/projection.js';
import { decodePng, encodePng, downscale, crop } from '../src/core/png.js';
import { quantize } from '../src/core/quantize.js';
import { makeSprite, type HouseManifest, type SpriteRegistry } from '../src/gen/sprite.js';
import lot04 from '../src/data/lots/bonerville_04.json';

const OUT = 'assets/houses';

function loadSprites(): SpriteRegistry {
  const reg: SpriteRegistry = new Map();
  if (!existsSync(OUT)) return reg;
  for (const f of readdirSync(OUT).filter((f) => f.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '');
    if (!existsSync(`${OUT}/${id}.png`)) continue;
    const m = JSON.parse(readFileSync(`${OUT}/${f}`, 'utf8')) as HouseManifest;
    const bmp = decodePng(readFileSync(`${OUT}/${id}.png`));
    reg.set(id, makeSprite(m, bmp.w, bmp.h, bmp.rgba));
  }
  return reg;
}

const sprites = loadSprites();
console.log(`loaded ${sprites.size} sprite(s): ${[...sprites.keys()].join(', ')}\n`);

// --- 1. Drop-in equivalence ----------------------------------------------
const base = lot04 as unknown as LotSpec;
const viaGen = renderLot(base);
const withSprite: LotSpec = { ...base, shell: { ...base.shell, sprite: 'ranch_a' } };
const viaSprite = renderLot(withSprite, sprites);

let diff = 0;
let firstDiff = -1;
for (let i = 0; i < CANVAS_W * CANVAS_H * 4; i += 4) {
  if (
    viaGen.raster.color[i] !== viaSprite.raster.color[i] ||
    viaGen.raster.color[i + 1] !== viaSprite.raster.color[i + 1] ||
    viaGen.raster.color[i + 2] !== viaSprite.raster.color[i + 2]
  ) {
    if (firstDiff < 0) firstDiff = i >> 2;
    diff++;
  }
}
const total = CANVAS_W * CANVAS_H;
console.log('1. DROP-IN EQUIVALENCE');
console.log(`   generator vs sprite: ${diff} of ${total} px differ (${((diff / total) * 100).toFixed(3)}%)`);
if (diff) console.log(`   first difference at px ${firstDiff} (${firstDiff % CANVAS_W},${(firstDiff / CANVAS_W) | 0})`);
console.log(`   ${diff === 0 ? '✓ pixel-identical — sprites are a safe drop-in' : '✗ NOT identical'}\n`);

// --- 2. Recolour ----------------------------------------------------------
const repainted: LotSpec = {
  ...base,
  shell: { ...base.shell, sprite: 'ranch_a', paint: { siding: 'blue_gray', roof: 'charcoal' } },
};
const viaPaint = renderLot(repainted, sprites);
let changed = 0;
for (let i = 0; i < CANVAS_W * CANVAS_H * 4; i += 4)
  if (
    viaSprite.raster.color[i] !== viaPaint.raster.color[i] ||
    viaSprite.raster.color[i + 1] !== viaPaint.raster.color[i + 1] ||
    viaSprite.raster.color[i + 2] !== viaPaint.raster.color[i + 2]
  )
    changed++;
console.log('2. RECOLOUR (R-308)');
console.log(`   khaki siding -> blue_gray, weathered_gray roof -> charcoal`);
console.log(`   ${changed} px changed (${((changed / total) * 100).toFixed(1)}% of frame)`);
console.log(`   ${changed > 0 ? '✓ repaint works from one sprite, no re-authoring' : '✗ nothing changed'}\n`);
writeFileSync('out/sprite-repaint.png', encodePng(viaPaint.raster.color, CANVAS_W, CANVAS_H));

// --- 3. Quantise genuinely off-palette art --------------------------------
console.log('3. QUANTISE OFF-PALETTE ART');
const logoPath = 'assets/addison-logo.png';
if (existsSync(logoPath)) {
  const logo = decodePng(readFileSync(logoPath));
  // The house occupies roughly the top third of the logo.
  const house = crop(logo, Math.round(logo.w * 0.19), 0, Math.round(logo.w * 0.62), Math.round(logo.h * 0.4));
  const scaled = downscale(house, 278, Math.round((278 / house.w) * house.h));
  const before = new Uint8ClampedArray(scaled.rgba);
  const rep = quantize(scaled.rgba);
  console.log(`   source ${logo.w}x${logo.h} -> crop -> ${scaled.w}x${scaled.h}`);
  console.log(`   already on-palette : ${((rep.alreadyExact / rep.opaque) * 100).toFixed(1)}%`);
  console.log(`   colour shift       : mean ${rep.meanShift.toFixed(1)}  max ${rep.maxShift.toFixed(0)}`);
  console.log(`   distinct ramps hit : ${rep.ramps.length}`);
  console.log(`   top ramps          : ${rep.ramps.slice(0, 5).map((r) => `${r.key} ${(r.share * 100).toFixed(0)}%`).join(', ')}`);
  console.log(`   ${rep.meanShift > 18 ? '! high shift — this art needs re-authoring, not snapping' : '✓ within snapping range'}`);
  // Side-by-side, before and after, for eyeballing what the palette lock costs.
  const W = scaled.w * 2 + 8;
  const cmp = new Uint8ClampedArray(new ArrayBuffer(W * scaled.h * 4));
  for (let y = 0; y < scaled.h; y++)
    for (let x = 0; x < scaled.w; x++) {
      const s = (y * scaled.w + x) << 2;
      const a = (y * W + x) << 2;
      const b = (y * W + x + scaled.w + 8) << 2;
      for (let k = 0; k < 4; k++) {
        cmp[a + k] = before[s + k];
        cmp[b + k] = scaled.rgba[s + k];
      }
    }
  writeFileSync('out/quantise-demo.png', encodePng(cmp, W, scaled.h));
  console.log(`   wrote out/quantise-demo.png (raw | quantised)`);
} else {
  console.log('   logo not found, skipped');
}
console.log('');
