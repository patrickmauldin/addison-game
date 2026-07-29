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

import { anchor, layout, WALK_NATIVE_H, type Layout } from './core/scene.js';
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
  first_seen?: string;
  flaggable?: boolean;
};

export type LotSpec = {
  lot_id: string;
  address: string;
  street: string;
  house?: { sprite?: string };
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
export type RenderedLot = {
  raster: Raster;
  objects: RenderedObject[];
  byKey: Map<number, RenderedObject>;
  layout: Layout;
};

export type SceneAssets = {
  /** grass, road, sidewalk, house1, weed1..3, trash-green, trash-brown ... */
  sprites: Map<string, Bitmap>;
};

// --- Blitting --------------------------------------------------------------

/**
 * Box-filter sample of a source bitmap. Used because the delivered art is
 * ~1254px native and almost always drawn smaller: nearest-neighbour at a
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
      const sx0 = Math.floor(x * sxr);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * sxr));
      let rr = 0, gg = 0, bb = 0, aa = 0, n = 0;
      for (let j = sy0; j < sy1 && j < src.h; j++)
        for (let i = sx0; i < sx1 && i < src.w; i++) {
          const s = (j * src.w + i) << 2;
          const a = src.rgba[s + 3] / 255;
          rr += src.rgba[s] * a; gg += src.rgba[s + 1] * a; bb += src.rgba[s + 2] * a;
          aa += src.rgba[s + 3]; n++;
        }
      const alpha = aa / n / 255;
      // Hard alpha cut: a soft edge haloes against the grass tile.
      if (!opaque && alpha < 0.5) continue;
      r.px(tx, ty, [rr / n / Math.max(alpha, 0.001), gg / n / Math.max(alpha, 0.001), bb / n / Math.max(alpha, 0.001)] as Rgb);
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
function tile(r: Raster, src: Bitmap, y0: number, y1: number, scale = 1): void {
  const tw = Math.max(1, Math.round(src.w * scale));
  const th = Math.max(1, Math.round(src.h * scale));
  for (let y = Math.max(0, y0); y < Math.min(r.h, y1); y++) {
    const sy = Math.min(src.h - 1, Math.floor((((y % th) + th) % th) / scale));
    for (let x = 0; x < r.w; x++) {
      const sx = Math.min(src.w - 1, Math.floor((((x % tw) + tw) % tw) / scale));
      const s = (sy * src.w + sx) << 2;
      if (src.rgba[s + 3] === 0) continue;
      r.px(x, y, [src.rgba[s], src.rgba[s + 1], src.rgba[s + 2]]);
    }
  }
}

/** Tile horizontally only, at a fixed scale — for the sidewalk strip. */
function tileStrip(r: Raster, src: Bitmap, y0: number, h: number): void {
  const w = Math.max(1, Math.round(src.w * (h / src.h)));
  for (let x = 0; x < r.w; x += w) blitScaled(r, src, x, y0, w, h, true);
}

function fill(r: Raster, y0: number, y1: number, c: Rgb): void {
  for (let y = Math.max(0, y0); y < Math.min(r.h, y1); y++)
    for (let x = 0; x < r.w; x++) r.px(x, y, c);
}

// --- Render ----------------------------------------------------------------

export function renderLot(
  spec: LotSpec,
  assets: SceneAssets,
  width: number,
  height: number,
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

  scenery();

  // Grass, edge to edge. Everything else covers part of it.
  const grass = S.get('grass');
  if (grass) tile(r, grass, 0, L.h, L.scale);
  else fill(r, 0, L.h, PALETTE.healthy_green[1] as Rgb);

  // House. Its own lawn is baked in and matches the tile closely enough that
  // the join is invisible, so it blits opaque with no keying.
  const house = spec.house?.sprite ? S.get(spec.house.sprite) : undefined;
  if (house) {
    blitScaled(r, house, L.house.x, L.house.y, L.house.w, L.house.h, true);
  } else {
    // Hatched placeholder — can never be mistaken for finished art.
    const c = PALETTE.concrete_weathered;
    for (let y = L.house.y; y < L.house.y + L.house.h; y++)
      for (let x = L.house.x; x < L.house.x + L.house.w; x++)
        r.px(x, y, ((x + y) % 14) < 2 ? c[1] : c[2]);
  }

  // Props, back to front by screen y.
  const placed = spec.props.map((p) => ({ p, a: anchor(p.anchor, L) }));
  placed.sort((a, b) => a.a.y - b.a.y);
  for (const { p, a } of placed) {
    const spr = S.get(p.sprite);
    if (!spr) continue; // art not delivered yet; the lot still plays
    if (p.flaggable === false) scenery();
    else begin({ id: p.id, label: p.label, flaggable: true, first_seen: p.first_seen });
    const s = L.scale * (p.scale ?? 1);
    const w = Math.max(1, Math.round(spr.w * s));
    const h = Math.max(1, Math.round(spr.h * s));
    // Anchors mark where a prop MEETS THE GROUND, so sprites are bottom-centred.
    blitScaled(r, spr, Math.round(a.x - w / 2), Math.round(a.y - h), w, h, false);
  }

  // Sidewalk, then road — drawn last so nothing spills onto them.
  scenery();
  const walk = S.get('sidewalk');
  const walkH = L.roadTop - L.walkTop;
  if (walk) tileStrip(r, walk, L.walkTop, walkH);
  else fill(r, L.walkTop, L.roadTop, PALETTE.concrete_weathered[2] as Rgb);

  const road = S.get('road');
  if (road) tile(r, road, L.roadTop, L.h, L.scale);
  else fill(r, L.roadTop, L.h, PALETTE.asphalt[0] as Rgb);

  return { raster: r, objects, byKey, layout: L };
}

export { WALK_NATIVE_H };
