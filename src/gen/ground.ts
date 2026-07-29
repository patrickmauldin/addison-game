/**
 * Background: tiled grass, road band, and the hard surfaces between them.
 *
 * The lot is no longer a bounded shape. Grass is a pattern that fills the whole
 * frame and keeps going, so nothing reads as a diorama sitting on a green
 * field — which is the same argument that made neighbour slabs mandatory under
 * the old projection, solved more directly.
 */

import { BAND, CANVAS_H, CANVAS_W } from '../core/scene.js';
import type { Bitmap } from '../core/png.js';
import type { Raster } from '../core/raster.js';
import type { Rgb } from '../core/palette.js';

export type Tiles = {
  grass?: Bitmap;
  road?: Bitmap;
};

/**
 * Tile a bitmap across a horizontal band.
 *
 * `phase` shifts the sampling origin so two bands drawn from the same tile do
 * not line up their motifs into visible columns.
 */
export function tileBand(
  r: Raster,
  tile: Bitmap,
  y0: number,
  y1: number,
  phaseX = 0,
  phaseY = 0,
): void {
  for (let y = Math.max(0, y0); y < Math.min(CANVAS_H, y1); y++) {
    const sy = (((y + phaseY) % tile.h) + tile.h) % tile.h;
    for (let x = 0; x < CANVAS_W; x++) {
      const sx = (((x + phaseX) % tile.w) + tile.w) % tile.w;
      const s = (sy * tile.w + sx) << 2;
      if (tile.rgba[s + 3] === 0) continue;
      r.px(x, y, [tile.rgba[s], tile.rgba[s + 1], tile.rgba[s + 2]]);
    }
  }
}

/** Flat fill, used when a tile has not been supplied yet. */
export function fillBand(r: Raster, y0: number, y1: number, c: Rgb): void {
  for (let y = Math.max(0, y0); y < Math.min(CANVAS_H, y1); y++)
    for (let x = 0; x < CANVAS_W; x++) r.px(x, y, c);
}

/**
 * Lay down the whole background in one pass: grass everywhere, then the road
 * band over the bottom, then sidewalk and curb between them.
 *
 * Tiles are optional. Missing art falls back to a flat band in a palette
 * colour, so the scene still composes and the game still runs while art is in
 * production — the same rule the house sprite path follows.
 */
export function drawGround(
  r: Raster,
  tiles: Tiles,
  fallback: { grass: Rgb; road: Rgb; walk: Rgb; curb: Rgb },
): void {
  // Grass first, edge to edge. It shows through everywhere nothing covers it.
  if (tiles.grass) tileBand(r, tiles.grass, 0, CANVAS_H);
  else fillBand(r, 0, CANVAS_H, fallback.grass);

  // Road across the bottom.
  if (tiles.road) tileBand(r, tiles.road, BAND.curbBase, CANVAS_H);
  else fillBand(r, BAND.curbBase, CANVAS_H, fallback.road);

  // Sidewalk and curb. Flat for now — these want their own tiles, but they are
  // narrow bands and a flat fill reads correctly until those arrive.
  fillBand(r, BAND.yardBase, BAND.walkBase, fallback.walk);
  fillBand(r, BAND.walkBase, BAND.curbBase, fallback.curb);
}
