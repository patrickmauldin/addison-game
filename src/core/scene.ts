/**
 * THREE-QUARTER SCENE — full bleed.
 *
 * The camera looks down at the lot from the street. No skew: screen x is world
 * x, depth runs up the screen. The scene fills the whole stage rather than
 * sitting in a framed box, so grass runs to every edge and the lot reads as
 * part of a neighbourhood instead of a specimen on a card.
 *
 *   grass ...................... to all four edges
 *   HOUSE ...................... centred, its own lawn blending into the tile
 *   grass (front yard)
 *   SIDEWALK ................... horizontal band
 *   ROAD ....................... horizontal band, bottom of frame
 *
 * The canvas is sized to the stage at runtime, so there is no fixed CANVAS_W /
 * CANVAS_H any more. Everything downstream takes a Layout.
 */

/** Native size of the delivered house art. Everything scales against this. */
export const HOUSE_NATIVE = { w: 1254, h: 1254 };

/** Native height of the sidewalk strip. */
export const WALK_NATIVE_H = 108;

/**
 * Scale steps the house is allowed to take.
 *
 * Snapped rather than continuous because arbitrary fractional scaling of pixel
 * art destroys it differently on every window size — a lawn tuft that survives
 * at 0.62 turns to mush at 0.61, and the artist can never predict what they are
 * looking at. Fixed steps mean the art degrades the same way every time.
 */
const SCALE_STEPS = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25];

export type Layout = {
  w: number;
  h: number;
  /** Top of the road band. */
  roadTop: number;
  /** Top of the sidewalk band. */
  walkTop: number;
  /** Scale applied to house art and the sidewalk strip. */
  scale: number;
  /** Where the house sprite lands, already scaled. */
  house: { x: number; y: number; w: number; h: number };
};

/**
 * Compose a layout for a given stage size.
 *
 * Vertical budget, bottom up: road, sidewalk, then whatever is left is the
 * house. The house is scaled to fit that remainder, so a short window shows a
 * smaller house rather than a cropped roof — losing the roofline reads as a
 * bug, losing resolution reads as a zoom.
 */
export function layout(w: number, h: number): Layout {
  const roadH = Math.max(90, Math.round(h * 0.2));
  const roadTop = h - roadH;

  // Pick the largest step whose house plus sidewalk still fits above the road,
  // leaving a little grass at the top so the roof never touches the frame.
  const TOP_GAP = 12;
  let scale = SCALE_STEPS[SCALE_STEPS.length - 1];
  for (const s of SCALE_STEPS) {
    const need = HOUSE_NATIVE.h * s + WALK_NATIVE_H * s + TOP_GAP;
    if (need <= roadTop + WALK_NATIVE_H * s) {
      scale = s;
      break;
    }
  }

  const walkH = Math.round(WALK_NATIVE_H * scale);
  const walkTop = roadTop - walkH;
  const houseW = Math.round(HOUSE_NATIVE.w * scale);
  const houseH = Math.round(HOUSE_NATIVE.h * scale);

  return {
    w,
    h,
    roadTop,
    walkTop,
    scale,
    house: {
      x: Math.round((w - houseW) / 2),
      // The delivered art already carries its own front lawn down to its bottom
      // edge, so the sprite sits directly on the sidewalk with no gap.
      y: walkTop - houseH,
      w: houseW,
      h: houseH,
    },
  };
}

/**
 * Anchors, expressed relative to the house so props stay put as the house
 * scales. `hx` and `hy` are fractions of the house rect; a prop at hy > 1 sits
 * below the house, in the front yard.
 */
export const ANCHORS: Record<string, { hx: number; hy: number }> = {
  DRIVEWAY_1: { hx: 0.74, hy: 0.70 },
  DRIVEWAY_2: { hx: 0.74, hy: 0.82 },
  DRIVEWAY_3: { hx: 0.74, hy: 0.95 },
  WALK_1: { hx: 0.49, hy: 0.85 },
  YARD_1: { hx: 0.12, hy: 0.76 },
  YARD_2: { hx: 0.28, hy: 0.84 },
  YARD_3: { hx: 0.14, hy: 0.95 },
  YARD_4: { hx: 0.30, hy: 0.97 },
  YARD_5: { hx: 0.92, hy: 0.80 },
  YARD_6: { hx: 0.90, hy: 0.96 },
  BED_FRONT: { hx: 0.22, hy: 0.64 },
  PORCH_1: { hx: 0.47, hy: 0.62 },
  /**
   * Bin positions, and the difference between them IS rule R-104.
   *
   * APRON is up by the garage: screened from the right-of-way, compliant at any
   * hour. CURB is out at the street: legal only Tue 6pm - Thu 9am. Same sprite,
   * two anchors, opposite verdicts — which is the design pillar working, and
   * why these are separate named anchors rather than one nudged by a few px.
   */
  APRON_1: { hx: 0.66, hy: 0.66 },
  APRON_2: { hx: 0.79, hy: 0.66 },
  // Curbside means IN THE ROAD, past the sidewalk, and clear of the driveway
  // apron so the truck can reach them and the car can still get out. The
  // sidewalk is WALK_NATIVE_H/HOUSE_NATIVE.h = 0.086 of the house tall, so the
  // road starts at hy 1.086; these sit just into it.
  CURB_1: { hx: 0.40, hy: 1.13 },
  CURB_2: { hx: 0.51, hy: 1.13 },
};

export function anchor(name: string, L: Layout): { x: number; y: number } {
  const a = ANCHORS[name];
  if (!a) throw new Error(`scene: unknown anchor "${name}"`);
  return {
    x: Math.round(L.house.x + a.hx * L.house.w),
    y: Math.round(L.house.y + a.hy * L.house.h),
  };
}
