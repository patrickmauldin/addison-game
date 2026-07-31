/**
 * THREE-QUARTER COMPOSITOR — full bleed.
 *
 * A lot is data. Grass fills the frame, the house sits on it, the sidewalk and
 * road band across the bottom. Draw order is screen y: lower is nearer.
 *
 * Everything visible is now delivered art. The only thing still generated is
 * the layout itself — where the bands fall and how the house scales — which is
 * exactly the part that has to respond to the window.
 *
 * The id buffer is unchanged: a flaggable object declares an id before it
 * draws, and a click resolves in O(1) with no geometry.
 */

import { anchor, layout, mergeAnchors, WALK_NATIVE_H, type AnchorTable, type Layout } from './core/scene.js';
import { PALETTE, type Rgb } from './core/palette.js';
import { Raster } from './core/raster.js';

export type Bitmap = { w: number; h: number; rgba: Uint8ClampedArray };

export type PropSpec = {
  id: string;
  /** Asset key, resolved against SceneAssets.sprites. */
  sprite: string;
  anchor: string;
  label: string;
  /** Draw scale relative to the house scale. 1 = same world scale. */
  scale?: number;
  /**
   * Horizontal alignment of the sprite on its anchor. Default 'center' suits
   * anything standing on a spot — a bin, a weed patch. 'left' suits anything
   * that BUTTS something: a fence panel running back from the house wall wants
   * its end post on the anchor, not its middle.
   */
  align?: 'center' | 'left' | 'right';
  first_seen?: string;
  flaggable?: boolean;
};

export type LotSpec = {
  lot_id: string;
  address: string;
  street: string;
  house?: {
    sprite?: string;
    mirror?: boolean;
    /**
     * A repainted version of the same house — `house1-window` for the smashed
     * pane, `house1-christmas` for the lights. Drawn INSTEAD of the base, with
     * the pixels that differ from it becoming the click target. See
     * stampVariant: nothing about where the change is has to be authored.
     */
    variant?: string;
    /** What the Findings pad calls the changed part. Required with `variant`. */
    variantLabel?: string;
    /** Object id for the changed part, so truth blocks can name it. */
    variantId?: string;
    /**
     * The repainted part is a LIGHT SOURCE, so the dark does not fall on it.
     *
     * True for Christmas lights, false for a broken window — glass does not
     * glow. See paint(): the marked pixels are lifted back out and redrawn on
     * top of the night wash, which is the whole reason the diff mask is worth
     * keeping around after compositing.
     */
    variantGlows?: boolean;
  };
  props: PropSpec[];
  truth: {
    violations: Array<{ object: string; article: string; why: string }>;
    decoys: Array<{ object: string; why: string }>;
  };
  expected_verdict: 'PASS' | 'FAIL' | 'NOTICE' | 'CITATION';
  notes_for_designer?: string;
  seed: number;
};

export type RenderedObject = {
  id: string; label: string; key: number; flaggable: boolean; first_seen?: string;
};
/**
 * Where a prop ended up, and the ground line it stands on.
 *
 * Exported so the paint pass can put a bin back in FRONT of somebody who is
 * standing further up the lot than it is. The scene is composited once into an
 * image for speed, which means anything drawn afterwards — the residents — lands
 * on top of everything regardless of depth. Handing back the rects lets those
 * few props be re-blitted in the right order without recompositing.
 *
 * The rect is tight to the sprite's solid pixels, not its canvas.
 */
export type PlacedProp = { x: number; y: number; w: number; h: number; baseY: number };

export type RenderedLot = {
  raster: Raster;
  objects: RenderedObject[];
  byKey: Map<number, RenderedObject>;
  layout: Layout;
  props: PlacedProp[];
};

export type SceneAssets = {
  /** grass, road, sidewalk, house1, weed1..3, trash-green, trash-brown ... */
  sprites: Map<string, Bitmap>;
  /** Per-house anchor overrides, keyed by house sprite id. See data/houses.json. */
  houseAnchors?: Record<string, Partial<AnchorTable> | undefined>;
};

// --- Blitting --------------------------------------------------------------

/**
 * Box-filter sample of a source bitmap, alpha-blended over the destination.
 * Used because the delivered art is
 * ~1254px native and almost always drawn smaller: nearest-neighbor at a
 * fractional ratio drops whole grass tufts and picket lines unevenly, which
 * reads as damage rather than as scale.
 */
function blitScaled(
  r: Raster,
  src: Bitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  opaque: boolean,
  flipX = false,
): void {
  const sxr = src.w / dw;
  const syr = src.h / dh;
  for (let y = 0; y < dh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= r.h) continue;
    const sy0 = Math.floor(y * syr);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * syr));
    for (let x = 0; x < dw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= r.w) continue;
      const srcCol = flipX ? dw - 1 - x : x;
      const sx0 = Math.floor(srcCol * sxr);
      const sx1 = Math.max(sx0 + 1, Math.floor((srcCol + 1) * sxr));
      let rr = 0, gg = 0, bb = 0, aa = 0, n = 0;
      for (let j = sy0; j < sy1 && j < src.h; j++)
        for (let i = sx0; i < sx1 && i < src.w; i++) {
          const s = (j * src.w + i) << 2;
          const a = src.rgba[s + 3] / 255;
          rr += src.rgba[s] * a; gg += src.rgba[s + 1] * a; bb += src.rgba[s + 2] * a;
          aa += src.rgba[s + 3]; n++;
        }
      const alpha = aa / n / 255;
      if (alpha <= 0) continue;
      // Un-premultiply to recover the source color, then blend. Blending
      // rather than cutting is what preserves the drop shadows the sprites
      // carry at ~30% alpha; a hard cut deletes them and the props look pasted
      // onto the lawn instead of standing on it.
      const c: Rgb = [rr / n / alpha, gg / n / alpha, bb / n / alpha];
      if (opaque) r.px(tx, ty, c);
      else r.blendPx(tx, ty, c, alpha);
    }
  }
}

/**
 * How far a channel must move before a pixel counts as REPAINTED.
 *
 * The houses ship as JPEG, so a re-export of the same picture still differs
 * everywhere by a little: on house1 over a million pixels differ by something,
 * but under five thousand differ by more than this. The real edits — smashed
 * glass, a string of lights — clear 64. The gap between the noise floor and the
 * signal is wide enough that the exact number does not matter much; it only has
 * to sit inside it.
 */
const VARIANT_THRESHOLD = 24;

/**
 * Give the repainted part of a house its own click target.
 *
 * The variant is a whole house, identical to the base except for the thing that
 * is wrong with it. Rather than authoring where the broken window is — six
 * numbers per house that go stale the moment the art is re-exported, and which
 * would not describe a string of lights at all — the CHANGED PIXELS are the
 * violation. Diffing the two images finds them exactly, for any house and any
 * future repaint, with nothing measured by hand.
 *
 * Runs as a second pass over the same box filter the house was drawn with, so
 * the destination pixels it stamps are exactly the ones the variant painted
 * differently. The colour is left alone — only the id buffer is written.
 */
function stampVariant(
  r: Raster,
  base: Bitmap,
  variant: Bitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  flipX: boolean,
): void {
  if (base.w !== variant.w || base.h !== variant.h) return;
  const sxr = variant.w / dw;
  const syr = variant.h / dh;
  for (let y = 0; y < dh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= r.h) continue;
    const sy0 = Math.floor(y * syr);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * syr));
    for (let x = 0; x < dw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= r.w) continue;
      const srcCol = flipX ? dw - 1 - x : x;
      const sx0 = Math.floor(srcCol * sxr);
      const sx1 = Math.max(sx0 + 1, Math.floor((srcCol + 1) * sxr));
      // ANY source pixel in the box having changed claims the destination
      // pixel. A light strand is a couple of source pixels wide and would be
      // averaged away by asking for the mean to have moved.
      let changed = false;
      for (let j = sy0; j < sy1 && j < variant.h && !changed; j++)
        for (let i = sx0; i < sx1 && i < variant.w; i++) {
          const s = (j * variant.w + i) << 2;
          if (Math.abs(variant.rgba[s] - base.rgba[s]) > VARIANT_THRESHOLD
            || Math.abs(variant.rgba[s + 1] - base.rgba[s + 1]) > VARIANT_THRESHOLD
            || Math.abs(variant.rgba[s + 2] - base.rgba[s + 2]) > VARIANT_THRESHOLD) {
            changed = true;
            break;
          }
        }
      if (changed) r.stampId(tx, ty);
    }
  }
}

/**
 * Tile a bitmap across a band at a given scale.
 *
 * The scale matters more than it looks. house1 carries its own lawn, and the
 * house is drawn scaled to fit the window — so if the surrounding grass tiles
 * at 1:1 while the house's baked lawn is at 0.5, the tuft sizes disagree and
 * the house reads as a patch pasted onto a different lawn. Ground tiles take
 * the same scale as the house so all grass in frame is one lawn.
 */
function tile(r: Raster, src: Bitmap, y0: number, y1: number, scale = 1, phaseX = 0): void {
  const tw = Math.max(1, Math.round(src.w * scale));
  const th = Math.max(1, Math.round(src.h * scale));
  for (let y = Math.max(0, y0); y < Math.min(r.h, y1); y++) {
    const sy = Math.min(src.h - 1, Math.floor((((y % th) + th) % th) / scale));
    for (let x = 0; x < r.w; x++) {
      const sx = Math.min(src.w - 1, Math.floor(((((x + phaseX) % tw) + tw) % tw) / scale));
      const s = (sy * src.w + sx) << 2;
      if (src.rgba[s + 3] === 0) continue;
      r.px(x, y, [src.rgba[s], src.rgba[s + 1], src.rgba[s + 2]]);
    }
  }
}

/** Tile horizontally only, at a fixed scale — for the sidewalk strip. */
function tileStrip(r: Raster, src: Bitmap, y0: number, h: number, phaseX = 0): void {
  const w = Math.max(1, Math.round(src.w * (h / src.h)));
  const start = -(((phaseX % w) + w) % w);
  for (let x = start; x < r.w; x += w) blitScaled(r, src, x, y0, w, h, true);
}

function fill(r: Raster, y0: number, y1: number, c: Rgb): void {
  for (let y = Math.max(0, y0); y < Math.min(r.h, y1); y++)
    for (let x = 0; x < r.w; x++) r.px(x, y, c);
}

/**
 * Where a sprite actually meets the ground, in its own pixel space.
 *
 * Props are placed by their contact point, not by their canvas. Those differ
 * whenever a sprite carries an asymmetric drop shadow: the delivered bins put
 * their shadow in the left third, so their solid body sits at x 50..137 of a
 * 138-wide frame — centring the canvas would stand the bin a quarter of its
 * width right of its anchor, and every future sprite with a shadow would be
 * wrong by a different amount.
 *
 * Measured from the BOTTOM band of solid pixels, because that is the part
 * touching the ground; the lid flaring wider than the wheels should not shift
 * where the bin stands.
 */
type Footprint = { cx: number; baseY: number; topY: number; x0: number; x1: number };
const footprintCache = new WeakMap<Bitmap, Footprint>();
function footprint(src: Bitmap): Footprint {
  const hit = footprintCache.get(src);
  if (hit) return hit;
  const SOLID = 128;
  let baseY = src.h - 1;
  for (let y = src.h - 1; y >= 0; y--) {
    let any = false;
    for (let x = 0; x < src.w; x++) if (src.rgba[((y * src.w + x) << 2) + 3] >= SOLID) { any = true; break; }
    if (any) { baseY = y; break; }
  }
  // Bottom eighth of the sprite's height, which is the contact band.
  const band = Math.max(1, Math.round(src.h * 0.12));
  let sum = 0, n = 0;
  for (let y = Math.max(0, baseY - band); y <= baseY; y++)
    for (let x = 0; x < src.w; x++)
      if (src.rgba[((y * src.w + x) << 2) + 3] >= SOLID) { sum += x; n++; }
  // Solid horizontal extents, for props aligned by an edge rather than a
  // center. The fence art carries 6px of transparent padding on the left and
  // 11px on the right; aligning by the canvas would stand it that far off the
  // wall it is supposed to butt against.
  let x0 = src.w;
  let x1 = -1;
  // Topmost solid row too, so the paint pass can re-blit a prop over somebody
  // standing behind it using a TIGHT box. The full canvas rect would carry the
  // sprite's transparent padding with it and rub out anyone standing in it.
  let topY = src.h - 1;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++)
      if (src.rgba[((y * src.w + x) << 2) + 3] >= SOLID) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < topY) topY = y;
      }
  if (x1 < 0) { x0 = 0; x1 = src.w - 1; topY = 0; }

  const res = { cx: n ? sum / n : src.w / 2, baseY, topY, x0, x1 };
  footprintCache.set(src, res);
  return res;
}

// --- Render ----------------------------------------------------------------

export function renderLot(
  spec: LotSpec,
  assets: SceneAssets,
  width: number,
  height: number,
  /**
   * Where this lot sits along the street, in pixels.
   *
   * Ground tiles are phased by it so that two lots rendered separately and slid
   * past each other line up. Without this every lot starts its grass at phase 0
   * and the join between them is a hard vertical seam in the middle of the
   * transition — the one frame the player is guaranteed to be looking at.
   */
  worldX = 0,
): RenderedLot {
  const L = layout(width, height);
  const r = new Raster(L.w, L.h);
  const objects: RenderedObject[] = [];
  const byKey = new Map<number, RenderedObject>();
  let nextKey = 1;
  const begin = (o: Omit<RenderedObject, 'key'>) => {
    const rec = { ...o, key: nextKey++ };
    objects.push(rec); byKey.set(rec.key, rec); r.setObject(rec.key);
  };
  const scenery = () => r.setObject(0);
  const S = assets.sprites;
  const mirror = !!spec.house?.mirror;

  scenery();

  // --- Ground, bottom of the stack -----------------------------------------
  // ALL ground goes down before anything that stands on it. Drawing the
  // sidewalk after the props painted over the bottom of every bin parked near
  // it: a can standing ON the pavement had its base erased BY the pavement.
  // "Draw the ground last so nothing spills onto it" is exactly backwards —
  // spilling onto the ground is what objects resting on it are supposed to do.
  const grass = S.get('grass');
  if (grass) tile(r, grass, 0, L.h, L.scale, worldX);
  else fill(r, 0, L.h, PALETTE.healthy_green[1] as Rgb);

  const walk = S.get('sidewalk');
  const walkH = L.roadTop - L.walkTop;
  if (walk) tileStrip(r, walk, L.walkTop, walkH, worldX);
  else fill(r, L.walkTop, L.roadTop, PALETTE.concrete_weathered[2] as Rgb);

  const road = S.get('road');
  if (road) tile(r, road, L.roadTop, L.h, L.scale, worldX);
  else fill(r, L.roadTop, L.h, PALETTE.asphalt[0] as Rgb);

  // House. Its own lawn is baked in and matches the tile closely enough that
  // the join is invisible, so it blits opaque with no keying.
  const baseHouse = spec.house?.sprite ? S.get(spec.house.sprite) : undefined;
  const variant = spec.house?.variant ? S.get(spec.house.variant) : undefined;
  // The variant IS the house when there is one — same picture, repainted.
  const house = variant ?? baseHouse;
  if (house) {
    blitScaled(r, house, L.house.x, L.house.y, L.house.w, L.house.h, true, mirror);
    // Then hand the changed pixels their own id, so the broken window or the
    // strung lights can be clicked and cited like any prop.
    if (variant && baseHouse && spec.house?.variantId) {
      begin({
        id: spec.house.variantId,
        label: spec.house.variantLabel ?? 'Dwelling',
        flaggable: true,
      });
      stampVariant(r, baseHouse, variant, L.house.x, L.house.y, L.house.w, L.house.h, mirror);
      scenery();
    }
  } else {
    // Hatched placeholder — can never be mistaken for finished art.
    const c = PALETTE.concrete_weathered;
    for (let y = L.house.y; y < L.house.y + L.house.h; y++)
      for (let x = L.house.x; x < L.house.x + L.house.w; x++)
        r.px(x, y, ((x + y) % 14) < 2 ? c[1] : c[2]);
  }

  // Props, back to front by screen y. Anchors come from this house's table:
  // its own plan where it declares one, the defaults everywhere else.
  //
  // On a mirrored lot every anchor reflects about the house's center line, so
  // one measured table serves both handednesses — there is no second set of
  // numbers to keep in step with the first.
  const base = mergeAnchors(
    spec.house?.sprite ? assets.houseAnchors?.[spec.house.sprite] : undefined,
  );
  const anchors: AnchorTable = mirror
    ? Object.fromEntries(Object.entries(base).map(([k, a]) => [k, { hx: 1 - a.hx, hy: a.hy }]))
    : base;
  const placedProps: PlacedProp[] = [];
  const placed = spec.props.map((p) => ({ p, a: anchor(p.anchor, L, anchors) }));
  /**
   * Depth order, with one exception: overgrown turf goes under everything.
   *
   * Everything else sorts by its ground line, which is what makes a bin at the
   * curb sit in front of a fence up the lot. Tall grass is different — it is
   * what the lot is covered IN, not a thing standing on it, so a tuft that
   * happens to sit lower than a bin must still not be painted over the bin.
   * Sorting grass to the front of the list puts it under the lot's contents
   * while leaving the tufts correctly ordered among themselves.
   */
  const isGrass = (p: PropSpec) => p.sprite.startsWith('grass');
  placed.sort((a, b) => {
    const g = Number(isGrass(b.p)) - Number(isGrass(a.p));
    return g !== 0 ? g : a.a.y - b.a.y;
  });
  // From here to the end of the loop, remember which pixels the props actually
  // cover, so the paint pass can lift them back out with their real silhouette
  // rather than as a rectangle full of sidewalk.
  r.trackCoverage(true);
  for (const { p, a } of placed) {
    const spr = S.get(p.sprite);
    if (!spr) continue; // art not delivered yet; the lot still plays
    if (p.flaggable === false) scenery();
    else begin({ id: p.id, label: p.label, flaggable: true, first_seen: p.first_seen });
    const s = L.scale * (p.scale ?? 1);
    const w = Math.max(1, Math.round(spr.w * s));
    const h = Math.max(1, Math.round(spr.h * s));
    // An anchor marks where the prop MEETS THE GROUND, so the sprite is placed
    // by its contact point rather than by its canvas — see footprint().
    const fp = footprint(spr);
    // A fence that butted the wall on the right must butt it on the left once
    // the plan is reflected, so edge alignment swaps with the house.
    const align = !mirror ? p.align
      : p.align === 'left' ? 'right'
      : p.align === 'right' ? 'left'
      : p.align;

    /**
     * Only STRUCTURE flips with the plan. Edge-aligned props are attached to
     * the building — a fence has to reverse to butt the other wall. Loose
     * objects do not: every sprite carries a baked drop shadow, and flipping a
     * bin would throw its shadow to the other side while identical bins on
     * unmirrored lots kept theirs, which is visible the moment two lots share
     * the screen during the drive between them.
     *
     * So a mirrored lot reflects WHERE things stand, not how they are lit.
     */
    const flipSprite = mirror && p.align !== undefined;
    // Solid extents are measured in the sprite's own space; when it is drawn
    // flipped, its left edge comes from what was its right.
    const left = flipSprite ? spr.w - 1 - fp.x1 : fp.x0;
    const right = flipSprite ? spr.w - 1 - fp.x0 : fp.x1;
    const cx = flipSprite ? spr.w - 1 - fp.cx : fp.cx;
    const ax =
      align === 'left' ? a.x - left * s
      : align === 'right' ? a.x - (right + 1) * s
      : a.x - cx * s;
    const ay = a.y - (fp.baseY + 1) * s;
    blitScaled(r, spr, Math.round(ax), Math.round(ay), w, h, false, flipSprite);
    // Tight box, in the sprite's drawn orientation.
    const sx0 = flipSprite ? spr.w - 1 - fp.x1 : fp.x0;
    const sx1 = flipSprite ? spr.w - 1 - fp.x0 : fp.x1;
    placedProps.push({
      x: Math.round(ax + sx0 * s),
      y: Math.round(ay + fp.topY * s),
      w: Math.max(1, Math.round((sx1 - sx0 + 1) * s)),
      h: Math.max(1, Math.round((fp.baseY - fp.topY + 1) * s)),
      baseY: a.y,
    });
  }

  r.trackCoverage(false);

  return { raster: r, objects, byKey, layout: L, props: placedProps };
}

export { WALK_NATIVE_H };
