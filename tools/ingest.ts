/**
 * ASSET INGEST — the gate between outside art and the compositor.
 *
 * Reads assets/houses/raw/*.png, snaps every pixel onto the locked Tier 0
 * palette, and writes the conformant sprite to assets/houses/.
 *
 * The manifest warns that generative art will drift on iso angle, light
 * direction, grid alignment and palette. Three of those a human has to judge.
 * The fourth is mechanical, and this is where it gets enforced — once, on the
 * way in, instead of being trusted per-asset forever.
 *
 * It also reports the numbers you need to decide whether the art is usable at
 * all. A high mean shift means the source is nowhere near the palette and
 * snapping it will look muddy; that is a re-author signal, not a green light.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../src/core/png.js';
import { quantize } from '../src/core/quantize.js';
import type { HouseManifest } from '../src/gen/sprite.js';

const RAW = 'assets/houses/raw';
const OUT = 'assets/houses';

// Expected sprite envelope, from the lot template. Not a hard failure — a
// porch or a chimney can legitimately overhang — but a large miss means the
// art was authored at the wrong scale and every anchor will be off.
const EXPECT = { w: 278, h1: 259, h2: 317, tol: 0.12 };

if (!existsSync(RAW)) {
  console.log(`no ${RAW}/ — nothing to ingest. Run "npm run standin" to create test sprites.`);
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.png'));
if (!files.length) {
  console.log(`${RAW}/ is empty.`);
  process.exit(0);
}

let failures = 0;

for (const f of files) {
  const id = f.replace(/\.png$/i, '');
  const bmp = decodePng(readFileSync(`${RAW}/${f}`));
  const report = quantize(bmp.rgba);

  const manifestPath = `${OUT}/${id}.json`;
  const manifest: HouseManifest | null = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as HouseManifest)
    : null;

  writeFileSync(`${OUT}/${id}.png`, encodePng(bmp.rgba, bmp.w, bmp.h));

  const pctExact = (report.alreadyExact / Math.max(1, report.opaque)) * 100;
  console.log(`\n${id}`);
  console.log(`  ${bmp.w} x ${bmp.h} px   ${report.opaque} opaque (${((report.opaque / report.pixels) * 100).toFixed(0)}%)`);
  console.log(`  already on-palette : ${pctExact.toFixed(1)}%`);
  console.log(`  colour shift       : mean ${report.meanShift.toFixed(1)}  max ${report.maxShift.toFixed(0)}  (0-255 per channel)`);

  if (report.meanShift > 18) {
    console.log(`  !! mean shift is high. This art is far from the palette; snapping it will`);
    console.log(`     look muddy. Re-author against the palette rather than shipping this.`);
    failures++;
  }

  // Scale sanity
  const expectH = manifest?.stories === 2 ? EXPECT.h2 : EXPECT.h1;
  const dw = Math.abs(bmp.w - EXPECT.w) / EXPECT.w;
  const dh = Math.abs(bmp.h - expectH) / expectH;
  if (dw > EXPECT.tol || dh > EXPECT.tol) {
    console.log(`  !! size is ${bmp.w}x${bmp.h}, expected about ${EXPECT.w}x${expectH}.`);
    console.log(`     Off-scale art puts the garage anchor in the wrong place.`);
  }

  console.log(`  ramps used:`);
  for (const r of report.ramps.slice(0, 8))
    console.log(`      ${(r.share * 100).toFixed(1).padStart(5)}%  ${r.key}`);
  if (report.ramps.length > 8) console.log(`      ... and ${report.ramps.length - 8} more`);

  if (!manifest) {
    console.log(`  !! no ${manifestPath}. The sprite cannot be placed without one —`);
    console.log(`     it needs origin, garage_anchor, door_anchor, eave_line and ramps.`);
    failures++;
  } else {
    const declared = Object.entries(manifest.ramps).filter(([, v]) => v);
    for (const [role, key] of declared) {
      const used = report.ramps.find((r) => r.key === key);
      if (!used) {
        console.log(`  !! manifest says ${role} = "${key}" but no pixel quantised to that ramp.`);
        console.log(`     Repainting ${role} would do nothing. Pick from the list above.`);
        failures++;
      }
    }
  }
}

// The browser cannot list a directory, so ingest publishes what it produced.
// Sprites without a manifest are excluded — they cannot be placed anyway.
const ids = files
  .map((f) => f.replace(/\.png$/i, ''))
  .filter((id) => existsSync(`${OUT}/${id}.json`));
writeFileSync(`${OUT}/index.json`, JSON.stringify({ sprites: ids }, null, 2) + '\n');
console.log(`\nwrote ${OUT}/index.json  (${ids.length} placeable)`);

console.log(`${failures ? '✗' : '✓'} ingest: ${files.length} sprite(s), ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
