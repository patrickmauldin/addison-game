/**
 * TIER 0.2 — MASTER PALETTE (LOCKED)
 *
 * 44 ramps x 3 tones. Nothing in this project renders a color that is not in
 * this table. Adding a color means adding a ramp here, deliberately.
 *
 * Ramp order is ALWAYS [shade, base, light]:
 *   [0] shade — faces whose normal points away from the sun (screen right-down)
 *   [1] base  — faces toward the sun (screen left-down), and flat detail
 *   [2] light — horizontal top faces, which catch the most sun
 *
 * SUN is fixed upper-left, 45deg, forever. See projection.ts.
 */

export type Rgb = readonly [number, number, number];
export type Ramp = readonly [Rgb, Rgb, Rgb];

const hex = (s: string): Rgb => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const ramp = (a: string, b: string, c: string): Ramp => [hex(a), hex(b), hex(c)];

export const PALETTE = {
  // --- Turf (6) ---------------------------------------------------------
  // Austin Bermuda is tan Nov-Mar, green Apr-Oct. The campaign (Mar 3 - Apr 26)
  // straddles green-up, so dormant is the DEFAULT early and transitional later.
  // dormant vs dead is a violation/decoy pair: dormant is even, dead is patchy.
  dormant_tan: ramp('#6b5c3a', '#8a7749', '#a8935c'),
  dormant_patchy: ramp('#5c4f33', '#7a6a42', '#97855a'),
  transitional: ramp('#5c6b34', '#7a8a44', '#98a85c'),
  healthy_green: ramp('#3d5c2a', '#547a38', '#6d9a4c'),
  dead_brown: ramp('#4a3a28', '#665038', '#83694b'),
  overgrown: ramp('#35502a', '#486c38', '#5d8a4a'),

  // --- Stone veneer (3) -------------------------------------------------
  limestone_white: ramp('#b8b2a4', '#d4cec0', '#e8e3d6'),
  limestone_tan: ramp('#9c8f78', '#b8ab92', '#d2c6ae'),
  limestone_mixed: ramp('#a89a84', '#c2b49c', '#dad0ba'),

  // --- Brick (2) --------------------------------------------------------
  brick_red: ramp('#6b3a30', '#8a4d40', '#a56354'),
  brick_tan: ramp('#8a7358', '#a58d6e', '#c0a887'),

  // --- Siding (6) -------------------------------------------------------
  gray: ramp('#6a6f72', '#868c90', '#a3a9ad'),
  khaki: ramp('#7d7358', '#9a8f70', '#b5aa8a'),
  taupe: ramp('#6f6459', '#8b7f72', '#a69a8c'),
  sage: ramp('#66705c', '#818c76', '#9ca892'),
  cream: ramp('#a89880', '#c8b89e', '#e0d2b8'),
  blue_gray: ramp('#5b6874', '#76848f', '#93a1ac'),

  // --- Trim (3) ---------------------------------------------------------
  trim_white: ramp('#c8c4bc', '#e2dfd8', '#f5f3ee'),
  trim_cream: ramp('#bdb298', '#d8ceb6', '#ece4d0'),
  bronze_dark: ramp('#3a3430', '#4e4640', '#635a52'),

  // --- Roof shingle (4) -------------------------------------------------
  weathered_gray: ramp('#4a4a4c', '#5e5f62', '#74757a'),
  charcoal: ramp('#2e2f33', '#3f4045', '#525359'),
  roof_brown: ramp('#453529', '#594636', '#6e5847'),
  tan_gray: ramp('#5c564c', '#736c60', '#8b8376'),

  // --- Concrete (3) -----------------------------------------------------
  concrete_fresh: ramp('#a5a29b', '#bcb9b2', '#d0cdc6'),
  concrete_weathered: ramp('#8d8a83', '#a3a099', '#b8b5ae'),
  concrete_oil_stained: ramp('#6e6b66', '#85817b', '#9b9791'),

  // --- Cedar fence (3) --------------------------------------------------
  cedar_new: ramp('#9a7649', '#b58e5c', '#cba873'),
  cedar_weathered: ramp('#6e6558', '#877d6d', '#a09585'),
  cedar_stained: ramp('#4e3b2a', '#654e38', '#7d6349'),

  // --- Vegetation (6) ---------------------------------------------------
  live_oak: ramp('#2b4029', '#3c5838', '#4f7049'),
  deciduous_leaf: ramp('#46612e', '#5d7d3f', '#769a54'),
  bare_branch: ramp('#4a3f34', '#605447', '#786a5b'),
  ornamental_tan: ramp('#8a7a52', '#a89568', '#c3b083'),
  agave_blue: ramp('#4a6b5e', '#628578', '#7d9f93'),
  weed_green: ramp('#52702f', '#6b8c40', '#86a855'),

  // --- Misc (8) ---------------------------------------------------------
  glass: ramp('#3c4a52', '#55676f', '#7a8c94'),
  asphalt: ramp('#33333a', '#43434b', '#55555e'),
  mulch: ramp('#3f3126', '#543f30', '#6a523f'),
  decomposed_granite: ramp('#8a7f6c', '#a29684', '#b9ae9c'),
  steel: ramp('#5a5f66', '#757b82', '#929aa1'),
  rust: ramp('#6b3d24', '#8a5232', '#a56a45'),
  bin_green: ramp('#2c4a2e', '#3d6640', '#518254'),
  bin_brown: ramp('#4a3626', '#634a34', '#7c6046'),
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Tone index into a ramp. */
export const SHADE = 0;
export const BASE = 1;
export const LIGHT = 2;

export function ramps(key: PaletteKey): Ramp {
  const r = PALETTE[key];
  if (!r) throw new Error(`palette: unknown ramp "${key}"`);
  return r;
}

export function tone(key: PaletteKey, t: 0 | 1 | 2): Rgb {
  return ramps(key)[t];
}

/** Count check — the manifest specifies ~44 ramps. Guards against drift. */
export const RAMP_COUNT = Object.keys(PALETTE).length;

// --- Palette-safe shading -------------------------------------------------
// Multiplying a pixel by 0.72 to make a shadow is the obvious implementation
// and it silently breaks the Tier 0 contract: it emits colours that are in no
// ramp. In pixel art that is precisely the drift the locked palette exists to
// prevent, and it compounds — every shadow pass widens the real palette.
//
// Instead, a shadow steps DOWN the ramp the pixel already belongs to. This is
// how a pixel artist would shade it, it can never leave the palette, and it
// makes shadow depth a discrete authored decision rather than a float.

const packed = (c: Rgb) => (c[0] << 16) | (c[1] << 8) | c[2];

const TONE_INDEX = new Map<number, { key: PaletteKey; tone: 0 | 1 | 2 }>();
for (const [key, ramp] of Object.entries(PALETTE) as Array<[PaletteKey, Ramp]>) {
  ramp.forEach((c, i) => {
    // First writer wins: a colour shared by two ramps keeps its first home,
    // which is stable because PALETTE is declared in a fixed order.
    if (!TONE_INDEX.has(packed(c))) TONE_INDEX.set(packed(c), { key, tone: i as 0 | 1 | 2 });
  });
}

/**
 * Step a colour `steps` tones darker within its own ramp. Colours already at
 * the darkest tone stay put — a shadow on an already-dark surface should be
 * subtle, and inventing a new dark colour is exactly what this prevents.
 * Unknown colours are returned unchanged rather than guessed at.
 */
export function darken(c: Rgb | ArrayLike<number>, steps = 1): Rgb {
  const key = ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;
  const found = TONE_INDEX.get(key);
  if (!found) return [c[0], c[1], c[2]];
  const t = Math.max(0, found.tone - steps) as 0 | 1 | 2;
  return PALETTE[found.key][t];
}
