/**
 * Headless lot renderer. Writes each lot in the route to out/<lot_id>.png.
 *
 * This exists so the art can be reviewed without a browser, and so a future
 * validator can diff renders in CI. It shares the exact compositor the game
 * uses — there is no second render path to drift out of sync.
 *
 *   npx esbuild tools/render.ts --bundle --platform=node --outfile=dist/render.cjs
 *   node dist/render.cjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderLot, type LotSpec } from '../src/compositor.js';
import { CANVAS_H, CANVAS_W } from '../src/core/projection.js';

import lot04 from '../src/data/lots/bonerville_04.json';
import lot07 from '../src/data/lots/bonerville_07.json';

// --- Minimal PNG encoder (truecolor + alpha, no interlace) ---------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor + alpha
  // 10,11,12 = deflate / adaptive filter / no interlace, all zero

  // One filter byte (0 = None) per scanline. Pixel art compresses fine flat.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Nearest-neighbour integer upscale, for reviewing at 2x/3x without blur. */
function upscale(rgba: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < w * k; x++) {
      const sx = (x / k) | 0;
      const s = (sy * w + sx) * 4;
      const d = (y * w * k + x) * 4;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = rgba[s + 3];
    }
  }
  return out;
}

// --- Run ------------------------------------------------------------------

const LOTS = [lot04, lot07] as unknown as LotSpec[];
mkdirSync('out', { recursive: true });

for (const spec of LOTS) {
  const t0 = Date.now();
  const { raster, objects } = renderLot(spec);
  const ms = Date.now() - t0;

  writeFileSync(`out/${spec.lot_id}.png`, encodePng(raster.color, CANVAS_W, CANVAS_H));
  writeFileSync(
    `out/${spec.lot_id}@2x.png`,
    encodePng(upscale(raster.color, CANVAS_W, CANVAS_H, 2), CANVAS_W * 2, CANVAS_H * 2),
  );

  // Report the id-buffer coverage per flaggable object. A violation whose
  // clickable area is tiny is a pixel hunt by accident — this is the number
  // that catches that before a playtester does.
  const counts = new Map<number, number>();
  for (let i = 0; i < raster.id.length; i++) {
    const k = raster.id[i];
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  console.log(`\n${spec.lot_id}  ${spec.address}  (${ms}ms)`);
  for (const o of objects) {
    const px = counts.get(o.key) ?? 0;
    const flag = px === 0 ? '  <-- INVISIBLE, cannot be clicked' : px < 120 ? '  <-- small target' : '';
    console.log(`  ${String(px).padStart(6)} px  ${o.id.padEnd(14)} ${o.label}${flag}`);
  }
  console.log(`  expected verdict: ${spec.expected_verdict}`);
}
console.log('\nwrote out/*.png');
