/**
 * TIER 0.1 — PROJECTION CONSTANTS (LOCKED)
 *
 * Every generator obeys this contract. Fixed camera, no rotation, ever.
 *
 * Grid space is (u, v, z):
 *   u — across the lot, 0 = left property line, LOT_W = right property line
 *   v — depth, 0 = REAR of lot, LOT_D = street edge (so larger v = nearer viewer)
 *   z — height above grade, in units
 *
 * Screen space is 480x440, y-down, origin top-left.
 *
 * NOTE ON A DOC DISCREPANCY: the manifest header says "LOT = 20 wide x 26 deep"
 * but its own band table sums to 28.0 units (2.0 + 0.4 + 2.0 + 1.6 + 8.0 + 14.0).
 * The band table is the more specific spec and it is what both reference photos
 * are described against, so 28 wins. It also makes the math land exactly:
 * (LOT_W + LOT_D) * UW/2 == 480, the canvas width. The 26 appears to be stale.
 */

export const UNIT_FT = 2.5; // one grid unit, in feet

export const UW = 20; // px per unit, screen width
export const UH = 10; // px per unit, screen depth (2:1 isometric)
export const UZ = 16; // px per unit, screen height

export const LOT_W = 20; // units, 50 ft
export const LOT_D = 28; // units, 70 ft

export const CANVAS_W = 480;
export const CANVAS_H = 440;

/** Chosen so the lot diamond exactly fills the canvas width. */
export const ORIGIN_X = 280;
/** Chosen so grade at the rear property line sits at y=200, leaving 200px
 *  of headroom for a 2-story shell plus a steep roof (12.5 units). */
export const ORIGIN_Y = 200;

/** Sun: upper-left, 45 degrees. Fixed forever. Drives every face's tone index. */
export const SUN = { x: -1, y: -1, deg: 45 } as const;

/**
 * Lot depth bands, front (street) to back. Values are v-coordinates.
 * Front-to-back in the manifest reads street-first; here v is measured from
 * the rear, so these are expressed as [vNear, vFar] with vFar toward the house.
 */
export const BAND = {
  street: { from: 26.0, to: LOT_D }, // 2.0 — partial, bottom edge of frame
  curb: { from: 25.6, to: 26.0 }, // 0.4 — dips at the driveway apron
  parkway: { from: 23.6, to: 25.6 }, // 2.0 — often the worst-maintained turf
  sidewalk: { from: 22.0, to: 23.6 }, // 1.6
  frontYard: { from: 14.0, to: 22.0 }, // 8.0 — setback
  house: { from: 0.0, to: 14.0 }, // 14.0
} as const;

export type Pt = { x: number; y: number };

/** Project a grid point to screen space. Returns fractional pixels; the
 *  rasterizer applies the fill rule, so do NOT pre-round here. */
export function iso(u: number, v: number, z = 0): Pt {
  return {
    x: (u - v) * (UW / 2) + ORIGIN_X,
    y: (u + v) * (UH / 2) - z * UZ + ORIGIN_Y,
  };
}

/**
 * Painter's-algorithm depth key. Larger = nearer the viewer = drawn later.
 * Ties are broken by the caller's layer index, never by z.
 */
export function depth(u: number, v: number): number {
  return u + v;
}

/** The four corners of an axis-aligned grid rect, as a screen polygon (top face). */
export function quadTop(u0: number, v0: number, u1: number, v1: number, z = 0): Pt[] {
  return [iso(u0, v0, z), iso(u1, v0, z), iso(u1, v1, z), iso(u0, v1, z)];
}

/**
 * Which tone a vertical face should use, given its outward normal in grid space.
 * +v faces screen-left-down  -> toward the sun  -> BASE
 * +u faces screen-right-down -> away from sun   -> SHADE
 * Horizontal (top) faces always take LIGHT.
 */
export function faceTone(normal: 'u+' | 'u-' | 'v+' | 'v-' | 'top'): 0 | 1 | 2 {
  switch (normal) {
    case 'top':
      return 2;
    case 'v+':
    case 'u-':
      return 1;
    case 'u+':
    case 'v-':
      return 0;
  }
}

/**
 * INVERSE PROJECTION.
 *
 * Because the camera is fixed and the projection is affine, screen space can be
 * inverted exactly onto any planar surface. This is what lets material shaders
 * (brick courses, lap siding, shingle rows) run in wall-local coordinates
 * instead of being faked in screen space — which is the difference between
 * coursing that follows the wall and coursing that visibly slides off it.
 *
 * Each returns a function mapping a screen pixel to grid coordinates on that
 * plane. Callers only invoke them for pixels already known to be on the plane,
 * so no bounds checking is needed here.
 */

/** Vertical wall at fixed v (a front-facing wall). Returns lateral u and height z. */
export function invFrontWall(v: number): (x: number, y: number) => { u: number; z: number } {
  return (x, y) => {
    const u = (x - ORIGIN_X) / UW + v;
    const z = ((u + v) * (UH / 2) + ORIGIN_Y - y) / UZ;
    return { u, z };
  };
}

/** Vertical wall at fixed u (a right-facing wall). Returns lateral v and height z. */
export function invRightWall(u: number): (x: number, y: number) => { v: number; z: number } {
  return (x, y) => {
    const v = u - (x - ORIGIN_X) / UW;
    const z = ((u + v) * (UH / 2) + ORIGIN_Y - y) / UZ;
    return { v, z };
  };
}

/**
 * Plane sloping in v only: z = a + b*v (a roof plane whose ridge runs along u).
 * Derivation: substitute u = (x-OX)/UW + v and z = a + b*v into the projection
 * of y, then solve the resulting linear equation for v.
 */
export function invSlopedV(a: number, b: number): (x: number, y: number) => { u: number; v: number } {
  const denom = UH - UZ * b;
  return (x, y) => {
    const v = (y - ORIGIN_Y + UZ * a - (x - ORIGIN_X) / 2) / denom;
    const u = (x - ORIGIN_X) / UW + v;
    return { u, v };
  };
}

/** Plane sloping in u only: z = a + b*u (a roof plane whose ridge runs along v). */
export function invSlopedU(a: number, b: number): (x: number, y: number) => { u: number; v: number } {
  const denom = UH - UZ * b;
  return (x, y) => {
    const u = (y - ORIGIN_Y + UZ * a + (x - ORIGIN_X) / 2) / denom;
    const v = u - (x - ORIGIN_X) / UW;
    return { u, v };
  };
}

/** Screen-space bounds of the whole lot, for sanity checks in tests. */
export function lotBounds() {
  const pts = [iso(0, 0), iso(LOT_W, 0), iso(LOT_W, LOT_D), iso(0, LOT_D)];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}
