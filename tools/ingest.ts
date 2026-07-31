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
import { analyze, decodePng, encodePng } from '../src/core/png.js';

const RAW = 'assets/houses/raw';
const OUT = 'assets/houses';

/**
 * A SANITY BOUND, not a layout truth.
 *
 * These used to be BAND and CANVAS_W off the scene module, from back when the
 * scene was a fixed canvas with fixed bands. It is laid out from the viewport
 * now, those constants are gone, and this file had been failing to compile ever
 * since — unnoticed, because tsconfig only looked at src/. It looks at tools/
 * too now.
 *
 * There is no longer a fixed envelope to check against: the compositor scales a
 * house to whatever the frame is. What is still worth catching is art delivered
 * at an absurd size, which is a mistake rather than a style. Every house shipped
 * so far is around 1000px wide.
 */
const MAX_W = 2400;
const MAX_H = 2400;

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
  const rep = analyze(bmp.rgba);
  writeFileSync(`${OUT}/${id}.png`, encodePng(bmp.rgba, bmp.w, bmp.h));

  console.log(`\n${id}`);
  console.log(`  ${bmp.w} x ${bmp.h} px   ${rep.opaque} opaque (${((rep.opaque / rep.pixels) * 100).toFixed(0)}%)`);
  console.log(`  distinct colors   : ${rep.colors}`);

  // Partial alpha is EXPECTED — it is how the sprites carry their drop
  // shadows. Only flag art that is almost entirely translucent, which means an
  // accidental layer-opacity export rather than a deliberate shadow.
  if (rep.opaque > 0 && rep.softAlpha / rep.opaque > 0.7) {
    console.log(`  !! ${rep.softAlpha} of ${rep.opaque} px are partially transparent.`);
    console.log(`     That looks like a layer exported at reduced opacity, not a shadow.`);
    failures++;
  }
  if (bmp.w > MAX_W || bmp.h > MAX_H) {
    console.log(`  !! ${bmp.w}x${bmp.h} is far larger than any house shipped so far.`);
    console.log(`     Check it was exported at the intended size.`);
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
