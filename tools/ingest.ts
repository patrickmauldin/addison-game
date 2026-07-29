/**
 * ASSET INGEST — the gate between delivered art and the compositor.
 *
 * Reads assets/houses/raw/*.png, checks it is exportable, copies it through to
 * assets/houses/ and publishes an index the browser can load.
 *
 * It no longer quantises. The palette lock existed to keep procedurally
 * generated layers consistent with each other; imposed on hand-authored art it
 * would only flatten it. What survives is the checking that art cannot
 * self-report: hard alpha, sane size, and whether the file is even readable.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyse, decodePng, encodePng } from '../src/core/png.js';
import { BAND, CANVAS_W } from '../src/core/scene.js';

const RAW = 'assets/houses/raw';
const OUT = 'assets/houses';

// A house sits centred, its base on the house band. Anything wildly outside
// that envelope will not land where the driveway and walk expect it.
const MAX_W = CANVAS_W;
const MAX_H = BAND.houseBase - BAND.houseTop + 40;

if (!existsSync(RAW)) {
  console.log(`no ${RAW}/ — nothing to ingest.`);
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const files = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.png'));
let failures = 0;

for (const f of files) {
  const id = f.replace(/\.png$/i, '');
  let bmp;
  try {
    bmp = decodePng(readFileSync(`${RAW}/${f}`));
  } catch (e) {
    console.log(`\n${id}\n  !! cannot decode: ${(e as Error).message}`);
    failures++;
    continue;
  }
  const rep = analyse(bmp.rgba);
  writeFileSync(`${OUT}/${id}.png`, encodePng(bmp.rgba, bmp.w, bmp.h));

  console.log(`\n${id}`);
  console.log(`  ${bmp.w} x ${bmp.h} px   ${rep.opaque} opaque (${((rep.opaque / rep.pixels) * 100).toFixed(0)}%)`);
  console.log(`  distinct colours   : ${rep.colours}`);

  if (rep.softAlpha > 0) {
    console.log(`  !! ${rep.softAlpha} px partial alpha. Feathered edges halo against the grass`);
    console.log(`     tile. Export with hard 1-bit alpha.`);
    failures++;
  }
  if (bmp.w > MAX_W || bmp.h > MAX_H) {
    console.log(`  !! ${bmp.w}x${bmp.h} exceeds the house envelope (${MAX_W}x${MAX_H}).`);
    console.log(`     It will overhang the frame or the road band.`);
  }
  if (rep.opaque === 0) {
    console.log(`  !! fully transparent.`);
    failures++;
  }
}

// The browser cannot list a directory, so ingest publishes what it produced.
const ids = files.map((f) => f.replace(/\.png$/i, ''));
writeFileSync(`${OUT}/index.json`, JSON.stringify({ sprites: ids }, null, 2) + '\n');
console.log(`\nwrote ${OUT}/index.json  (${ids.length} sprite(s))`);
console.log(`${failures ? '✗' : '✓'} ingest: ${files.length} file(s), ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
