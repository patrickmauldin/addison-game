/**
 * Isometric solid primitives. Every generator builds from these, which is what
 * keeps light direction and grid alignment consistent across the whole kit.
 *
 * Visible faces of an axis-aligned grid box, given the fixed camera:
 *   top     (z = zTop)  -> LIGHT
 *   front   (v = v1)    -> BASE   (normal points screen left-down, toward sun)
 *   right   (u = u1)    -> SHADE  (normal points screen right-down, away)
 */

import { iso, type Pt } from './projection.js';
import type { PaletteKey, Rgb } from './palette.js';
import { darken, ramps } from './palette.js';
import type { Raster, Shader } from './raster.js';

export type Paint = Rgb | Shader;

/** Flat horizontal quad at height z. Used for ground, slabs, tops. */
export function slab(
  r: Raster,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  z: number,
  paint: Paint,
): void {
  r.fillPoly([iso(u0, v0, z), iso(u1, v0, z), iso(u1, v1, z), iso(u0, v1, z)], paint);
}

/** Arbitrary flat polygon on the ground plane, given grid-space points. */
export function slabPoly(r: Raster, pts: Array<[number, number]>, z: number, paint: Paint): void {
  r.fillPoly(
    pts.map(([u, v]) => iso(u, v, z)),
    paint,
  );
}

export function frontFace(
  u0: number,
  u1: number,
  v: number,
  zBase: number,
  zTop: number,
): Pt[] {
  return [iso(u0, v, zTop), iso(u1, v, zTop), iso(u1, v, zBase), iso(u0, v, zBase)];
}

export function rightFace(
  u: number,
  v0: number,
  v1: number,
  zBase: number,
  zTop: number,
): Pt[] {
  return [iso(u, v0, zTop), iso(u, v1, zTop), iso(u, v1, zBase), iso(u, v0, zBase)];
}

/**
 * Full box. `paints` lets a caller override any face with a shader — used for
 * brick coursing, lap siding, and shingle rows.
 */
export function box(
  r: Raster,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  zBase: number,
  zTop: number,
  key: PaletteKey,
  paints?: { top?: Paint; front?: Paint; right?: Paint },
): void {
  const ramp = ramps(key);
  r.fillPoly(rightFace(u1, v0, v1, zBase, zTop), paints?.right ?? ramp[0]);
  r.fillPoly(frontFace(u0, u1, v1, zBase, zTop), paints?.front ?? ramp[1]);
  slab(r, u0, v0, u1, v1, zTop, paints?.top ?? ramp[2]);
}

/** Box with no top face drawn — for walls that a roof will cap. */
export function boxWalls(
  r: Raster,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  zBase: number,
  zTop: number,
  key: PaletteKey,
  paints?: { front?: Paint; right?: Paint },
): void {
  const ramp = ramps(key);
  r.fillPoly(rightFace(u1, v0, v1, zBase, zTop), paints?.right ?? ramp[0]);
  r.fillPoly(frontFace(u0, u1, v1, zBase, zTop), paints?.front ?? ramp[1]);
}

/**
 * Contact shadow. A soft-ish dark quad on the ground offset toward screen
 * lower-right (away from the upper-left sun). Objects without one float.
 * Multiplicative so it reads over any turf state.
 */
export function groundShadow(
  r: Raster,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  height: number,
  strength = 1,
): void {
  // Sun at 45deg upper-left: shadow runs toward +u and -v in grid space.
  const off = height * 0.55;
  const steps = strength <= 0.75 ? 2 : 1;
  const pts: Pt[] = [
    iso(u0 + off * 0.5, v0 - off * 0.5),
    iso(u1 + off, v0 - off * 0.5),
    iso(u1 + off, v1 - off),
    iso(u0 + off * 0.5, v1 - off),
  ];
  r.fillPoly(pts, (x, y) => {
    const i = (y * r.w + x) << 2;
    return darken([r.color[i], r.color[i + 1], r.color[i + 2]], steps);
  });
}

/**
 * Darken an existing region — recesses, window reveals, gutter lines.
 * `strength` is kept as a float for call-site readability but is quantised to
 * whole ramp steps; see palette.darken for why shadows must stay in-palette.
 */
export function shade(r: Raster, pts: Pt[], strength: number): void {
  const steps = strength <= 0.7 ? 2 : 1;
  r.fillPoly(pts, (x, y) => {
    const i = (y * r.w + x) << 2;
    return darken([r.color[i], r.color[i + 1], r.color[i + 2]], steps);
  });
}
