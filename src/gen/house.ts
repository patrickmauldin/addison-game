/**
 * TIER 2 — HOUSE KIT (generators 2.1 - 2.14)
 *
 * A house is an assembly of parameterised parts, never a picture. Both
 * reference photos are the same small kit with different arguments.
 *
 * Implemented this pass: 2.1 massing, 2.2 wall_panel, 2.3 material_band,
 * 2.4 roof_gable, 2.9 garage_door, 2.10 entry_door, 2.11 window, 2.12 porch,
 * 2.14 facade_details. Per the manifest's build order, hip roofs (2.5),
 * intersections (2.6), dormers (2.7), the portico arch (2.8) and chimneys
 * (2.13) are deferred until this much has been evaluated on screen.
 */

import {
  invFrontWall,
  invRightWall,
  invSlopedU,
  invSlopedV,
  iso,
} from '../core/projection.js';
import { PALETTE, type PaletteKey, ramps } from '../core/palette.js';
import type { Raster } from '../core/raster.js';
import { box, shade, slab } from '../core/solid.js';
import {
  frontInverse,
  glassShader,
  rightInverse,
  shingleShader,
  wallShader,
  type WallMaterial,
} from './materials.js';

export type HouseSpec = {
  stories: 1 | 2;
  /** Material band split height, in units. Stone below, siding above. */
  band_height: number;
  lower_mat: WallMaterial;
  upper_mat: WallMaterial;
  lower_key: PaletteKey;
  upper_key: PaletteKey;
  trim_key: PaletteKey;
  roof_key: PaletteKey;
  door_key: PaletteKey;
  garage_bays: 1 | 2;
  seed: number;
};

/** 2.1 massing — the volume table this kit renders. Garage wing forward. */
export function massing(spec: HouseSpec) {
  const eave = spec.stories === 2 ? 8.0 : 4.4; // 20 ft / 11 ft
  return {
    main: { u0: 2.0, u1: 11.5, v0: 2.0, v1: 12.0, eave },
    garage: { u0: 11.5, u1: 18.0, v0: 2.0, v1: 14.0, eave: 4.4 },
    OH: 0.45, // roof overhang, units
  };
}

/** 2.2 + 2.3 — a front-facing wall with the stone/siding material band. */
function wallFront(
  r: Raster,
  spec: HouseSpec,
  u0: number,
  u1: number,
  v: number,
  zTop: number,
): void {
  const inv = frontInverse(invFrontWall(v));
  const bh = Math.min(spec.band_height, zTop);
  if (bh > 0) {
    r.fillPoly(
      [iso(u0, v, bh), iso(u1, v, bh), iso(u1, v, 0), iso(u0, v, 0)],
      wallShader(spec.lower_mat, ramps(spec.lower_key), 1, inv, spec.seed),
    );
  }
  if (zTop > bh) {
    r.fillPoly(
      [iso(u0, v, zTop), iso(u1, v, zTop), iso(u1, v, bh), iso(u0, v, bh)],
      wallShader(spec.upper_mat, ramps(spec.upper_key), 1, inv, spec.seed + 3),
    );
    // The band cap — a trim course where the materials meet. Very Addison.
    r.fillPoly(
      [iso(u0, v, bh + 0.08), iso(u1, v, bh + 0.08), iso(u1, v, bh), iso(u0, v, bh)],
      ramps(spec.trim_key)[2],
    );
  }
}

/** 2.2 + 2.3 — a right-facing wall (the shaded side). */
function wallRight(
  r: Raster,
  spec: HouseSpec,
  u: number,
  v0: number,
  v1: number,
  zTop: number,
): void {
  const inv = rightInverse(invRightWall(u));
  const bh = Math.min(spec.band_height, zTop);
  if (bh > 0) {
    r.fillPoly(
      [iso(u, v0, bh), iso(u, v1, bh), iso(u, v1, 0), iso(u, v0, 0)],
      wallShader(spec.lower_mat, ramps(spec.lower_key), 0, inv, spec.seed),
    );
  }
  if (zTop > bh) {
    r.fillPoly(
      [iso(u, v0, zTop), iso(u, v1, zTop), iso(u, v1, bh), iso(u, v0, bh)],
      wallShader(spec.upper_mat, ramps(spec.upper_key), 0, inv, spec.seed + 3),
    );
    r.fillPoly(
      [iso(u, v0, bh + 0.08), iso(u, v1, bh + 0.08), iso(u, v1, bh), iso(u, v0, bh)],
      ramps(spec.trim_key)[1],
    );
  }
}

/** 2.11 window — punched opening with trim, sill, and raked glass. */
export function window_front(
  r: Raster,
  spec: HouseSpec,
  uc: number,
  v: number,
  zc: number,
  w: number,
  h: number,
  shutters = false,
): void {
  const t = ramps(spec.trim_key);
  const u0 = uc - w / 2;
  const u1 = uc + w / 2;
  const z0 = zc - h / 2;
  const z1 = zc + h / 2;
  const pad = 0.11;
  // Casing
  r.fillPoly([iso(u0 - pad, v, z1 + pad), iso(u1 + pad, v, z1 + pad), iso(u1 + pad, v, z0 - pad), iso(u0 - pad, v, z0 - pad)], t[2]);
  // Glass
  r.fillPoly(
    [iso(u0, v, z1), iso(u1, v, z1), iso(u1, v, z0), iso(u0, v, z0)],
    glassShader(ramps('glass'), frontInverse(invFrontWall(v))),
  );
  // Reveal shadow at the head — sells the punch depth.
  shade(r, [iso(u0, v, z1), iso(u1, v, z1), iso(u1, v, z1 - 0.12), iso(u0, v, z1 - 0.12)], 0.62);
  // Muntin
  r.fillPoly([iso(uc - 0.04, v, z1), iso(uc + 0.04, v, z1), iso(uc + 0.04, v, z0), iso(uc - 0.04, v, z0)], t[1]);
  // Sill
  r.fillPoly([iso(u0 - pad - 0.06, v, z0 - pad), iso(u1 + pad + 0.06, v, z0 - pad), iso(u1 + pad + 0.06, v, z0 - pad - 0.1), iso(u0 - pad - 0.06, v, z0 - pad - 0.1)], t[0]);
  if (shutters) {
    const sw = 0.28;
    for (const su of [u0 - pad - sw, u1 + pad]) {
      r.fillPoly([iso(su, v, z1 + pad), iso(su + sw, v, z1 + pad), iso(su + sw, v, z0 - pad), iso(su, v, z0 - pad)], ramps('bronze_dark')[1]);
    }
  }
}

/** 2.9 garage_door — the largest single element on most Addison facades. */
export function garage_door(
  r: Raster,
  spec: HouseSpec,
  u0: number,
  u1: number,
  v: number,
  h: number,
): void {
  const t = ramps(spec.trim_key);
  const inv = frontInverse(invFrontWall(v));
  // Opening, slightly recessed behind the wall plane.
  r.fillPoly([iso(u0, v, h), iso(u1, v, h), iso(u1, v, 0), iso(u0, v, 0)], (x, y) => {
    const { height } = inv(x, y);
    const f = height / 0.45 - Math.floor(height / 0.45);
    return f < 0.1 ? t[0] : f > 0.78 ? t[2] : t[1];
  });
  // Head casing
  r.fillPoly([iso(u0 - 0.12, v, h + 0.18), iso(u1 + 0.12, v, h + 0.18), iso(u1 + 0.12, v, h), iso(u0 - 0.12, v, h)], t[2]);
  // Jamb shadows
  shade(r, [iso(u0, v, h), iso(u0 + 0.1, v, h), iso(u0 + 0.1, v, 0), iso(u0, v, 0)], 0.72);
  shade(r, [iso(u1 - 0.1, v, h), iso(u1, v, h), iso(u1, v, 0), iso(u1 - 0.1, v, 0)], 0.72);
  if (spec.garage_bays === 2) {
    // Split into two bays with a center post.
    const uc = (u0 + u1) / 2;
    r.fillPoly([iso(uc - 0.14, v, h), iso(uc + 0.14, v, h), iso(uc + 0.14, v, 0), iso(uc - 0.14, v, 0)], t[2]);
  }
}

/** 2.10 entry_door */
export function entry_door(r: Raster, spec: HouseSpec, uc: number, v: number, h = 2.7): void {
  const t = ramps(spec.trim_key);
  const d = ramps(spec.door_key);
  const w = 0.95;
  r.fillPoly([iso(uc - w / 2 - 0.12, v, h + 0.14), iso(uc + w / 2 + 0.12, v, h + 0.14), iso(uc + w / 2 + 0.12, v, 0), iso(uc - w / 2 - 0.12, v, 0)], t[2]);
  r.fillPoly([iso(uc - w / 2, v, h), iso(uc + w / 2, v, h), iso(uc + w / 2, v, 0), iso(uc - w / 2, v, 0)], d[1]);
  // Two recessed panels.
  for (const [a, b] of [[0.35, 1.15], [1.45, 2.45]]) {
    shade(r, [iso(uc - w / 2 + 0.16, v, b), iso(uc + w / 2 - 0.16, v, b), iso(uc + w / 2 - 0.16, v, a), iso(uc - w / 2 + 0.16, v, a)], 0.82);
  }
  // Knob
  r.fillPoly([iso(uc + w / 2 - 0.26, v, 1.35), iso(uc + w / 2 - 0.16, v, 1.35), iso(uc + w / 2 - 0.16, v, 1.25), iso(uc + w / 2 - 0.26, v, 1.25)], PALETTE.bronze_dark[2]);
}

/** 2.12 porch — stoop, posts, and a shed cover. */
export function porch(r: Raster, spec: HouseSpec, u0: number, u1: number, v: number, depth: number): void {
  const t = ramps(spec.trim_key);
  const st = ramps(spec.lower_key);
  // Slab + step
  box(r, u0, v, u1, v + depth, 0, 0.18, spec.lower_key, { top: st[2], front: st[1], right: st[0] });
  box(r, u0 + 0.2, v + depth, u1 - 0.2, v + depth + 0.35, 0, 0.09, spec.lower_key, { top: st[2], front: st[1], right: st[0] });
  // Posts
  for (const pu of [u0 + 0.25, u1 - 0.45]) {
    box(r, pu, v + depth - 0.45, pu + 0.2, v + depth - 0.25, 0.18, 3.1, spec.trim_key, { top: t[2], front: t[1], right: t[0] });
  }
  // Shed cover
  const rr = ramps(spec.roof_key);
  r.fillPoly(
    [iso(u0 - 0.3, v, 3.5), iso(u1 + 0.3, v, 3.5), iso(u1 + 0.3, v + depth + 0.1, 3.1), iso(u0 - 0.3, v + depth + 0.1, 3.1)],
    rr[1],
  );
  r.fillPoly(
    [iso(u0 - 0.3, v + depth + 0.1, 3.1), iso(u1 + 0.3, v + depth + 0.1, 3.1), iso(u1 + 0.3, v + depth + 0.1, 2.98), iso(u0 - 0.3, v + depth + 0.1, 2.98)],
    t[2],
  );
}

/**
 * 2.4 roof_gable — ridge along u (eaves face front/back) or along v
 * (a front-facing gable). Only the sun-facing / camera-facing planes are
 * emitted; the back slopes are never visible from a fixed camera.
 */
export function roof_gable(
  r: Raster,
  spec: HouseSpec,
  m: { u0: number; u1: number; v0: number; v1: number; eave: number },
  ridgeAxis: 'u' | 'v',
  pitch: number,
  OH: number,
): { ridgeZ: number } {
  const rr = ramps(spec.roof_key);
  const t = ramps(spec.trim_key);

  if (ridgeAxis === 'u') {
    const vMid = (m.v0 + m.v1) / 2;
    const rise = ((m.v1 - m.v0) / 2) * pitch;
    const ridgeZ = m.eave + rise;
    const vEave = m.v1 + OH;
    const b = (m.eave - ridgeZ) / (vEave - vMid);
    const a = ridgeZ - b * vMid;
    // Front slope (faces +v, toward the sun) — BASE tone.
    r.fillPoly(
      [iso(m.u0 - OH, vMid, ridgeZ), iso(m.u1 + OH, vMid, ridgeZ), iso(m.u1 + OH, vEave, m.eave), iso(m.u0 - OH, vEave, m.eave)],
      shingleShader(rr, 1, invSlopedV(a, b), 'v', spec.seed),
    );
    // Fascia board along the eave.
    r.fillPoly(
      [iso(m.u0 - OH, vEave, m.eave), iso(m.u1 + OH, vEave, m.eave), iso(m.u1 + OH, vEave, m.eave - 0.16), iso(m.u0 - OH, vEave, m.eave - 0.16)],
      t[2],
    );
    // Ridge cap.
    r.fillPoly(
      [iso(m.u0 - OH, vMid, ridgeZ), iso(m.u1 + OH, vMid, ridgeZ), iso(m.u1 + OH, vMid + 0.16, ridgeZ - 0.07), iso(m.u0 - OH, vMid + 0.16, ridgeZ - 0.07)],
      rr[2],
    );
    return { ridgeZ };
  }

  // ridgeAxis === 'v' — front-facing gable.
  const uMid = (m.u0 + m.u1) / 2;
  const rise = ((m.u1 - m.u0) / 2) * pitch;
  const ridgeZ = m.eave + rise;
  const uEave = m.u1 + OH;
  const b = (m.eave - ridgeZ) / (uEave - uMid);
  const a = ridgeZ - b * uMid;

  // Gable end wall triangle at v1, in the upper material.
  const invG = frontInverse(invFrontWall(m.v1));
  r.fillPoly(
    [iso(m.u0, m.v1, m.eave), iso(uMid, m.v1, ridgeZ), iso(m.u1, m.v1, m.eave)],
    wallShader(spec.upper_mat, ramps(spec.upper_key), 1, invG, spec.seed + 3),
  );
  // Gable vent — the arched louver from reference image 2, squared off.
  r.fillPoly(
    [iso(uMid - 0.4, m.v1, ridgeZ - 0.55), iso(uMid + 0.4, m.v1, ridgeZ - 0.55), iso(uMid + 0.4, m.v1, ridgeZ - 1.15), iso(uMid - 0.4, m.v1, ridgeZ - 1.15)],
    t[2],
  );
  r.fillPoly(
    [iso(uMid - 0.3, m.v1, ridgeZ - 0.62), iso(uMid + 0.3, m.v1, ridgeZ - 0.62), iso(uMid + 0.3, m.v1, ridgeZ - 1.08), iso(uMid - 0.3, m.v1, ridgeZ - 1.08)],
    ramps('bronze_dark')[0],
  );

  // Right slope (faces +u, away from sun) — SHADE tone.
  r.fillPoly(
    [iso(uMid, m.v0 - OH, ridgeZ), iso(uMid, m.v1 + OH, ridgeZ), iso(uEave, m.v1 + OH, m.eave), iso(uEave, m.v0 - OH, m.eave)],
    shingleShader(rr, 0, invSlopedU(a, b), 'u', spec.seed + 9),
  );
  // Rake board down the front edge of the gable.
  r.fillPoly(
    [iso(m.u0 - OH, m.v1 + OH, m.eave), iso(uMid, m.v1 + OH, ridgeZ), iso(uMid, m.v1 + OH, ridgeZ - 0.18), iso(m.u0 - OH, m.v1 + OH, m.eave - 0.18)],
    t[2],
  );
  r.fillPoly(
    [iso(uMid, m.v1 + OH, ridgeZ), iso(uEave, m.v1 + OH, m.eave), iso(uEave, m.v1 + OH, m.eave - 0.18), iso(uMid, m.v1 + OH, ridgeZ - 0.18)],
    t[1],
  );
  return { ridgeZ };
}

/** 2.14 facade_details — gutters, downspouts, lantern, address numbers. */
export function facade_details(
  r: Raster,
  spec: HouseSpec,
  m: ReturnType<typeof massing>,
): void {
  const t = ramps(spec.trim_key);
  const br = ramps('bronze_dark');
  // Downspout at the main mass's right corner.
  r.fillPoly(
    [iso(m.main.u1 - 0.14, m.main.v1, m.main.eave), iso(m.main.u1, m.main.v1, m.main.eave), iso(m.main.u1, m.main.v1, 0), iso(m.main.u1 - 0.14, m.main.v1, 0)],
    t[0],
  );
  // Coach lantern beside the garage.
  const lu = m.garage.u0 + 0.35;
  r.fillPoly([iso(lu, m.garage.v1, 2.9), iso(lu + 0.16, m.garage.v1, 2.9), iso(lu + 0.16, m.garage.v1, 2.5), iso(lu, m.garage.v1, 2.5)], br[1]);
  r.fillPoly([iso(lu + 0.02, m.garage.v1, 2.84), iso(lu + 0.14, m.garage.v1, 2.84), iso(lu + 0.14, m.garage.v1, 2.6), iso(lu + 0.02, m.garage.v1, 2.6)], PALETTE.ornamental_tan[2]);
  // Address numbers — four little bronze ticks. Never legible, always read as numbers.
  for (let i = 0; i < 4; i++) {
    const nu = m.garage.u0 + 0.9 + i * 0.22;
    r.fillPoly([iso(nu, m.garage.v1, 3.3), iso(nu + 0.1, m.garage.v1, 3.3), iso(nu + 0.1, m.garage.v1, 3.05), iso(nu, m.garage.v1, 3.05)], br[2]);
  }
}

/** Compose the whole house. Painter's order: main mass, then the nearer wing. */
export function drawHouse(r: Raster, spec: HouseSpec): ReturnType<typeof massing> {
  const m = massing(spec);
  const { main, garage, OH } = m;

  // --- Main mass -------------------------------------------------------
  wallRight(r, spec, main.u1, main.v0, main.v1, main.eave);
  wallFront(r, spec, main.u0, main.u1, main.v1, main.eave);
  roof_gable(r, spec, main, 'u', 0.52, OH);

  // Openings on the main mass front wall.
  window_front(r, spec, 4.0, main.v1, 2.3, 1.5, 1.9, true);
  window_front(r, spec, 7.2, main.v1, 2.3, 1.1, 1.9, true);
  entry_door(r, spec, 9.6, main.v1);
  porch(r, spec, 8.6, 10.7, main.v1, 1.0);

  // --- Garage wing (nearer the street, so it draws over the main mass) --
  wallRight(r, spec, garage.u1, garage.v0, garage.v1, garage.eave);
  wallFront(r, spec, garage.u0, garage.u1, garage.v1, garage.eave);
  roof_gable(r, spec, garage, 'v', 0.62, OH);
  garage_door(r, spec, garage.u0 + 0.7, garage.u1 - 0.7, garage.v1, 3.3);

  facade_details(r, spec, m);
  return m;
}
