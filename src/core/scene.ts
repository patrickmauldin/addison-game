/**
 * THREE-QUARTER SCENE — full bleed.
 *
 * The camera looks down at the lot from the street. No skew: screen x is world
 * x, depth runs up the screen. The scene fills the whole stage rather than
 * sitting in a framed box, so grass runs to every edge and the lot reads as
 * part of a neighborhood instead of a specimen on a card.
 *
 *   grass ...................... to all four edges
 *   HOUSE ...................... centerd, its own lawn blending into the tile
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

export type Anchor = { hx: number; hy: number };
export type AnchorTable = Record<string, Anchor>;

/**
 * What surface an anchor is REQUIRED to sit on.
 *
 * This is the contract that makes per-house overrides safe. A driveway anchor
 * on a plan whose driveway is on the other side would silently park a truck on
 * the lawn; declaring the requirement lets the validator sample the house art
 * and fail the build instead. `road` anchors sit below the house sprite
 * entirely, so they are checked by position rather than by pixel.
 */
/**
 * What is under a pixel of house art: grass, paving, or neither.
 *
 * ONE definition, used by the tool that measures the anchors and the tool that
 * checks them. They had a copy each, differing by a single term — one required
 * blue > 95 for paving and the other did not — and on house9 that landed either
 * side of a driveway pixel at rgb(161,130,99). The measurer wrote an anchor it
 * considered valid and the checker rejected it, which is the one disagreement
 * this pair of tools must never have.
 *
 * 'bed' is the catch-all: mulch, structure, roof, anything that is not lawn and
 * not pavement. An anchor declared as `bed` accepts any of them.
 */
export function surfaceOf(r: number, g: number, b: number): 'grass' | 'paving' | 'bed' {
  // Grass is strongly green-over-blue; paving is pale and near-neutral. On this
  // art grass reads ~100 on green-minus-blue and paving ~40, so 60 splits them.
  if (g - b > 60) return 'grass';
  return r > 150 && g >= 130 ? 'paving' : 'bed';
}

/**
 * The PLAN a house sprite belongs to: "house7b" and "house1-christmas" both
 * resolve to the numbered house they are a repaint of.
 *
 * Every variation of a plan is the same building photographed the same way —
 * an open garage, a smashed pane, a string of lights — so the driveway, the
 * walk and the fence line are in exactly the same place. One measured table
 * serves all of them, and there is no second set of numbers to keep in step.
 */
export function housePlan(sprite: string): string {
  return /^house\d+/.exec(sprite)?.[0] ?? sprite;
}

export const ANCHOR_SURFACE: Record<string, 'paving' | 'grass' | 'bed' | 'road' | 'attach'> = {
  DRIVEWAY_1: 'paving', DRIVEWAY_2: 'paving', DRIVEWAY_3: 'paving',
  APRON_1: 'paving', APRON_2: 'paving',
  WALK_1: 'paving', PORCH_1: 'paving',
  YARD_1: 'grass', YARD_2: 'grass', YARD_3: 'grass',
  YARD_4: 'grass', YARD_5: 'grass', YARD_6: 'grass',
  BED_FRONT: 'bed',
  CURB_1: 'road', CURB_2: 'road',
  // The fence ATTACHES to the house's right wall rather than standing on a
  // surface, so it is checked by position, not by the pixel under it. Requiring
  // grass here pushed it off the wall and left a gap.
  FENCE_1: 'attach',
  // Bins stored BEHIND the side-yard fence. They STAND ON THE SIDE YARD — they
  // are not attached to the wall the way the fence is, which is what 'attach'
  // means and why declaring it that way made the validator rightly complain
  // that they were nowhere near it.
  BINS_SCREENED: 'grass',
};

/**
 * Default anchors, relative to the house rect so props hold position as the
 * house scales. `hx`/`hy` are fractions; hy > 1 is below the house sprite.
 *
 * These are FALLBACKS. Any house whose floor plan differs — driveway on the
 * left, a walk that reaches the sidewalk, a deeper setback — overrides the
 * anchors that moved in src/data/houses.json and inherits the rest.
 */
export const DEFAULT_ANCHORS: AnchorTable = {
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
  /**
   * Up-screen of FENCE_1, which is what puts the bins BEHIND it: props draw in
   * anchor-y order, so a smaller y means the fence panel is painted over their
   * base. Screened bins are compliant on any day — see R-104's decoy note.
   */
  BINS_SCREENED: { hx: 0.90, hy: 0.58 },
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
  /**
   * Side-yard fence, on the clean (right) side of every plan. Left-aligned
   * rather than centerd, so the panel's end post meets the wall instead of
   * straddling it — see PropSpec.align.
   */
  FENCE_1: { hx: 0.960, hy: 0.604 },
};

/**
 * Merge a house's overrides over the defaults. Per-anchor, not per-table, so a
 * house that only moved its driveway does not have to restate its whole yard.
 */
export function mergeAnchors(overrides?: Partial<AnchorTable>): AnchorTable {
  if (!overrides) return DEFAULT_ANCHORS;
  const out: AnchorTable = { ...DEFAULT_ANCHORS };
  for (const [k, v] of Object.entries(overrides)) if (v) out[k] = v;
  return out;
}

export function anchor(
  name: string,
  L: Layout,
  table: AnchorTable = DEFAULT_ANCHORS,
): { x: number; y: number } {
  const a = table[name];
  if (!a) throw new Error(`scene: unknown anchor "${name}"`);
  return {
    x: Math.round(L.house.x + a.hx * L.house.w),
    y: Math.round(L.house.y + a.hy * L.house.h),
  };
}

/** Back-compat alias; prefer DEFAULT_ANCHORS. */
export const ANCHORS = DEFAULT_ANCHORS;
