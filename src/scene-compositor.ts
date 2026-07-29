/**
 * THREE-QUARTER COMPOSITOR.
 *
 * Replaces the isometric compositor. A lot is still data; what changed is that
 * the world is no longer a diamond. Grass is a background pattern that fills
 * the frame, the road is a band across the bottom, and everything else sits on
 * top in plain screen coordinates.
 *
 * Draw order is simply top-to-bottom by screen y — a thing lower on screen is
 * nearer the camera. That single rule replaces the whole isometric u+v depth
 * key, the anchor grid, and the face-tone bookkeeping.
 *
 * The id buffer survives unchanged: every flaggable object declares an id
 * before it draws, and a click resolves in O(1) with no geometry.
 */

import { BAND, CANVAS_H, CANVAS_W, anchor } from './core/scene.js';
import { PALETTE, type Rgb } from './core/palette.js';
import { fbm, mulberry32, valueNoise, Raster } from './core/raster.js';
import { drawGround, type Tiles } from './gen/ground.js';
import type { Bitmap } from './core/png.js';

export type PropSpec = {
  id: string;
  gen: string;
  anchor: string;
  label: string;
  params?: Record<string, any>;
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
};

export type SceneAssets = {
  tiles: Tiles;
  /** House sprites by id, decoded. Empty until art lands. */
  houses?: Map<string, Bitmap>;
};

// --- Props, in screen space ------------------------------------------------
// Only the R-101 pair is procedural. These two must stay generated rather than
// authored: the whole point is that a weed patch and a native bed differ by
// containment and spacing, and a content author has to be able to vary density
// and spread per lot without commissioning a new sprite each time.

/** Irregular blob outline in screen space. */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, wobble: number) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const k = 1 - wobble / 2 + valueNoise(Math.cos(a) * 3, Math.sin(a) * 3, 1, seed) * wobble;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/**
 * R-101 VIOLATION. A ragged mat with a dissolving edge — nothing contains it.
 * Reads as a colour mass against the grass tile, not as scattered blades.
 */
function weedPatch(r: Raster, cx: number, cy: number, density: 1 | 2 | 3, spread: number, seed: number) {
  const w = PALETTE.weed_green;
  const rx = spread;
  const ry = spread * 0.62; // foreshortened: ground recedes up the screen
  const cover = [0.5, 0.7, 0.88][density - 1];
  const poly = blob(cx, cy, rx, ry, seed, 0.6);
  r.fillPoly(poly.map(([x, y]) => ({ x, y })), (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const rim = Math.sqrt(dx * dx + dy * dy);
    if (fbm(x, y, 4.2, seed) > cover * (1.25 - rim * 0.85)) return null;
    const g = valueNoise(x, y, 1.8, seed + 3);
    return g > 0.78 ? w[2] : g > 0.3 ? w[1] : w[0];
  });
  const rnd = mulberry32(seed + 77);
  for (let i = 0; i < [4, 7, 11][density - 1]; i++) {
    const a = rnd() * Math.PI * 2;
    const k = 0.5 + rnd() * 0.5;
    const bx = cx + Math.cos(a) * rx * k;
    const by = cy + Math.sin(a) * ry * k;
    for (let j = 0; j < 3; j++)
      r.line(bx + (rnd() - 0.5) * 3, by, bx + (rnd() - 0.5) * 3, by - 2 - rnd() * 3, w[rnd() > 0.5 ? 2 : 1]);
  }
}

/**
 * The LEGAL look-alike. Same green family, but bordered, mulched and planted on
 * visible spacing. Intentionality is the whole tell.
 */
function nativeBed(r: Raster, cx: number, cy: number, spread: number, seed: number) {
  const rx = spread;
  const ry = spread * 0.62;
  const poly = blob(cx, cy, rx, ry, seed, 0.18).map(([x, y]) => ({ x, y }));
  // Decomposed-granite field.
  r.fillPoly(poly, (x, y) => {
    const n = fbm(x, y, 3.2, seed);
    const dg = PALETTE.decomposed_granite;
    return n > 0.62 ? dg[2] : n > 0.4 ? dg[1] : dg[0];
  });
  // Hard stone border — the single most important difference from the weeds.
  const st = PALETTE.limestone_tan;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    r.line(a.x, a.y, b.x, b.y, st[2]);
    r.line(a.x, a.y + 1, b.x, b.y + 1, st[0]);
  }
  // Plants on deliberate spacing.
  const rnd = mulberry32(seed + 5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const px = cx + Math.cos(a) * rx * 0.55;
    const py = cy + Math.sin(a) * ry * 0.55;
    const agave = i % 2 === 0;
    const ramp = agave ? PALETTE.agave_blue : PALETTE.ornamental_tan;
    for (let k = 0; k < (agave ? 9 : 14); k++) {
      const ang = agave ? (k / 9) * Math.PI * 2 : -Math.PI / 2 + (rnd() - 0.5) * 1.5;
      const len = (agave ? 7 : 9) * (0.7 + rnd() * 0.4);
      r.line(px, py, px + Math.cos(ang) * len, py + Math.sin(ang) * len * 0.75,
        ramp[Math.cos(ang) < -0.2 ? 2 : 1]);
    }
  }
}

const GENERATORS: Record<string, (r: Raster, x: number, y: number, p: any, s: number) => void> = {
  weed_patch: (r, x, y, p, s) => weedPatch(r, x, y, (p.density ?? 2) as 1 | 2 | 3, p.spread ?? 34, s),
  native_bed: (r, x, y, p, s) => nativeBed(r, x, y, p.spread ?? 34, s),
};

/** Placeholder for a house sprite that has not been authored yet. */
function housePlaceholder(r: Raster): void {
  const x0 = Math.round(CANVAS_W * 0.08);
  const x1 = Math.round(CANVAS_W * 0.92);
  const c = PALETTE.concrete_weathered;
  for (let y = BAND.houseTop; y < BAND.houseBase; y++)
    for (let x = x0; x < x1; x++) {
      const edge = x < x0 + 2 || x >= x1 - 2 || y < BAND.houseTop + 2 || y >= BAND.houseBase - 2;
      // Hatched, so it can never be mistaken for finished art in a screenshot.
      const hatch = ((x + y) % 12) < 2;
      r.px(x, y, edge ? c[0] : hatch ? c[1] : c[2]);
    }
}

export function renderLot(spec: LotSpec, assets: SceneAssets): RenderedLot {
  const r = new Raster(CANVAS_W, CANVAS_H);
  const objects: RenderedObject[] = [];
  const byKey = new Map<number, RenderedObject>();
  let nextKey = 1;
  const begin = (o: Omit<RenderedObject, 'key'>) => {
    const rec = { ...o, key: nextKey++ };
    objects.push(rec); byKey.set(rec.key, rec); r.setObject(rec.key);
  };
  const scenery = () => r.setObject(0);

  scenery();
  drawGround(r, assets.tiles, {
    grass: PALETTE.healthy_green[1] as Rgb,
    road: PALETTE.asphalt[0] as Rgb,
    walk: PALETTE.concrete_weathered[2] as Rgb,
    curb: PALETTE.concrete_weathered[1] as Rgb,
  });

  // House. Sprite when available, hatched placeholder otherwise.
  const sprite = spec.house?.sprite ? assets.houses?.get(spec.house.sprite) : undefined;
  if (sprite) {
    const ox = Math.round((CANVAS_W - sprite.w) / 2);
    const oy = BAND.houseBase - sprite.h;
    for (let y = 0; y < sprite.h; y++)
      for (let x = 0; x < sprite.w; x++) {
        const s = (y * sprite.w + x) << 2;
        if (sprite.rgba[s + 3] < 128) continue;
        r.px(ox + x, oy + y, [sprite.rgba[s], sprite.rgba[s + 1], sprite.rgba[s + 2]]);
      }
  } else {
    housePlaceholder(r);
  }

  // Props, back to front. Depth is just screen y now.
  const props = [...spec.props].sort((a, b) => anchor(a.anchor).y - anchor(b.anchor).y);
  for (const p of props) {
    const fn = GENERATORS[p.gen];
    if (!fn) throw new Error(`scene-compositor: unknown generator "${p.gen}"`);
    if (p.flaggable === false) scenery();
    else begin({ id: p.id, label: p.label, flaggable: true, first_seen: p.first_seen });
    const a = anchor(p.anchor);
    fn(r, a.x, a.y, p.params ?? {}, spec.seed + hashStr(p.id));
  }
  scenery();
  return { raster: r, objects, byKey };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
