/**
 * THE COMPOSITOR.
 *
 * A lot is data. This turns that data into pixels and into a click-resolvable
 * object table. Code contains zero content — every address, prop, and ground
 * truth lives in JSON.
 *
 * Layer stack, bottom to top (manifest section 10):
 *   0  ground plane          5  permanent landscaping
 *   1  driveway/walk/curb    6  fence
 *   2  house shell           7  props at anchors
 *   3  roof                  8  violation overlays
 *   4  trim/doors            9  critters/figures
 *                           10  time-of-day tint
 *
 * Layers 2-4 are emitted together by drawHouse because the house kit resolves
 * its own internal painter order; splitting them would mean re-deriving
 * occlusion at the compositor level for no gain.
 */

import { CANVAS_H, CANVAS_W, BAND, LOT_W } from './core/projection.js';
import { PALETTE, type PaletteKey } from './core/palette.js';
import { Raster } from './core/raster.js';
import * as T from './gen/terrain.js';
import * as V from './gen/vegetation.js';
import * as S from './gen/site.js';
import * as P from './gen/props.js';
import { drawHouse, type HouseSpec } from './gen/house.js';
import { drawHouseSprite, type PaintSpec, type SpriteRegistry } from './gen/sprite.js';
import type { WallMaterial } from './gen/materials.js';

// --- Anchors --------------------------------------------------------------
// A prop knows how to sit at CURB_1 on any lot. This is what makes content
// authoring cheap: props reference names, never coordinates.

export const ANCHORS: Record<string, [number, number]> = {
  DRIVEWAY_1: [14.7, 12.6], // at the garage door
  DRIVEWAY_2: [14.7, 17.0], // mid-drive
  DRIVEWAY_3: [14.7, 21.4], // near the walk
  APRON: [14.7, 24.9],
  YARD_1: [4.0, 15.6],
  YARD_2: [7.4, 17.4],
  YARD_3: [4.6, 20.2],
  YARD_4: [9.2, 20.6],
  YARD_5: [2.8, 13.6],
  YARD_6: [10.6, 15.2],
  CURB_1: [5.0, 24.5],
  CURB_2: [7.4, 24.5],
  PORCH_1: [8.3, 13.4],
  PORCH_2: [10.9, 13.4],
  GARAGE_SIDE: [17.2, 13.2],
  AC_PAD: [17.9, 10.6],
  BED_FRONT: [6.0, 13.2],
  /** On the front walk, where a control joint would be. */
  WALK_JOINT: [8.25, 18.6],
};

export function anchor(name: string): [number, number] {
  const a = ANCHORS[name];
  if (!a) throw new Error(`compositor: unknown anchor "${name}"`);
  return a;
}

// --- Lot data shape -------------------------------------------------------

export type PropSpec = {
  /** Stable id, referenced by truth.violations and by the case file. */
  id: string;
  gen: string;
  anchor: string;
  /** Human-readable name shown by the loupe and in the finding list. */
  label: string;
  params?: Record<string, unknown>;
  /** ISO date this object was first observed on the lot. Drives grace periods. */
  first_seen?: string;
  /** Whether the player can flag it. Scenery is false. */
  flaggable?: boolean;
};

export type LotSpec = {
  lot_id: string;
  address: string;
  street: string;
  /**
   * The shell carries BOTH a sprite reference and generator parameters.
   *
   * If `sprite` names a registered sprite it wins; otherwise the generator
   * renders a placeholder. That is deliberate: it means all twenty days of
   * content can be authored, validated and playtested against generated houses
   * and then have real art swapped in one shell at a time, without touching a
   * single lot file or blocking content on the art pipeline.
   */
  shell: {
    /** Sprite id, resolved against the registry passed to renderLot. */
    sprite?: string;
    /** Ramp swaps applied to the sprite — this is the R-308 paint mechanic. */
    paint?: PaintSpec;
    /** True once a house-level rule (R-308 paint) is live, making it clickable. */
    flaggable?: boolean;

    // Placeholder generator parameters. Ignored when a sprite resolves.
    stories: 1 | 2;
    lower_mat: WallMaterial;
    upper_mat: WallMaterial;
    lower_key: PaletteKey;
    upper_key: PaletteKey;
    trim_key: PaletteKey;
    roof_key: PaletteKey;
    door_key: PaletteKey;
    band_height: number;
    garage_bays: 1 | 2;
  };
  turf: { yard: T.TurfState; parkway: T.TurfState };
  driveway_stain: 'clean' | 'weathered' | 'oil_stained';
  sidewalk: 'clean' | 'cracked' | 'heaved';
  fence: { condition: S.FenceCondition; stain: PaletteKey } | null;
  landscaping: Array<{ gen: string; anchor: string; params?: Record<string, unknown> }>;
  props: PropSpec[];
  truth: {
    violations: Array<{ object: string; article: string; why: string }>;
    decoys: Array<{ object: string; why: string }>;
  };
  expected_verdict: 'PASS' | 'FAIL' | 'NOTICE' | 'CITATION';
  notes_for_designer: string;
  seed: number;
};

export type RenderedObject = {
  id: string;
  label: string;
  /** Object-id integer written into the raster's id buffer. */
  key: number;
  flaggable: boolean;
  first_seen?: string;
};

export type RenderedLot = {
  raster: Raster;
  objects: RenderedObject[];
  byKey: Map<number, RenderedObject>;
};

// --- Generator dispatch ---------------------------------------------------
// Adding a generator means adding a row here. Nothing else in the codebase
// needs to know it exists.

type GenFn = (r: Raster, u: number, v: number, params: Record<string, any>, seed: number) => void;

const GENERATORS: Record<string, GenFn> = {
  live_oak: (r, u, v, p, s) => V.live_oak(r, u, v, (p.size ?? 2) as 1 | 2 | 3, s),
  deciduous_tree: (r, u, v, p, s) =>
    V.deciduous_tree(r, u, v, (p.size ?? 2) as 1 | 2 | 3, p.state ?? 'bare', s),
  crepe_myrtle: (r, u, v, p, s) => V.crepe_myrtle(r, u, v, !!p.bloom, s),
  young_tree_staked: (r, u, v, _p, s) => V.young_tree_staked(r, u, v, s),
  shrub_row: (r, u, v, p, s) => V.shrub_row(r, u, u + (p.run ?? 3), v, p.trim ?? 'trimmed', s),
  ornamental_grass: (r, u, v, p, s) => V.ornamental_grass(r, u, v, (p.size ?? 1) as 1 | 2, s),
  agave_yucca: (r, u, v, p, s) => V.agave_yucca(r, u, v, (p.size ?? 1) as 1 | 2, s),
  weed_patch: (r, u, v, p, s) =>
    V.weed_patch(r, u, v, (p.density ?? 2) as 1 | 2 | 3, p.spread ?? 1.6, s),
  crack_weeds: (r, u, v, p, s) => V.crack_weeds(r, u, u + (p.run ?? 2), v, s, p.joints ?? 3),
  waste_bin: (r, u, v, p) => P.waste_bin(r, u, v, p.type ?? 'trash', !!p.lid_open),
  junk_pile: (r, u, v, p, s) => P.junk_pile(r, u, v, (p.volume ?? 2) as 1 | 2 | 3, s),
  kids_clutter: (r, u, v, _p, s) => P.kids_clutter(r, u, v, s),
  ac_condenser: (r, u, v) => S.ac_condenser(r, u, v),

  /**
   * The decoy. It draws its own bed (1.8) and then plants it (4.9), because a
   * native bed without its border is just a weed patch — they must never be
   * separable in data, or a content author can accidentally author an unfair lot.
   */
  native_bed: (r, u, v, p, s) => {
    const rad = p.spread ?? 2.2;
    const poly: Array<[number, number]> = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      poly.push([u + Math.cos(a) * rad, v + Math.sin(a) * rad * 0.8]);
    }
    T.landscape_bed(r, poly, p.edging ?? 'stone', p.fill ?? 'dg', s);
    V.native_bed_planting(r, poly, s);
  },
};

// --- Render ---------------------------------------------------------------

export function renderLot(spec: LotSpec, sprites?: SpriteRegistry): RenderedLot {
  const r = new Raster(CANVAS_W, CANVAS_H);
  const objects: RenderedObject[] = [];
  const byKey = new Map<number, RenderedObject>();
  let nextKey = 1;

  const begin = (o: Omit<RenderedObject, 'key'>): void => {
    const rec: RenderedObject = { ...o, key: nextKey++ };
    objects.push(rec);
    byKey.set(rec.key, rec);
    r.setObject(rec.key);
  };
  const scenery = () => r.setObject(0);

  // Sky / backdrop. Never visible except at the extreme frame corners, but a
  // hard clear keeps the id buffer honest.
  r.clear(PALETTE.glass[0]);

  // --- Layer 0: ground ---------------------------------------------------
  scenery();
  T.ground_plane(r, spec.turf.yard, spec.seed);
  T.rear_treeline(r, spec.seed);
  T.parkway_strip(r, spec.turf.parkway, spec.seed);

  // --- Layer 1: hard surfaces -------------------------------------------
  T.street(r, true);
  const dwU0 = 12.0;
  const dwU1 = 17.4;
  T.curb(r, dwU0 - 1.4, dwU1 + 1.4);
  T.sidewalk(r, spec.sidewalk, spec.seed);
  T.driveway(r, dwU0, dwU1, spec.driveway_stain, spec.seed);
  T.front_walk(r, 9.6, 8.2, 'straight');
  T.site_utilities(r, spec.seed);

  // --- Neighbours, drawn before the hero house so it reads as a street ---
  T.neighbor_slab(r, 'L', 'taupe', 'weathered_gray');
  T.neighbor_slab(r, 'R', 'gray', 'roof_brown');

  // --- Layer 6: fence (behind the house mass at these v values) ---------
  if (spec.fence) {
    S.privacy_fence(r, LOT_W - 1.2, 2.0, 13.0, spec.fence.stain, spec.fence.condition, spec.seed + 5);
    S.privacy_fence(r, 1.2, 2.0, 11.0, spec.fence.stain, spec.fence.condition, spec.seed + 6);
  }

  // --- Layers 2-4: house -------------------------------------------------
  // A sprite wins if one is registered; otherwise the generator stands in.
  // The house is scenery unless a house-level rule is live this day — flagging
  // a clean house has to stay possible-but-wrong, not impossible.
  const sprite = spec.shell.sprite ? sprites?.get(spec.shell.sprite) : undefined;
  if (spec.shell.flaggable) {
    begin({ id: 'house', label: `Exterior — ${spec.address}`, flaggable: true });
  } else {
    scenery();
  }
  if (sprite) {
    drawHouseSprite(r, sprite, spec.shell.paint);
  } else {
    const houseSpec: HouseSpec = { ...spec.shell, seed: spec.seed };
    drawHouse(r, houseSpec);
  }
  scenery();

  // --- Layer 5: permanent landscaping ------------------------------------
  // Sorted back-to-front so canopies overlap correctly.
  const land = [...spec.landscaping].sort((a, b) => {
    const [au, av] = anchor(a.anchor);
    const [bu, bv] = anchor(b.anchor);
    return au + av - (bu + bv);
  });
  for (const l of land) {
    scenery();
    const [u, v] = anchor(l.anchor);
    const fn = GENERATORS[l.gen];
    if (!fn) throw new Error(`compositor: unknown generator "${l.gen}"`);
    fn(r, u, v, l.params ?? {}, spec.seed + hashStr(l.gen + l.anchor));
  }

  // --- Layers 7-8: props and violation overlays --------------------------
  const props = [...spec.props].sort((a, b) => {
    const [au, av] = anchor(a.anchor);
    const [bu, bv] = anchor(b.anchor);
    return au + av - (bu + bv);
  });
  for (const p of props) {
    const fn = GENERATORS[p.gen];
    if (!fn) throw new Error(`compositor: unknown generator "${p.gen}"`);
    if (p.flaggable === false) scenery();
    else begin({ id: p.id, label: p.label, flaggable: true, first_seen: p.first_seen });
    const [u, v] = anchor(p.anchor);
    fn(r, u, v, p.params ?? {}, spec.seed + hashStr(p.id));
  }

  scenery();
  S.mailbox(r, 10.4);

  return { raster: r, objects, byKey };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { BAND };
