/**
 * Minimal PNG codec.
 *
 * Decode exists because the ingest pipeline has to read whatever a generator
 * or an artist hands over — indexed, RGB, greyscale, with or without alpha —
 * and bring it onto the locked palette before it is allowed near the
 * compositor. Encode exists so tools can write renders and ingested sprites.
 *
 * Scope is deliberately narrow: 8-bit depth, no interlace. Anything outside
 * that throws loudly rather than producing subtly wrong pixels, because a
 * silently mis-decoded sprite is exactly the kind of near-miss the Tier 0
 * contract exists to prevent.
 *
 * Node-only (uses node:zlib). The browser never calls this — it loads sprites
 * through Image + canvas, which is already a decoder.
 */

import { deflateSync, inflateSync } from 'node:zlib';

export type Bitmap = { w: number; h: number; rgba: Uint8ClampedArray };

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

export function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): Bitmap {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: not a PNG');

  let w = 0;
  let h = 0;
  let depth = 0;
  let colorType = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];

  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('png: interlaced images are not supported');
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }

  const ch = CHANNELS[colorType];
  if (!ch) throw new Error(`png: unsupported colour type ${colorType}`);
  if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1)
    throw new Error(`png: unsupported bit depth ${depth}`);
  if (depth !== 8 && colorType !== 3 && colorType !== 0)
    throw new Error(`png: sub-8-bit depth is only supported for indexed and greyscale`);

  const raw = inflateSync(Buffer.concat(idat));
  // Sub-8-bit samples are packed several to a byte. Indexed PNGs from most
  // pixel-art tools come out at 4-bit when the palette is 16 colours or fewer,
  // so this is a normal case, not an exotic one.
  const stride = Math.ceil((w * ch * depth) / 8);
  const filterBpp = Math.max(1, Math.ceil((ch * depth) / 8));
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  const samples = new Uint8Array(w * ch);

  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= filterBpp ? line[i - filterBpp] : 0;
      const b = prev[i];
      const c = i >= filterBpp ? prev[i - filterBpp] : 0;
      line[i] =
        filter === 0 ? x
        : filter === 1 ? x + a
        : filter === 2 ? x + b
        : filter === 3 ? x + ((a + b) >> 1)
        : filter === 4 ? x + paeth(a, b, c)
        : (() => { throw new Error(`png: bad filter ${filter}`); })();
    }
    src += stride;

    // Expand packed samples to one byte each so the reader below is uniform.
    if (depth === 8) {
      samples.set(line.subarray(0, w * ch));
    } else {
      const per = 8 / depth;
      const mask = (1 << depth) - 1;
      for (let i = 0; i < w * ch; i++) {
        const byte = line[(i / per) | 0];
        const shift = 8 - depth * ((i % per) + 1);
        samples[i] = (byte >> shift) & mask;
      }
    }

    for (let x = 0; x < w; x++) {
      const d = (y * w + x) << 2;
      const s = x * ch;
      if (colorType === 6) {
        out[d] = samples[s]; out[d + 1] = samples[s + 1]; out[d + 2] = samples[s + 2]; out[d + 3] = samples[s + 3];
      } else if (colorType === 2) {
        out[d] = samples[s]; out[d + 1] = samples[s + 1]; out[d + 2] = samples[s + 2]; out[d + 3] = 255;
      } else if (colorType === 3) {
        const i = samples[s];
        if (!plte) throw new Error('png: indexed image with no PLTE');
        out[d] = plte[i * 3]; out[d + 1] = plte[i * 3 + 1]; out[d + 2] = plte[i * 3 + 2];
        out[d + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (colorType === 0) {
        const v = depth === 8 ? samples[s] : Math.round((samples[s] * 255) / ((1 << depth) - 1));
        out[d] = out[d + 1] = out[d + 2] = v; out[d + 3] = 255;
      } else {
        out[d] = out[d + 1] = out[d + 2] = samples[s]; out[d + 3] = samples[s + 1];
      }
    }
    prev.set(line);
  }
  return { w, h, rgba: out };
}

/** Box-filter downscale. Only used on ingest, never at runtime. */
export function downscale(src: Bitmap, tw: number, th: number): Bitmap {
  const out = new Uint8ClampedArray(new ArrayBuffer(tw * th * 4));
  const sx = src.w / tw;
  const sy = src.h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = y0; j < y1 && j < src.h; j++) {
        for (let i = x0; i < x1 && i < src.w; i++) {
          const s = (j * src.w + i) << 2;
          const av = src.rgba[s + 3] / 255;
          // Premultiply so transparent pixels do not bleed their colour in.
          r += src.rgba[s] * av; g += src.rgba[s + 1] * av; b += src.rgba[s + 2] * av;
          a += src.rgba[s + 3]; n++;
        }
      }
      const d = (y * tw + x) << 2;
      const aa = a / n;
      const w8 = aa / 255;
      out[d] = w8 > 0 ? r / n / w8 : 0;
      out[d + 1] = w8 > 0 ? g / n / w8 : 0;
      out[d + 2] = w8 > 0 ? b / n / w8 : 0;
      out[d + 3] = aa;
    }
  }
  return { w: tw, h: th, rgba: out };
}

export function crop(src: Bitmap, x0: number, y0: number, w: number, h: number): Bitmap {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * src.w + (x0 + x)) << 2;
      const d = (y * w + x) << 2;
      out[d] = src.rgba[s]; out[d + 1] = src.rgba[s + 1];
      out[d + 2] = src.rgba[s + 2]; out[d + 3] = src.rgba[s + 3];
    }
  }
  return { w, h, rgba: out };
}

/**
 * Measure a decoded asset without changing it.
 *
 * This is what replaced quantise-on-ingest once art became hand-authored. The
 * useful question stopped being "how far is this from my palette" and became
 * "is this exportable": hard alpha, a sane colour count, actually opaque.
 */
export function analyse(rgba: Uint8ClampedArray): {
  pixels: number; opaque: number; softAlpha: number; colours: number;
} {
  const seen = new Set<number>();
  let opaque = 0;
  let softAlpha = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    if (a < 255) softAlpha++;
    opaque++;
    seen.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
  }
  return { pixels: rgba.length / 4, opaque, softAlpha, colours: seen.size };
}
