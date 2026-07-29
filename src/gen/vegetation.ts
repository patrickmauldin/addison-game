/**
 * TIER 4 — VEGETATION (generators 4.1 - 4.9)
 *
 * Vegetation carries all of R-101 and the xeriscape decoy, so it needs more
 * states than anything else in the kit.
 *
 * 4.8 and 4.9 are built together, always, and they are the whole reason this
 * slice exists. The manifest's warning is specific: a weed patch "must read as
 * a color blob, not scattered lines" — the earlier prototype failed exactly
 * there. So the distinction between violation and decoy is NOT plant species
 * and NOT color. Both use the same primitives. The tell is:
 *
 *   weed_patch (R-101 violation) — unbordered, irregular, bleeding into turf
 *   native_bed (legal)           — bordered, filled, deliberately spaced
 *
 * Intentionality is the read. That is a judgment a player can actually make
 * and defend, which is what separates this from a pixel hunt.
 */

import { iso } from '../core/projection.js';
import { PALETTE, type Ramp, type Rgb, ramps } from '../core/palette.js';
import { fbm, mulberry32, valueNoise, type Raster } from '../core/raster.js';
import { groundShadow, slabPoly } from '../core/solid.js';

/** Noisy filled ellipse in screen space — the canopy primitive. */
function canopy(
  r: Raster,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: Ramp,
  seed: number,
  ragged = 0.22,
): void {
  const x0 = Math.floor(cx - rx - 2);
  const x1 = Math.ceil(cx + rx + 2);
  const y0 = Math.floor(cy - ry - 2);
  const y1 = Math.ceil(cy + ry + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      const edge = 1 + (fbm(x, y, 4.5, seed) - 0.5) * ragged * 2;
      if (d > edge) continue;
      // Light from upper-left: tone by position within the mass, plus grain.
      const lit = -dx - dy;
      const g = valueNoise(x, y, 2.6, seed + 5);
      const t = lit > 0.55 && g > 0.4 ? 2 : lit < -0.3 || g < 0.25 ? 0 : 1;
      r.px(x, y, ramp[t]);
    }
  }
}

function trunk(r: Raster, u: number, v: number, h: number, w: number, ramp: Ramp): void {
  const base = iso(u, v, 0);
  const top = iso(u, v, h);
  for (let i = -Math.floor(w / 2); i <= Math.floor(w / 2); i++) {
    const t = i < 0 ? ramp[1] : i === 0 ? ramp[1] : ramp[0];
    r.line(base.x + i, base.y, top.x + i, top.y, t);
  }
}

/** 4.1 live_oak — evergreen, Austin's default, broad and low-branching. */
export function live_oak(r: Raster, u: number, v: number, size: 1 | 2 | 3, seed: number): void {
  const h = [2.6, 3.8, 5.0][size - 1];
  const rx = [17, 25, 34][size - 1];
  const ry = [11, 16, 21][size - 1];
  groundShadow(r, u - 0.9, v - 0.9, u + 0.9, v + 0.9, h * 0.5, 0.76);
  trunk(r, u, v, h, size === 1 ? 2 : 3, ramps('bare_branch'));
  const top = iso(u, v, h);
  const rnd = mulberry32(seed);
  // Three overlapping lobes read as a live oak's spreading habit.
  canopy(r, top.x, top.y, rx, ry, ramps('live_oak'), seed);
  canopy(r, top.x - rx * 0.5, top.y + ry * 0.2, rx * 0.6, ry * 0.65, ramps('live_oak'), seed + 11);
  canopy(r, top.x + rx * 0.45, top.y + ry * 0.28, rx * 0.55, ry * 0.6, ramps('live_oak'), seed + 22);
  void rnd;
}

/**
 * 4.2 deciduous_tree — BARE IS NOT DEAD. That pair is an R-110 decoy: a bare
 * deciduous tree in March is legal, a dead one is a limb hazard. Bare keeps a
 * full, even branch structure; dead loses its crown and shows broken stubs.
 */
export function deciduous_tree(
  r: Raster,
  u: number,
  v: number,
  size: 1 | 2 | 3,
  state: 'leafed' | 'turning' | 'bare' | 'dead',
  seed: number,
): void {
  const h = [2.4, 3.4, 4.4][size - 1];
  const rx = [14, 20, 27][size - 1];
  const ry = [12, 17, 22][size - 1];
  groundShadow(r, u - 0.8, v - 0.8, u + 0.8, v + 0.8, h * 0.45, 0.78);
  trunk(r, u, v, h, size === 1 ? 2 : 3, ramps('bare_branch'));
  const top = iso(u, v, h);
  const rnd = mulberry32(seed);
  const br = ramps('bare_branch');

  const branches = state === 'dead' ? 5 : 9;
  for (let i = 0; i < branches; i++) {
    const ang = (i / branches) * Math.PI * 2 + rnd() * 0.4;
    // A dead tree loses its crown: short, broken, asymmetric stubs.
    const len = (state === 'dead' ? 0.45 + rnd() * 0.3 : 0.8 + rnd() * 0.25) * rx;
    const ex = top.x + Math.cos(ang) * len;
    const ey = top.y + Math.sin(ang) * len * (ry / rx);
    r.line(top.x, top.y, ex, ey, br[state === 'dead' ? 0 : 1]);
    if (state !== 'dead' && rnd() > 0.4) {
      r.line(ex, ey, ex + Math.cos(ang + 0.5) * len * 0.4, ey + Math.sin(ang + 0.5) * len * 0.3, br[1]);
    }
  }
  if (state === 'leafed') canopy(r, top.x, top.y, rx, ry, ramps('deciduous_leaf'), seed, 0.3);
  if (state === 'turning') canopy(r, top.x, top.y, rx * 0.9, ry * 0.9, ramps('ornamental_tan'), seed, 0.4);
}

/** 4.3 crepe_myrtle — multi-trunk, extremely Austin. */
export function crepe_myrtle(r: Raster, u: number, v: number, bloom: boolean, seed: number): void {
  const rnd = mulberry32(seed);
  groundShadow(r, u - 0.6, v - 0.6, u + 0.6, v + 0.6, 1.2, 0.8);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 0.22;
    trunk(r, u + off, v, 1.9 + rnd() * 0.4, 1, ramps('ornamental_tan'));
    const top = iso(u + off, v, 1.9 + rnd() * 0.4);
    canopy(r, top.x, top.y, 9, 7, bloom ? ramps('ornamental_tan') : ramps('deciduous_leaf'), seed + i * 7, 0.35);
  }
}

/** 4.4 young_tree_staked — the new-build tell. Both reference photos have one. */
export function young_tree_staked(r: Raster, u: number, v: number, seed: number): void {
  groundShadow(r, u - 0.4, v - 0.4, u + 0.4, v + 0.4, 0.9, 0.82);
  trunk(r, u, v, 1.7, 1, ramps('bare_branch'));
  const top = iso(u, v, 1.7);
  canopy(r, top.x, top.y, 8, 6, ramps('deciduous_leaf'), seed, 0.3);
  // Two stakes and the strap — reads instantly as "recently planted".
  for (const d of [-0.42, 0.42]) {
    const a = iso(u + d, v, 0);
    const b = iso(u + d, v, 1.0);
    r.line(a.x, a.y, b.x, b.y, ramps('cedar_new')[1]);
  }
  const s0 = iso(u - 0.42, v, 0.9);
  const s1 = iso(u + 0.42, v, 0.9);
  r.line(s0.x, s0.y, s1.x, s1.y, PALETTE.bronze_dark[2]);
}

/** 4.5 shrub_row — trim_state is a rule input, not decoration. */
export function shrub_row(
  r: Raster,
  u0: number,
  u1: number,
  v: number,
  trim: 'trimmed' | 'shaggy' | 'overgrown',
  seed: number,
): void {
  const rnd = mulberry32(seed);
  const n = Math.max(2, Math.round((u1 - u0) / 0.9));
  const ragged = trim === 'trimmed' ? 0.08 : trim === 'shaggy' ? 0.3 : 0.55;
  const h = trim === 'overgrown' ? 1.5 : trim === 'shaggy' ? 1.1 : 0.85;
  groundShadow(r, u0, v - 0.4, u1, v + 0.4, h * 0.6, 0.8);
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    const jitter = trim === 'trimmed' ? 0 : (rnd() - 0.5) * 0.35;
    const c = iso(u, v, h * 0.55 + jitter);
    canopy(r, c.x, c.y, 8, 6.5, ramps('live_oak'), seed + i * 13, ragged);
  }
}

/** 4.6 ornamental_grass — the muhly/yucca clumps in both photos. */
export function ornamental_grass(r: Raster, u: number, v: number, size: 1 | 2, seed: number): void {
  const rnd = mulberry32(seed);
  const h = size === 1 ? 0.7 : 1.05;
  const base = iso(u, v, 0);
  const g = ramps('ornamental_tan');
  for (let i = 0; i < (size === 1 ? 14 : 22); i++) {
    const a = (rnd() - 0.5) * 1.6;
    const tip = iso(u + a * 0.35, v + (rnd() - 0.5) * 0.3, h * (0.6 + rnd() * 0.5));
    r.line(base.x + (rnd() - 0.5) * 3, base.y, tip.x, tip.y, g[rnd() > 0.55 ? 2 : 1]);
  }
}

/** 4.7 agave_yucca — xeriscape vocabulary, rigid radial blades. */
export function agave_yucca(r: Raster, u: number, v: number, size: 1 | 2, seed: number): void {
  const rnd = mulberry32(seed);
  const h = size === 1 ? 0.55 : 0.85;
  const base = iso(u, v, 0.05);
  const a = ramps('agave_blue');
  const n = 11;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const len = (size === 1 ? 9 : 13) * (0.75 + rnd() * 0.35);
    const ex = base.x + Math.cos(ang) * len;
    const ey = base.y + Math.sin(ang) * len * 0.5 - h * 8;
    r.line(base.x, base.y, ex, ey, a[Math.cos(ang) < -0.2 ? 2 : Math.cos(ang) > 0.4 ? 0 : 1]);
  }
}

// --------------------------------------------------------------------------
// 4.8 / 4.9 — THE R-101 PAIR. Always built and tuned together.
// --------------------------------------------------------------------------

/** Irregular radial blob in grid space. Ragged edge is the point. */
function blobPoly(u: number, v: number, rad: number, seed: number, wobble = 0.45): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const rr = rad * (1 - wobble / 2 + valueNoise(Math.cos(ang) * 3, Math.sin(ang) * 3, 1, seed) * wobble);
    pts.push([u + Math.cos(ang) * rr, v + Math.sin(ang) * rr * 0.85]);
  }
  return pts;
}

/**
 * 4.8 weed_patch — R-101 VIOLATION.
 *
 * A color mass, not a scatter of lines. The blob is filled first so it reads
 * at 100% zoom as a green stain on tan turf; the upright tufts are added only
 * at the edges, for silhouette, and are deliberately few. If you delete the
 * tufts the patch still reads. If you delete the fill it does not — which is
 * the test the earlier prototype failed.
 */
export function weed_patch(
  r: Raster,
  u: number,
  v: number,
  density: 1 | 2 | 3,
  spread: number,
  seed: number,
): void {
  const w = ramps('weed_green');
  const poly = blobPoly(u, v, spread, seed, 0.62);
  const cover = [0.5, 0.7, 0.88][density - 1];

  // Screen-space centre and extent, used to fade coverage toward the rim. A
  // hard-edged blob reads as a clipped hedge; the whole point is that nothing
  // contains this, so the boundary has to dissolve into the turf.
  const c = iso(u, v, 0);
  const rpx = spread * 10;

  slabPoly(r, poly, 0.04, (x, y) => {
    const dx = (x - c.x) / (rpx * 1.15);
    const dy = (y - c.y) / (rpx * 0.62);
    const rim = Math.sqrt(dx * dx + dy * dy); // 0 at centre, ~1 at the rim
    const n = fbm(x, y, 4.2, seed);
    // Coverage falls off with radius, so the edge dithers out over ~6px.
    if (n > cover * (1.25 - rim * 0.85)) return null;
    // Flat tone distribution — weeds are a MAT, not a mound. Light tone is
    // rationed and scattered rather than pooled toward one side, which is what
    // was making this read as a lit dome.
    const g = valueNoise(x, y, 1.8, seed + 3);
    return g > 0.78 ? w[2] : g > 0.3 ? w[1] : w[0];
  });

  // A few upright tufts, edge-weighted. Texture only — never the diagnosis.
  const rnd = mulberry32(seed + 77);
  const tufts = [3, 5, 8][density - 1];
  for (let i = 0; i < tufts; i++) {
    const ang = rnd() * Math.PI * 2;
    const rr = spread * (0.5 + rnd() * 0.5);
    const tu = u + Math.cos(ang) * rr;
    const tv = v + Math.sin(ang) * rr * 0.85;
    const b = iso(tu, tv, 0.04);
    for (let k = 0; k < 3; k++) {
      const t = iso(tu + (rnd() - 0.5) * 0.2, tv, 0.16 + rnd() * 0.14);
      r.line(b.x + (rnd() - 0.5) * 2, b.y, t.x, t.y, w[rnd() > 0.5 ? 2 : 1]);
    }
  }
}

/** Weeds in the cracks of a hard surface — same rule, different substrate. */
export function crack_weeds(
  r: Raster,
  u0: number,
  u1: number,
  v: number,
  seed: number,
  joints = 3,
): void {
  const w = ramps('weed_green');
  const rnd = mulberry32(seed);
  // Weeds colonise every joint in a run, not one. Drawing a single joint made
  // this a 53px target that the validator correctly rejected as an eye test;
  // three consecutive joints is both a fair click target and what actually
  // happens to a neglected walk.
  for (let j = 1; j < joints; j++) {
    crack_weeds(r, u0, u1, v + j * 0.95, seed + j * 31, 1);
  }
  // Runs the full joint, not a sparse dotting of it. The validator rejects a
  // violation under 60 px as a pixel hunt, and it is right to: a finding the
  // player can barely hit is not a judgment, it is an eye test. Weeds in a
  // joint really do form a continuous line, so density here is also truer.
  for (let u = u0; u < u1; u += 0.07) {
    const jv = v + (rnd() - 0.5) * 0.3;
    const b = iso(u, jv, 0.03);
    const h = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < h; k++) r.px(b.x, b.y - k, w[k === h - 1 ? 2 : 1]);
    r.px(b.x + 1, b.y, w[0]);
    if (rnd() > 0.6) {
      // Occasional tuft spilling onto the adjacent slab.
      const s = iso(u, jv + 0.22, 0.03);
      r.px(s.x, s.y, w[1]);
      r.px(s.x, s.y - 1, w[2]);
    }
  }
}

/**
 * 4.9 native_bed — LEGAL LOOK-ALIKE.
 *
 * Same plant primitives as the weed patch's neighbourhood, same green family.
 * What makes it legal is that it is CONTAINED and DELIBERATE: a hard edge, a
 * mulch or DG field, and plants on visible spacing. Texas law also limits HOA
 * authority over native/xeriscape plantings, which is what makes citing one
 * a genuine late-game trap rather than just a mistake.
 *
 * Note the bed itself is drawn by terrain.landscape_bed (1.8); this plants it.
 */
export function native_bed_planting(
  r: Raster,
  poly: Array<[number, number]>,
  seed: number,
): void {
  const rnd = mulberry32(seed);
  // Centroid + extent, so planting adapts to whatever bed shape it is given.
  let cu = 0;
  let cv = 0;
  for (const [u, v] of poly) {
    cu += u;
    cv += v;
  }
  cu /= poly.length;
  cv /= poly.length;

  // Deliberate spacing: a repeating alternation on a visible rhythm. Regularity
  // is doing the work here — an eye reads "someone planted this" from spacing
  // long before it reads the species.
  const ring: Array<[number, number, 'agave' | 'grass']> = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const [au, av] = poly[Math.floor(t * poly.length)];
    ring.push([cu + (au - cu) * 0.6, cv + (av - cv) * 0.6, i % 2 === 0 ? 'agave' : 'grass']);
  }
  // Back to front so nearer plants overlap correctly.
  ring.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [u, v, kind] of ring) {
    if (kind === 'agave') agave_yucca(r, u, v, rnd() > 0.5 ? 2 : 1, seed + u * 31);
    else ornamental_grass(r, u, v, rnd() > 0.5 ? 2 : 1, seed + v * 17);
  }
  // One anchor specimen at the centre, larger. Reads as a design choice.
  agave_yucca(r, cu, cv, 2, seed + 909);
}
