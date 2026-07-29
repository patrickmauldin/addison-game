/**
 * THREE-QUARTER SCENE (replaces the isometric projection).
 *
 * The camera looks down at the lot from the street. There is NO horizontal
 * skew: screen x is world x, one to one. Depth runs straight up the screen and
 * is foreshortened. Vertical surfaces — the facade, the garage door — are drawn
 * face-on; horizontal ones — the roof, the driveway — are seen from above and
 * squashed.
 *
 * This is dramatically simpler than the 2:1 isometric it replaces, and it makes
 * the whole dimetric-vs-true-isometric question moot: there is no projection
 * angle left to get wrong, so an asset either matches the band layout or it
 * does not.
 *
 * The lot is not a bounded box any more. Grass is an infinite background
 * pattern, the road is a band across the bottom, and everything else sits on
 * top. Nothing is clipped to a diamond.
 *
 *   y=0    ─────────────────────────  top of frame
 *          grass (extends past frame)
 *   HOUSE  ┌───────────────────────┐  house sprite, roof seen from above
 *          └───────────────────────┘
 *          front yard  ·  driveway  ·  walk
 *   WALK   ─────────────────────────  sidewalk band
 *   CURB   ─────────────────────────
 *   ROAD   █████████████████████████  road band, bottom of frame
 */

/**
 * PROVISIONAL. Portrait, holding the reference image's 1254:1818 aspect
 * (0.690) so art authored against the reference drops in without reframing.
 * Sized to sit beside the 380px desk at 1:1 on a 1440x900 window.
 *
 * This is the one number that most wants confirming before assets are mass
 * produced — see the note in README under "Three-quarter scene".
 */
export const CANVAS_W = 440;
export const CANVAS_H = 640;

/**
 * Band boundaries as fractions of canvas height, read off the reference image.
 * Fractions rather than pixels so the canvas can be resized once without
 * re-deriving the layout by hand.
 */
export const BAND_F = {
  houseTop: 0.033,
  houseBase: 0.400, // where the facade meets the ground
  yardBase: 0.685, // front yard ends, sidewalk begins
  walkBase: 0.731, // sidewalk ends, curb
  curbBase: 0.745, // curb ends, road begins
} as const;

export const BAND = {
  houseTop: Math.round(CANVAS_H * BAND_F.houseTop),
  houseBase: Math.round(CANVAS_H * BAND_F.houseBase),
  yardBase: Math.round(CANVAS_H * BAND_F.yardBase),
  walkBase: Math.round(CANVAS_H * BAND_F.walkBase),
  curbBase: Math.round(CANVAS_H * BAND_F.curbBase),
  roadBase: CANVAS_H,
} as const;

/**
 * Anchors are plain screen points now, not grid coordinates. A prop knows how
 * to sit at CURB_1 on any lot exactly as before; the abstraction survives the
 * projection change, only its units got simpler.
 *
 * x is a fraction of canvas width so anchors stay centred if the canvas is
 * ever rebalanced; y is absolute, because the bands are what y means.
 */
export const ANCHORS: Record<string, { fx: number; y: number }> = {
  DRIVEWAY_1: { fx: 0.72, y: BAND.houseBase + 20 }, // at the garage door
  DRIVEWAY_2: { fx: 0.72, y: (BAND.houseBase + BAND.yardBase) / 2 },
  DRIVEWAY_3: { fx: 0.72, y: BAND.yardBase - 26 },
  APRON: { fx: 0.72, y: BAND.walkBase + 4 },
  WALK_1: { fx: 0.47, y: (BAND.houseBase + BAND.yardBase) / 2 },
  YARD_1: { fx: 0.14, y: BAND.houseBase + 34 },
  YARD_2: { fx: 0.30, y: BAND.houseBase + 78 },
  YARD_3: { fx: 0.16, y: BAND.yardBase - 40 },
  YARD_4: { fx: 0.34, y: BAND.yardBase - 22 },
  YARD_5: { fx: 0.88, y: BAND.houseBase + 40 },
  YARD_6: { fx: 0.90, y: BAND.yardBase - 34 },
  BED_FRONT: { fx: 0.24, y: BAND.houseBase - 6 },
  CURB_1: { fx: 0.30, y: BAND.curbBase - 6 },
  CURB_2: { fx: 0.55, y: BAND.curbBase - 6 },
  PORCH_1: { fx: 0.47, y: BAND.houseBase - 4 },
};

export function anchor(name: string): { x: number; y: number } {
  const a = ANCHORS[name];
  if (!a) throw new Error(`scene: unknown anchor "${name}"`);
  return { x: Math.round(a.fx * CANVAS_W), y: a.y };
}

/**
 * Painter's depth. Larger draws later. In three-quarter view this is simply
 * screen y — a thing lower on the screen is nearer the camera. That is the
 * entire sorting rule, replacing the isometric u+v key.
 */
export function depth(y: number): number {
  return y;
}
