/**
 * TIER 1 — TERRAIN & LOT (generators 1.1 - 1.10)
 *
 * Everything here is a function with parameters, never a picture. A ground
 * plane does not have a color; it takes a turf state.
 */

import { BAND, LOT_D, LOT_W, iso } from '../core/projection.js';
import { PALETTE, type PaletteKey, type Rgb, ramps } from '../core/palette.js';
import { fbm, mulberry32, type Raster, type Shader } from '../core/raster.js';
import { box, boxWalls, slab, slabPoly } from '../core/solid.js';

export type TurfState =
  | 'dormant_tan'
  | 'dormant_patchy'
  | 'transitional'
  | 'healthy_green'
  | 'dead_brown'
  | 'overgrown';

/**
 * The dormant/dead decoy pair lives here, and it is a two-parameter difference:
 *
 *   dormant — EVEN. Low patchiness, no bare soil. Tan because it is March in
 *             Austin, not because anyone neglected it. NOT a violation.
 *   dead    — PATCHY. High patchiness, bare soil punches through. IS a violation.
 *
 * Same base hue family, opposite uniformity. That is the whole tell, and it is
 * deliberately readable as a texture-level judgment rather than a color one.
 */
const TURF_PATCHINESS: Record<TurfState, number> = {
  dormant_tan: 0.12,
  dormant_patchy: 0.34,
  transitional: 0.28,
  healthy_green: 0.14,
  dead_brown: 0.78,
  overgrown: 0.3,
};

export function turfShader(state: TurfState, seed: number): Shader {
  const ramp = ramps(state as PaletteKey);
  const soil = PALETTE.mulch;
  const patch = TURF_PATCHINESS[state];
  return (x, y) => {
    // Two scales, and the split between them IS the dormant/dead distinction.
    // Fine grain at ~2px keeps a flat fill from reading as vector art. Broad
    // variation is what makes turf look blotchy — so its AMPLITUDE is scaled by
    // patchiness rather than being constant. Even turf gets grain and almost no
    // blotch; dead turf gets heavy blotch plus bare soil punching through.
    const grain = fbm(x, y, 3.2, seed + 7);
    const broad = fbm(x, y, 16, seed);
    if (patch > 0.5 && broad < 0.5 - (patch - 0.5)) {
      return soil[grain > 0.55 ? 1 : 0];
    }
    // Thresholds are wide on purpose. Measured over the actual noise field
    // these give roughly 6% shade / 92% base / 2% light for dormant turf. The
    // palette's ramps span ~20% luminance, so anything approaching an even
    // three-way split reads as camouflage rather than grass. Sparse speckle on
    // a dominant base is what a lawn looks like at 20px per 2.5ft.
    const n = 0.5 + (grain - 0.5) * 0.5 + (broad - 0.5) * (patch * 2.4);
    return ramp[n < 0.36 ? 0 : n > 0.68 ? 2 : 1];
  };
}

/**
 * 1.1 ground_plane — turf, extended well past the lot in every direction.
 *
 * The extents are not decorative. The canvas diamond only covers part of the
 * frame; anything the ground does not reach renders as void, and an object
 * standing over void reads as floating. Solving for full coverage:
 * u+v must span [-40, 48] and u-v must span [-28, 20], which a rect of
 * u in [-36, 36] by v in [-32, 22] contains with margin.
 */
export function ground_plane(r: Raster, state: TurfState, seed: number): void {
  slab(r, -36, -32, 36, BAND.sidewalk.from, 0, turfShader(state, seed));
}

/** 1.2 street */
export function street(r: Raster, hasCenterLine: boolean): void {
  const a = ramps('asphalt');
  slab(r, -36, BAND.street.from, 40, LOT_D + 14, -0.2, (x, y) => {
    const n = fbm(x, y, 5, 991);
    return n > 0.58 ? a[1] : a[0];
  });
  if (hasCenterLine) {
    // Dashed. Only a sliver is in frame at the very bottom edge.
    for (let u = -34; u < 38; u += 3) {
      slab(r, u, LOT_D + 2.2, u + 1.6, LOT_D + 2.5, -0.2, PALETTE.ornamental_tan[1]);
    }
  }
}

/** 1.3 curb — with an apron dip where the driveway crosses. */
export function curb(r: Raster, apronFrom: number, apronTo: number): void {
  const c = ramps('concrete_weathered');
  const { from, to } = BAND.curb;
  const seg = (u0: number, u1: number, h: number) => {
    box(r, u0, from, u1, to, -0.2, h, 'concrete_weathered', {
      top: c[2],
      front: c[1],
      right: c[0],
    });
  };
  seg(-36, apronFrom, 0);
  seg(apronFrom, apronTo, -0.14); // dipped apron
  seg(apronTo, 40, 0);
}

/** 1.4 parkway_strip — turf state is INDEPENDENT of the yard. Usually worse. */
export function parkway_strip(r: Raster, state: TurfState, seed: number): void {
  slab(r, -36, BAND.parkway.from, 40, BAND.parkway.to, 0, turfShader(state, seed + 313));
}

/** 1.5 sidewalk — scored into panels, with optional cracking and heave. */
export function sidewalk(
  r: Raster,
  condition: 'clean' | 'cracked' | 'heaved',
  seed: number,
): void {
  const c = ramps('concrete_weathered');
  const { from, to } = BAND.sidewalk;
  const rnd = mulberry32(seed);
  slab(r, -36, from, 40, to, 0.02, (x, y) => {
    const n = fbm(x, y, 6, seed + 44);
    return n > 0.55 ? c[2] : c[1];
  });
  // Control joints every 2 units (5 ft), which is how they are actually poured.
  for (let u = -36; u < 40; u += 2) {
    const a = iso(u, from, 0.02);
    const b = iso(u, to, 0.02);
    r.line(a.x, a.y, b.x, b.y, c[0]);
    if (condition !== 'clean' && rnd() < 0.35) {
      const jag = (rnd() - 0.5) * 1.2;
      const m = iso(u + jag, (from + to) / 2, 0.02);
      r.line(a.x, a.y, m.x, m.y, PALETTE.concrete_oil_stained[0]);
      r.line(m.x, m.y, b.x, b.y, PALETTE.concrete_oil_stained[0]);
    }
  }
  if (condition === 'heaved') {
    // A single lifted panel. Reads as a 2px step, which is all it needs to be.
    const u0 = 6 + Math.floor(rnd() * 6);
    box(r, u0, from, u0 + 2, to, 0.02, 0.12, 'concrete_weathered');
  }
}

/** 1.6 driveway — from the garage face to the curb, with an apron flare. */
export function driveway(
  r: Raster,
  u0: number,
  u1: number,
  stain: 'clean' | 'weathered' | 'oil_stained',
  seed: number,
): void {
  const key: PaletteKey =
    stain === 'clean' ? 'concrete_fresh' : stain === 'weathered' ? 'concrete_weathered' : 'concrete_oil_stained';
  const c = ramps(key);
  const flare = 1.3;
  slabPoly(
    r,
    [
      [u0, BAND.house.to],
      [u1, BAND.house.to],
      [u1, BAND.parkway.from],
      [u1 + flare, BAND.curb.to],
      [u0 - flare, BAND.curb.to],
      [u0, BAND.parkway.from],
    ],
    0.02,
    (x, y) => {
      const n = fbm(x, y, 7, seed);
      if (stain === 'oil_stained') {
        const blob = fbm(x, y, 11, seed + 5);
        if (blob > 0.66) return PALETTE.concrete_oil_stained[0];
      }
      return n > 0.56 ? c[2] : c[1];
    },
  );
  // Expansion joints across the run.
  for (let v = BAND.house.to + 2; v < BAND.parkway.from; v += 2.4) {
    const a = iso(u0, v, 0.02);
    const b = iso(u1, v, 0.02);
    r.line(a.x, a.y, b.x, b.y, c[0]);
  }
}

/** 1.7 front_walk — porch to sidewalk. */
export function front_walk(
  r: Raster,
  fromU: number,
  toU: number,
  type: 'straight' | 'curved' | 'dogleg',
): void {
  const c = ramps('concrete_weathered');
  const w = 0.7;
  const vHouse = BAND.house.to;
  const vWalk = BAND.sidewalk.to;
  const paint: Shader = (x, y) => (fbm(x, y, 6, 77) > 0.55 ? c[2] : c[1]);

  if (type === 'straight') {
    slabPoly(
      r,
      [
        [fromU - w, vHouse],
        [fromU + w, vHouse],
        [toU + w, vWalk],
        [toU - w, vWalk],
      ],
      0.02,
      paint,
    );
    return;
  }
  // Curved / dogleg: two segments with a bend at the setback midpoint.
  const vMid = (vHouse + vWalk) / 2;
  const bend = type === 'dogleg' ? toU : (fromU + toU) / 2 + 1.2;
  slabPoly(
    r,
    [
      [fromU - w, vHouse],
      [fromU + w, vHouse],
      [bend + w, vMid],
      [bend - w, vMid],
    ],
    0.02,
    paint,
  );
  slabPoly(
    r,
    [
      [bend - w, vMid],
      [bend + w, vMid],
      [toU + w, vWalk],
      [toU - w, vWalk],
    ],
    0.02,
    paint,
  );
}

/** 1.8 landscape_bed — the container that 4.8/4.9 plant into. */
export function landscape_bed(
  r: Raster,
  poly: Array<[number, number]>,
  edging: 'stone' | 'steel' | 'none',
  fill: 'mulch' | 'river_rock' | 'dg',
  seed: number,
): void {
  const fillRamp =
    fill === 'mulch' ? PALETTE.mulch : fill === 'river_rock' ? PALETTE.concrete_weathered : PALETTE.decomposed_granite;
  slabPoly(r, poly, 0.03, (x, y) => {
    const n = fbm(x, y, fill === 'river_rock' ? 2.4 : 3.6, seed);
    return n > 0.62 ? fillRamp[2] : n > 0.4 ? fillRamp[1] : fillRamp[0];
  });
  if (edging === 'none') return;
  const edgeRamp = edging === 'stone' ? PALETTE.limestone_tan : PALETTE.bronze_dark;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i];
    const [u1, v1] = poly[(i + 1) % poly.length];
    const a = iso(u0, v0, 0.06);
    const b = iso(u1, v1, 0.06);
    r.line(a.x, a.y, b.x, b.y, edgeRamp[1]);
    r.line(a.x, a.y + 1, b.x, b.y + 1, edgeRamp[0]);
  }
}

/**
 * 1.9 neighbor_slab — partial houses at the frame edges.
 * NOT decoration. A lot rendered alone on a green field reads as a diorama;
 * these are what make it read as a subdivision. Manifest is explicit on this.
 */
export function neighbor_slab(r: Raster, side: 'L' | 'R', siding: PaletteKey, roof: PaletteKey): void {
  const seed = side === 'L' ? 12 : 34;
  const u0 = side === 'L' ? -16.5 : LOT_W + 7.0;
  const u1 = side === 'L' ? -8.5 : LOT_W + 15.0;
  const v0 = 1.5;
  const v1 = 10.5;
  // Walls, deliberately plainer than the hero house so they recede.
  box(r, u0, v0, u1, v1, 0, 4.3, siding);
  // A stone base course. Without it these read as untextured cardboard boxes
  // next to a house that has material — which draws the eye exactly wrong.
  boxWalls(r, u0, v0, u1, v1, 0, 1.9, 'limestone_tan');
  // Simple gable, no dormers, no detail.
  const rr = ramps(roof);
  const midU = (u0 + u1) / 2;
  r.fillPoly(
    [iso(u0 - 0.4, v1 + 0.4, 4.3), iso(midU, v1 + 0.4, 6.4), iso(midU, v0 - 0.4, 6.4), iso(u0 - 0.4, v0 - 0.4, 4.3)],
    rr[1],
  );
  r.fillPoly(
    [iso(midU, v1 + 0.4, 6.4), iso(u1 + 0.4, v1 + 0.4, 4.3), iso(u1 + 0.4, v0 - 0.4, 4.3), iso(midU, v0 - 0.4, 6.4)],
    rr[0],
  );
  // Their driveway, cut off by the frame.
  const du = side === 'L' ? [-13.5, -10.0] : [LOT_W + 9.5, LOT_W + 13.0];
  slabPoly(
    r,
    [
      [du[0], v1],
      [du[1], v1],
      [du[1], BAND.curb.to],
      [du[0], BAND.curb.to],
    ],
    0.02,
    (x, y) => (fbm(x, y, 7, seed) > 0.55 ? PALETTE.concrete_weathered[2] : PALETTE.concrete_weathered[1]),
  );
}

/**
 * Rear context — the tree line over the back fences of the houses behind.
 * Not in the manifest's Tier 1 table, but the same argument as 1.9: an
 * unbroken lawn running to the top of the frame reads as a golf course, not a
 * subdivision. Two rows of canopy, no trunks, deliberately low contrast so it
 * sits back.
 */
export function rear_treeline(r: Raster, seed: number): void {
  const rnd = mulberry32(seed);
  const oak = ramps('live_oak');
  for (let row = 0; row < 2; row++) {
    const v = -7 - row * 4;
    // Step along u at constant v traces a DIAGONAL on screen, so an evenly
    // spaced loop reads as a hedge row rather than a tree mass. Heavy jitter
    // in v (which moves a canopy perpendicular to that diagonal) plus tight
    // spacing in u is what breaks up the line.
    for (let u = -34; u < 36; u += 0.8) {
      const c = iso(u + (rnd() - 0.5) * 1.6, v + (rnd() - 0.5) * 6.5, 2.6 + rnd() * 1.4);
      const rx = 15 + rnd() * 8;
      const ry = 9 + rnd() * 4;
      for (let y = Math.floor(c.y - ry); y <= c.y + ry; y++) {
        for (let x = Math.floor(c.x - rx); x <= c.x + rx; x++) {
          const dx = (x - c.x) / rx;
          const dy = (y - c.y) / ry;
          if (dx * dx + dy * dy > 1 + (fbm(x, y, 5, seed + row) - 0.5) * 0.5) continue;
          // Row 1 is further away: flatten it toward the shade tone so the
          // depth ordering reads without any explicit fog pass.
          const lit = -dx - dy;
          const t = row === 1 ? (lit > 0.7 ? 1 : 0) : lit > 0.5 ? 2 : lit < -0.4 ? 0 : 1;
          r.px(x, y, oak[t]);
        }
      }
    }
  }
}

/** 1.10 site_utilities — meter lid, sprinkler heads, marker flag, cleanout. */
export function site_utilities(r: Raster, seed: number): void {
  const rnd = mulberry32(seed);
  // Water meter lid in the parkway. Every Austin lot has one.
  const mu = 3 + rnd() * 2;
  slab(r, mu, BAND.parkway.from + 0.6, mu + 0.7, BAND.parkway.from + 1.2, 0.04, PALETTE.steel[1]);
  slab(r, mu + 0.08, BAND.parkway.from + 0.68, mu + 0.62, BAND.parkway.from + 1.12, 0.05, PALETTE.steel[0]);
  // Sprinkler heads in the yard.
  for (let i = 0; i < 3; i++) {
    const u = 2 + rnd() * (LOT_W - 4);
    const v = BAND.frontYard.from + rnd() * 6;
    slab(r, u, v, u + 0.28, v + 0.28, 0.04, PALETTE.bronze_dark[1]);
  }
  // Cleanout near the front walk.
  const cu = LOT_W - 5 + rnd() * 2;
  slab(r, cu, BAND.frontYard.from + 1, cu + 0.35, BAND.frontYard.from + 1.35, 0.04, PALETTE.trim_white[0]);
}
