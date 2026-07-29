/**
 * Software rasterizer. Deliberately NOT canvas 2D path filling.
 *
 * Canvas antialiases polygon edges and there is no way to turn that off. In
 * pixel art at a 2:1 isometric grid, a softened diagonal is the single most
 * visible tell that assets were not authored on-grid, and the manifest is
 * emphatic that near-misses are more jarring here than in any other style.
 * So: scanline fill, integer pixels, hard edges, top-left fill rule.
 *
 * The raster carries TWO buffers:
 *   color — what you see
 *   id    — a parallel object-id buffer used for click hit-testing
 *
 * The id buffer is how flagging works. Every flaggable object declares an id
 * before it draws; the compositor then resolves a click to an object in O(1)
 * with no geometry math and no per-object bounding boxes. This is also exactly
 * how it would be done in Godot, so it ports.
 */

import type { Rgb } from './palette.js';

/** A screen-space point. Owned here so the rasteriser depends on no projection. */
export type Pt = { x: number; y: number };

export type Shader = (x: number, y: number) => Rgb | null;

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly color: Uint8ClampedArray<ArrayBuffer>;
  readonly id: Int32Array;
  private current = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.color = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    this.id = new Int32Array(w * h);
  }

  /** Set the object id written by subsequent fills. 0 = unflaggable scenery. */
  setObject(id: number): void {
    this.current = id;
  }

  clear(c: Rgb): void {
    const { color } = this;
    for (let i = 0; i < color.length; i += 4) {
      color[i] = c[0];
      color[i + 1] = c[1];
      color[i + 2] = c[2];
      color[i + 3] = 255;
    }
    this.id.fill(0);
  }

  /**
   * Coordinates are floored here, not by callers. Generators work in projected
   * space and routinely hand over fractional pixels; a fractional index writes
   * colour to a bit-shifted address but is SILENTLY DROPPED by the id typed
   * array, which produces an object that is visible and unclickable.
   */
  px(x: number, y: number, c: Rgb): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const i = p << 2;
    this.color[i] = c[0];
    this.color[i + 1] = c[1];
    this.color[i + 2] = c[2];
    this.color[i + 3] = 255;
    this.id[p] = this.current;
  }

  /**
   * Alpha-blend a colour over what is already there.
   *
   * Needed because the delivered sprites carry their drop shadows as PARTIAL
   * ALPHA — every one of them has a spike around 30% — so anything that
   * hard-cuts alpha silently deletes the shadows and the props look pasted on.
   *
   * The id buffer is written only above `idCut`, so a faint shadow is drawn but
   * does not become a click target. Shading an object should not enlarge it.
   */
  blendPx(x: number, y: number, c: Rgb, alpha: number, idCut = 0.5): void {
    if (alpha <= 0) return;
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const i = p << 2;
    const a = Math.min(1, alpha);
    const inv = 1 - a;
    this.color[i] = c[0] * a + this.color[i] * inv;
    this.color[i + 1] = c[1] * a + this.color[i + 1] * inv;
    this.color[i + 2] = c[2] * a + this.color[i + 2] * inv;
    this.color[i + 3] = 255;
    if (a >= idCut) this.id[p] = this.current;
  }

  /** Read the object id under a pixel. */
  idAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.id[(y | 0) * this.w + (x | 0)];
  }

  /**
   * Even-odd scanline fill, no antialiasing. `paint` is a flat color or a
   * per-pixel shader (used for turf noise, shingle courses, brick, etc).
   * A shader returning null leaves the pixel untouched — that is how stippled
   * and sparse fills like weed patches are done without a second pass.
   */
  fillPoly(pts: Pt[], paint: Rgb | Shader): void {
    if (pts.length < 3) return;
    const shader: Shader = typeof paint === 'function' ? paint : () => paint as Rgb;

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    let y0 = Math.max(0, Math.ceil(minY - 0.5));
    let y1 = Math.min(this.h - 1, Math.ceil(maxY - 0.5) - 1);

    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (a.y === b.y) continue;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        if (yc < lo || yc >= hi) continue;
        xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      if (xs.length < 2) continue;
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(this.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        for (let x = xa; x <= xb; x++) {
          const c = shader(x, y);
          if (c) this.px(x, y, c);
        }
      }
    }
  }

  /** Bresenham. Used for fence pickets, trunk lines, sidewalk cracks. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Axis-aligned screen rect. For UI chrome and swatches only, never geometry. */
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i | 0, j | 0, c);
  }

  toImageData(): ImageData {
    return new ImageData(this.color, this.w, this.h);
  }
}

// --- Deterministic noise ------------------------------------------------
// Every generator takes a seed. Same seed + same params = same pixels, always.
// This is what makes a lot reproducible from its JSON across sessions.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0,1]. `scale` is in pixels per cell. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Two-octave fbm. Enough structure for turf patchiness without banding. */
export function fbm(x: number, y: number, scale: number, seed: number): number {
  return valueNoise(x, y, scale, seed) * 0.65 + valueNoise(x, y, scale / 2.5, seed + 101) * 0.35;
}
