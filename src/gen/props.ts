/**
 * TIER 6 — PROPS & VIOLATION OVERLAYS
 *
 * Ordered by which rules the MVP needs. Day 1 is R-101 only, but 6.1 is here
 * because reference image 2 shows bins stored at the garage — which is LEGAL
 * storage, and is the same sprite that becomes an R-104 violation at the curb
 * on a Friday. One sprite, two rule states. That is the design pillar working.
 */

import { iso } from '../core/projection.js';
import { PALETTE, ramps } from '../core/palette.js';
import { mulberry32, type Raster } from '../core/raster.js';
import { box, groundShadow } from '../core/solid.js';

export type BinType = 'trash' | 'recycle' | 'yard';

/** 6.1 waste_bin — 96 gal roll-out. Silhouette must read at 100% zoom. */
export function waste_bin(
  r: Raster,
  u: number,
  v: number,
  type: BinType,
  lidOpen = false,
): void {
  const key = type === 'recycle' ? 'bin_green' : type === 'yard' ? 'bin_green' : 'bin_brown';
  const c = ramps(key);
  const W = 0.68;
  const D = 0.78;
  const H = 1.55;

  groundShadow(r, u, v, u + W, v + D, H * 0.55, 0.74);
  // Body tapers slightly; approximated with a straight box plus a lip.
  box(r, u, v, u + W, v + D, 0, H, key, { top: c[2], front: c[1], right: c[0] });
  // Lid overhangs the body — this is the silhouette tell that says "bin".
  box(r, u - 0.06, v - 0.06, u + W + 0.06, v + D + 0.06, H, H + (lidOpen ? 0.06 : 0.13), key, {
    top: lidOpen ? c[0] : c[2],
    front: c[1],
    right: c[0],
  });
  // Wheels, just visible at the base.
  const w0 = iso(u + W, v + D * 0.2, 0.12);
  const w1 = iso(u + W, v + D * 0.8, 0.12);
  r.px(w0.x, w0.y, PALETTE.bronze_dark[0]);
  r.px(w1.x, w1.y, PALETTE.bronze_dark[0]);
}

/** 6.2 junk_pile — R-107. Volume and mix drive the "junk or project" read. */
export function junk_pile(
  r: Raster,
  u: number,
  v: number,
  volume: 1 | 2 | 3,
  seed: number,
): void {
  const rnd = mulberry32(seed);
  const n = [4, 7, 11][volume - 1];
  const spread = [0.7, 1.1, 1.6][volume - 1];
  groundShadow(r, u - spread * 0.5, v - spread * 0.5, u + spread * 0.5, v + spread * 0.5, 0.8, 0.76);
  const items = [PALETTE.rust, PALETTE.steel, PALETTE.cedar_weathered, PALETTE.bin_brown, PALETTE.taupe];
  const boxes: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const bu = u + (rnd() - 0.5) * spread;
    const bv = v + (rnd() - 0.5) * spread;
    const s = 0.25 + rnd() * 0.35;
    boxes.push([bu, bv, s, 0.2 + rnd() * 0.5, Math.floor(rnd() * items.length)]);
  }
  // Painter's order — nearer items last, or the pile looks inside-out.
  boxes.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [bu, bv, s, h, k] of boxes) {
    const c = items[k];
    r.fillPoly(
      [iso(bu + s, bv, h), iso(bu + s, bv + s, h), iso(bu + s, bv + s, 0), iso(bu + s, bv, 0)],
      c[0],
    );
    r.fillPoly(
      [iso(bu, bv + s, h), iso(bu + s, bv + s, h), iso(bu + s, bv + s, 0), iso(bu, bv + s, 0)],
      c[1],
    );
    r.fillPoly([iso(bu, bv, h), iso(bu + s, bv, h), iso(bu + s, bv + s, h), iso(bu, bv + s, h)], c[2]);
  }
}

/**
 * 6.3 kids_clutter — the R-107 decoy. Legal in daylight, cited after dark.
 * Deliberately brighter and more scattered than junk: it reads as "in use".
 */
export function kids_clutter(r: Raster, u: number, v: number, seed: number): void {
  const rnd = mulberry32(seed);
  groundShadow(r, u - 0.5, v - 0.5, u + 0.5, v + 0.5, 0.5, 0.8);
  // A bike on its side.
  const b = iso(u, v, 0.1);
  for (const dx of [-4, 4]) {
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      r.px(b.x + dx + Math.cos(a) * 3, b.y + Math.sin(a) * 1.6, PALETTE.bronze_dark[1]);
    }
  }
  r.line(b.x - 4, b.y, b.x + 4, b.y - 1, PALETTE.rust[2]);
  // A ball and a couple of toys.
  for (let i = 0; i < 3; i++) {
    const p = iso(u + (rnd() - 0.5) * 1.6, v + (rnd() - 0.5) * 1.2, 0.12);
    const c = [PALETTE.rust, PALETTE.agave_blue, PALETTE.ornamental_tan][i % 3];
    r.px(p.x, p.y, c[1]);
    r.px(p.x + 1, p.y, c[2]);
    r.px(p.x, p.y - 1, c[2]);
    r.px(p.x + 1, p.y - 1, c[1]);
  }
}
