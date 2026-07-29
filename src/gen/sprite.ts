/**
 * Flat house sprites.
 *
 * A house shell carries no gameplay state that varies at runtime — fence
 * condition, weeds, bins, vehicles, pods and decor are all separate tiers — and
 * the camera never moves. So the shell is a backdrop, and a backdrop should be
 * the best image available rather than the best box assembly.
 *
 * What the ground around it does NOT stop being is procedural: the driveway,
 * walk, curb and turf are still generated per-lot. That is the whole reason a
 * sprite needs a manifest. It has to declare where its garage door is, or the
 * generated concrete will visibly miss it.
 *
 * This module is environment-agnostic: it takes decoded pixels, never a file.
 * The browser decodes with Image + canvas, Node with core/png.
 */

import type { PaletteKey } from '../core/palette.js';
import { swapRamps } from '../core/quantize.js';
import type { Raster } from '../core/raster.js';

export type HouseManifest = {
  id: string;
  stories: 1 | 2;
  /** Where the sprite's top-left corner lands on the 480x440 lot canvas. */
  origin: [number, number];
  /**
   * Screen point of the garage door's centre at grade. The procedural driveway
   * aims here; if this is wrong the concrete misses the garage and it reads
   * instantly as broken.
   */
  garage_anchor: [number, number];
  /** Front door at grade — R-407's lockbox hangs here. */
  door_anchor: [number, number];
  /** Eave line [x0,y0,x1,y1] — R-401 strings holiday lights along it. */
  eave_line: [number, number, number, number];
  /**
   * Which palette ramp means what in this sprite. Only declared ramps are ever
   * recoloured, so a roof that happens to quantise into the same family as the
   * siding cannot be repainted by accident.
   */
  ramps: {
    siding?: PaletteKey;
    trim?: PaletteKey;
    roof?: PaletteKey;
    masonry?: PaletteKey;
  };
};

export type HouseSprite = {
  manifest: HouseManifest;
  w: number;
  h: number;
  /** Already quantised to the locked palette by the ingest step. */
  rgba: Uint8ClampedArray;
};

/** What a lot may repaint. Keys are roles, values are palette ramps. */
export type PaintSpec = Partial<Record<'siding' | 'trim' | 'roof' | 'masonry', PaletteKey>>;

/**
 * Resolve a role-keyed paint spec into the ramp-to-ramp swaps the quantiser
 * understands, using the sprite's own declaration of which ramp is which.
 */
function resolveSwaps(m: HouseManifest, paint?: PaintSpec): Partial<Record<PaletteKey, PaletteKey>> {
  const out: Partial<Record<PaletteKey, PaletteKey>> = {};
  if (!paint) return out;
  for (const role of ['siding', 'trim', 'roof', 'masonry'] as const) {
    const from = m.ramps[role];
    const to = paint[role];
    if (from && to && from !== to) out[from] = to;
  }
  return out;
}

/**
 * Blit a house sprite into the lot raster.
 *
 * Recolouring works on a copy — the loaded sprite is shared across every lot
 * that uses that shell, and mutating it would repaint every other house on the
 * street as a side effect.
 */
export function drawHouseSprite(
  r: Raster,
  sprite: HouseSprite,
  paint?: PaintSpec,
): void {
  const swaps = resolveSwaps(sprite.manifest, paint);
  let px = sprite.rgba;
  if (Object.keys(swaps).length) {
    px = new Uint8ClampedArray(sprite.rgba);
    swapRamps(px, swaps);
  }

  const [ox, oy] = sprite.manifest.origin;
  for (let y = 0; y < sprite.h; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= r.h) continue;
    for (let x = 0; x < sprite.w; x++) {
      const s = (y * sprite.w + x) << 2;
      if (px[s + 3] === 0) continue; // ingest hard-thresholds alpha, so this is binary
      r.px(ox + x, dy, [px[s], px[s + 1], px[s + 2]]);
    }
  }
}

/** Screen-space bounds of a placed sprite, for hit-testing and debug overlays. */
export function spriteBounds(s: HouseSprite): { x0: number; y0: number; x1: number; y1: number } {
  const [x, y] = s.manifest.origin;
  return { x0: x, y0: y, x1: x + s.w, y1: y + s.h };
}

/**
 * Decode a sprite from raw RGBA plus its manifest. Kept separate from any file
 * or network access so the same function serves the browser and the tools.
 */
export function makeSprite(
  manifest: HouseManifest,
  w: number,
  h: number,
  rgba: Uint8ClampedArray,
): HouseSprite {
  return { manifest, w, h, rgba };
}

export type SpriteRegistry = Map<string, HouseSprite>;
