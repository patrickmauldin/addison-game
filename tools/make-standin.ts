/**
 * Produces a stand-in house sprite by rendering the procedural house kit onto
 * a transparent canvas and auto-cropping it.
 *
 * Two reasons this is the right stand-in rather than a scrap of the logo:
 *
 *  1. It is already exactly on-palette, so running it through ingest proves the
 *     quantiser is identity-safe on conformant art — it must not move a single
 *     pixel. A quantiser that "fixes" already-correct art is worse than none.
 *  2. It is at the correct 2:1 angle and light direction, so it drops into a
 *     rendered lot and the procedural driveway meets its garage. That exercises
 *     the manifest anchors, which is the part most likely to be wrong.
 *
 * Real art replaces the PNG; the manifest and anchors stay.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Raster } from '../src/core/raster.js';
import { CANVAS_H, CANVAS_W, iso } from '../src/core/projection.js';
import { drawHouse, type HouseSpec } from '../src/gen/house.js';
import { encodePng } from '../src/core/png.js';
import type { HouseManifest } from '../src/gen/sprite.js';
import lot04 from '../src/data/lots/bonerville_04.json';
import lot07 from '../src/data/lots/bonerville_07.json';

// Derived from the real lot shells, INCLUDING their seeds. That makes the
// sprite byte-identical to what the generator draws for those lots, so the
// swap can be proven to be a drop-in rather than merely looking close.
const SHELLS: Array<{ id: string; spec: HouseSpec }> = [
  { id: 'ranch_a', spec: { ...(lot04.shell as any), seed: lot04.seed } as HouseSpec },
  { id: 'ranch_b', spec: { ...(lot07.shell as any), seed: lot07.seed } as HouseSpec },
];

mkdirSync('assets/houses/raw', { recursive: true });

for (const { id, spec } of SHELLS) {
  // No clear() — the raster starts fully transparent, and px() only sets
  // alpha on write. So untouched pixels stay transparent for free.
  const r = new Raster(CANVAS_W, CANVAS_H);
  drawHouse(r, spec);

  // Auto-crop to the opaque bounding box; the crop origin becomes the sprite's
  // placement origin, so anchors stay correct by construction.
  let x0 = CANVAS_W, y0 = CANVAS_H, x1 = -1, y1 = -1;
  for (let y = 0; y < CANVAS_H; y++)
    for (let x = 0; x < CANVAS_W; x++)
      if (r.color[((y * CANVAS_W + x) << 2) + 3] !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;

  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * CANVAS_W + (x0 + x)) << 2;
      const d = (y * w + x) << 2;
      out[d] = r.color[s]; out[d + 1] = r.color[s + 1];
      out[d + 2] = r.color[s + 2]; out[d + 3] = r.color[s + 3];
    }
  writeFileSync(`assets/houses/raw/${id}.png`, encodePng(out, w, h));

  // Anchors, derived from the same grid coordinates the house kit used, so
  // they are guaranteed to agree with what was drawn.
  const garage = iso(14.7, 14.0, 0);
  const door = iso(9.6, 12.0, 0);
  const eaveL = iso(2.0, 12.45, 4.4);
  const eaveR = iso(11.5, 12.45, 4.4);

  const manifest: HouseManifest = {
    id,
    stories: 1,
    origin: [x0, y0],
    garage_anchor: [Math.round(garage.x), Math.round(garage.y)],
    door_anchor: [Math.round(door.x), Math.round(door.y)],
    eave_line: [Math.round(eaveL.x), Math.round(eaveL.y), Math.round(eaveR.x), Math.round(eaveR.y)],
    ramps: {
      siding: spec.upper_key,
      masonry: spec.lower_key,
      trim: spec.trim_key,
      roof: spec.roof_key,
    },
  };
  writeFileSync(`assets/houses/${id}.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${id}  ${w}x${h}px  origin [${x0},${y0}]  garage [${manifest.garage_anchor}]`);
}
console.log('\nwrote assets/houses/raw/*.png and assets/houses/*.json');
