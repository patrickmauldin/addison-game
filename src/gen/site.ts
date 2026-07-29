/**
 * TIER 3 — SITE FEATURES (3.1 - 3.5)
 *
 * Fence condition is a rule (R-305), so those are gameplay states, not
 * decoration. They are built now even though Day 1 does not cite them, because
 * the states have to exist before the rule that reads them.
 */

import { BAND, iso } from '../core/projection.js';
import { PALETTE, type PaletteKey, ramps } from '../core/palette.js';
import { mulberry32, type Raster } from '../core/raster.js';
import { box, groundShadow } from '../core/solid.js';

export type FenceCondition = 'new' | 'weathered' | 'leaning' | 'missing_pickets' | 'collapsed';

/** 3.1 privacy_fence — 6 ft cedar, the Austin side-yard default. */
export function privacy_fence(
  r: Raster,
  u: number,
  v0: number,
  v1: number,
  stain: PaletteKey,
  condition: FenceCondition,
  seed: number,
): void {
  if (condition === 'collapsed') {
    // Flat on the ground, still recognisably a fence. Reads at silhouette.
    const c = ramps(stain);
    for (let v = v0; v < v1; v += 0.22) {
      const a = iso(u - 0.9, v, 0.04);
      const b = iso(u + 0.3, v, 0.04);
      r.line(a.x, a.y, b.x, b.y, c[Math.random() > 0.5 ? 0 : 1]);
    }
    return;
  }

  const c = ramps(stain);
  const H = 2.4; // 6 ft
  const lean = condition === 'leaning' ? 0.42 : 0; // >15 degrees, the R-305 threshold
  const rnd = mulberry32(seed);

  groundShadow(r, u - 0.1, v0, u + 0.1, v1, H * 0.5, 0.74);

  // Rails behind the pickets.
  for (const rz of [0.6, 1.9]) {
    const a = iso(u + lean * (rz / H), v0, rz);
    const b = iso(u + lean * (rz / H), v1, rz);
    r.line(a.x, a.y, b.x, b.y, c[0]);
  }

  for (let v = v0; v < v1; v += 0.22) {
    if (condition === 'missing_pickets' && rnd() < 0.16) continue;
    const jitter = condition === 'new' ? 0 : (rnd() - 0.5) * 0.06;
    const top = H + jitter;
    const a = iso(u + lean, v, top);
    const b = iso(u, v, 0);
    // Two-pixel picket: lit edge, shaded body.
    r.line(a.x, a.y, b.x, b.y, c[2]);
    r.line(a.x + 1, a.y, b.x + 1, b.y, c[1]);
    r.line(a.x + 2, a.y, b.x + 2, b.y, c[0]);
  }
  // Cap rail.
  const ca = iso(u + lean, v0, H + 0.1);
  const cb = iso(u + lean, v1, H + 0.1);
  r.line(ca.x, ca.y, cb.x, cb.y, c[2]);
  r.line(ca.x, ca.y + 1, cb.x, cb.y + 1, c[0]);
}

/** 3.3 ac_condenser — side yard, usually half-hidden by the fence. */
export function ac_condenser(r: Raster, u: number, v: number): void {
  groundShadow(r, u, v, u + 0.9, v + 0.9, 0.9, 0.76);
  box(r, u, v, u + 0.9, v + 0.9, 0, 0.95, 'steel');
  const s = ramps('steel');
  // Fan grille on top.
  for (let i = 0; i < 4; i++) {
    const a = iso(u + 0.15 + i * 0.18, v + 0.12, 0.96);
    const b = iso(u + 0.15 + i * 0.18, v + 0.78, 0.96);
    r.line(a.x, a.y, b.x, b.y, s[0]);
  }
}

/** 3.5 mailbox — post-mount, at the parkway edge. */
export function mailbox(r: Raster, u: number): void {
  const v = BAND.parkway.from + 0.9;
  groundShadow(r, u, v, u + 0.2, v + 0.2, 1.4, 0.78);
  const a = iso(u, v, 0);
  const b = iso(u, v, 1.35);
  r.line(a.x, a.y, b.x, b.y, ramps('cedar_weathered')[1]);
  r.line(a.x + 1, a.y, b.x + 1, b.y, ramps('cedar_weathered')[0]);
  box(r, u - 0.22, v - 0.16, u + 0.34, v + 0.16, 1.35, 1.72, 'steel');
  // Flag, down.
  const f = iso(u + 0.34, v, 1.5);
  r.line(f.x, f.y, f.x + 2, f.y - 3, PALETTE.rust[1]);
}

/** 3.4 retaining_edge — stone edging, visible in reference image 2. */
export function retaining_edge(r: Raster, pts: Array<[number, number]>, material: PaletteKey): void {
  const c = ramps(material);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = iso(pts[i][0], pts[i][1], 0.14);
    const b = iso(pts[i + 1][0], pts[i + 1][1], 0.14);
    r.line(a.x, a.y, b.x, b.y, c[2]);
    r.line(a.x, a.y + 1, b.x, b.y + 1, c[1]);
    r.line(a.x, a.y + 2, b.x, b.y + 2, c[0]);
  }
}
