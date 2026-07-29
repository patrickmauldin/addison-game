/**
 * Bringing outside art onto the locked palette, and recolouring it once there.
 *
 * The manifest's warning about generative art is really a warning about
 * consistency drift: iso angle, light direction, grid alignment, palette. Three
 * of those a human has to get right at authoring time. The fourth — palette —
 * is the one a machine can simply enforce, so it should be, on ingest, once,
 * rather than trusted per-asset forever.
 *
 * The payoff is bigger than tidiness. Once a sprite is exactly on-palette,
 * every pixel belongs to a known ramp, which makes recolouring a lookup:
 * swap the siding ramp and the house changes colour with no re-authoring.
 * That is what keeps R-308 (exterior paint vs the approved swatch card) working
 * with ONE image per shell instead of one per shell per colour.
 */

import { PALETTE, type PaletteKey, type Ramp, type Rgb } from './palette.js';

export type RampHit = { key: PaletteKey; tone: 0 | 1 | 2 };

const FLAT: Array<{ key: PaletteKey; tone: 0 | 1 | 2; c: Rgb }> = [];
for (const [key, ramp] of Object.entries(PALETTE) as Array<[PaletteKey, Ramp]>)
  ramp.forEach((c, i) => FLAT.push({ key, tone: i as 0 | 1 | 2, c }));

const EXACT = new Map<number, RampHit>();
for (const f of FLAT) {
  const k = (f.c[0] << 16) | (f.c[1] << 8) | f.c[2];
  if (!EXACT.has(k)) EXACT.set(k, { key: f.key, tone: f.tone });
}

/** Exact match only. Null when the colour is not in the palette. */
export function classify(r: number, g: number, b: number): RampHit | null {
  return EXACT.get((r << 16) | (g << 8) | b) ?? null;
}

/**
 * Nearest palette entry, weighted toward green the way human luminance
 * perception is. Plain RGB distance picks visibly wrong ramps on foliage,
 * which is most of what is on screen here.
 */
const nearestCache = new Map<number, RampHit & { c: Rgb }>();
export function nearest(r: number, g: number, b: number): RampHit & { c: Rgb } {
  const k = (r << 16) | (g << 8) | b;
  const hit = nearestCache.get(k);
  if (hit) return hit;
  let best = FLAT[0];
  let bestD = Infinity;
  for (const f of FLAT) {
    const dr = r - f.c[0];
    const dg = g - f.c[1];
    const db = b - f.c[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  const res = { key: best.key, tone: best.tone, c: best.c };
  nearestCache.set(k, res);
  return res;
}

export type QuantizeReport = {
  pixels: number;
  opaque: number;
  /** Pixels that were already exactly on-palette before quantising. */
  alreadyExact: number;
  /** Mean per-channel shift applied to opaque pixels. High means the source
   *  art is far from the palette and probably needs re-authoring, not snapping. */
  meanShift: number;
  maxShift: number;
  /** Ramp usage, most-used first. This is the table you read to decide which
   *  ramp is "the siding" when writing a house sidecar. */
  ramps: Array<{ key: PaletteKey; count: number; share: number }>;
};

/**
 * Snap every opaque pixel to the palette, in place.
 *
 * Alpha is hard-thresholded: pixel art has no partial coverage, and leaving
 * feathered edges in is how a sprite ends up with a halo against turf.
 */
export function quantize(rgba: Uint8ClampedArray, alphaCut = 128): QuantizeReport {
  const counts = new Map<PaletteKey, number>();
  let opaque = 0;
  let alreadyExact = 0;
  let shiftSum = 0;
  let maxShift = 0;

  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaCut) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
      continue;
    }
    rgba[i + 3] = 255;
    opaque++;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    if (classify(r, g, b)) alreadyExact++;
    const n = nearest(r, g, b);
    const shift = (Math.abs(r - n.c[0]) + Math.abs(g - n.c[1]) + Math.abs(b - n.c[2])) / 3;
    shiftSum += shift;
    if (shift > maxShift) maxShift = shift;
    rgba[i] = n.c[0];
    rgba[i + 1] = n.c[1];
    rgba[i + 2] = n.c[2];
    counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
  }

  const ramps = [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: count / Math.max(1, opaque) }))
    .sort((a, b) => b.count - a.count);

  return {
    pixels: rgba.length / 4,
    opaque,
    alreadyExact,
    meanShift: opaque ? shiftSum / opaque : 0,
    maxShift,
    ramps,
  };
}

/**
 * Swap whole ramps, tone for tone. This is the R-308 mechanic: a house sprite
 * declares which ramp is its siding, and the lot data says what colour that
 * house is painted this campaign.
 *
 * Tone-for-tone is what makes it safe — shading, light direction and contrast
 * all survive, because only the hue family moves.
 */
export function swapRamps(
  rgba: Uint8ClampedArray,
  swaps: Partial<Record<PaletteKey, PaletteKey>>,
): number {
  const map = new Map<number, Rgb>();
  for (const [from, to] of Object.entries(swaps) as Array<[PaletteKey, PaletteKey]>) {
    if (!to || from === to) continue;
    PALETTE[from].forEach((c, i) => {
      map.set((c[0] << 16) | (c[1] << 8) | c[2], PALETTE[to][i]);
    });
  }
  if (!map.size) return 0;
  let changed = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const to = map.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    if (!to) continue;
    rgba[i] = to[0];
    rgba[i + 1] = to[1];
    rgba[i + 2] = to[2];
    changed++;
  }
  return changed;
}
