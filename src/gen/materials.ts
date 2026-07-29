/**
 * Wall material shaders. These run in WALL-LOCAL coordinates (lateral units
 * along the wall, height units up) via the exact inverse projection, so a
 * brick course follows the wall plane instead of drifting across it.
 *
 * Every shader returns a tone from the supplied ramp. None of them invent a
 * color — that is the Tier 0 contract.
 */

import { type Ramp, type Rgb } from '../core/palette.js';
import { fbm, valueNoise, type Shader } from '../core/raster.js';

export type WallMaterial = 'stone' | 'brick' | 'board_batten' | 'lap' | 'stucco';

/** Maps a screen pixel to (lateral, height) in wall units. */
export type WallInverse = (x: number, y: number) => { lateral: number; height: number };

export function frontInverse(inv: (x: number, y: number) => { u: number; z: number }): WallInverse {
  return (x, y) => {
    const { u, z } = inv(x, y);
    return { lateral: u, height: z };
  };
}

export function rightInverse(inv: (x: number, y: number) => { v: number; z: number }): WallInverse {
  return (x, y) => {
    const { v, z } = inv(x, y);
    return { lateral: v, height: z };
  };
}

/**
 * `base` is the tone index this face would use flat (SHADE for right-facing,
 * BASE for front-facing). Materials modulate around it rather than replacing
 * it, so light direction survives the texture pass.
 */
export function wallShader(
  mat: WallMaterial,
  ramp: Ramp,
  base: 0 | 1 | 2,
  inv: WallInverse,
  seed: number,
): Shader {
  const lo = ramp[Math.max(0, base - 1) as 0 | 1 | 2];
  const mid = ramp[base];
  const hi = ramp[Math.min(2, base + 1) as 0 | 1 | 2];

  switch (mat) {
    case 'lap': {
      // Horizontal lap siding: 0.32-unit (8 in) courses with a shadow line
      // under each butt edge. The shadow line is the whole read.
      const COURSE = 0.32;
      return (x, y) => {
        const { height } = inv(x, y);
        const f = height / COURSE - Math.floor(height / COURSE);
        if (f < 0.14) return lo;
        return f > 0.72 ? hi : mid;
      };
    }

    case 'board_batten': {
      // Vertical boards with proud battens every 0.64 units (16 in on center).
      const PITCH = 0.64;
      return (x, y) => {
        const { lateral } = inv(x, y);
        const f = lateral / PITCH - Math.floor(lateral / PITCH);
        if (f < 0.1) return hi; // batten face, catching light
        if (f < 0.16) return lo; // batten shadow
        return mid;
      };
    }

    case 'brick': {
      // Running bond. 0.09-unit courses (~2.7 in incl. mortar), 0.22 long,
      // alternate rows offset by half a brick.
      const CH = 0.09;
      const CW = 0.22;
      return (x, y) => {
        const { lateral, height } = inv(x, y);
        const row = Math.floor(height / CH);
        const fy = height / CH - row;
        const off = row % 2 ? CW / 2 : 0;
        const fx = (lateral + off) / CW - Math.floor((lateral + off) / CW);
        if (fy < 0.16 || fx < 0.07) return lo; // mortar
        // Per-brick color jitter keeps it from banding.
        const j = valueNoise(Math.floor((lateral + off) / CW), row, 1, seed);
        return j > 0.62 ? hi : mid;
      };
    }

    case 'stone': {
      // Irregular limestone veneer. Blocky noise, dark joints. Austin default.
      return (x, y) => {
        const { lateral, height } = inv(x, y);
        const bx = Math.floor(lateral / 0.42);
        const by = Math.floor(height / 0.2);
        const jitter = valueNoise(bx, by, 1, seed) * 0.3;
        const fx = lateral / 0.42 - bx;
        const fy = height / 0.2 - by;
        if (fy < 0.14 || fx < 0.06 + jitter * 0.1) return lo; // joint
        const j = valueNoise(bx, by, 1, seed + 17);
        return j > 0.66 ? hi : j > 0.3 ? mid : lo;
      };
    }

    case 'stucco':
    default:
      return (x, y) => {
        const n = fbm(x, y, 3, seed);
        return n > 0.62 ? hi : n < 0.38 ? lo : mid;
      };
  }
}

/**
 * Asphalt shingle courses on a sloped roof plane. `inv` maps a pixel to grid
 * (u, v); `along` selects which axis runs down-slope.
 */
export function shingleShader(
  ramp: Ramp,
  base: 0 | 1 | 2,
  inv: (x: number, y: number) => { u: number; v: number },
  along: 'u' | 'v',
  seed: number,
): Shader {
  const lo = ramp[Math.max(0, base - 1) as 0 | 1 | 2];
  const mid = ramp[base];
  const hi = ramp[Math.min(2, base + 1) as 0 | 1 | 2];
  const COURSE = 0.42; // down-slope exposure
  const TAB = 0.55; // lateral tab width
  return (x, y) => {
    const g = inv(x, y);
    const down = along === 'v' ? g.v : g.u;
    const lat = along === 'v' ? g.u : g.v;
    const row = Math.floor(down / COURSE);
    const fy = down / COURSE - row;
    if (fy < 0.12) return lo; // butt shadow line
    const off = row % 2 ? TAB / 2 : 0;
    const fx = (lat + off) / TAB - Math.floor((lat + off) / TAB);
    if (fx < 0.05) return lo; // tab slot
    const j = valueNoise(Math.floor((lat + off) / TAB), row, 1, seed);
    return j > 0.7 ? hi : mid;
  };
}

/** Flat glass with a light rake, so windows read as glass and not holes. */
export function glassShader(ramp: Ramp, inv: WallInverse): Shader {
  return (x, y) => {
    const { lateral, height } = inv(x, y);
    // A diagonal highlight band across the pane.
    const d = lateral * 0.6 + height;
    const f = d - Math.floor(d);
    return (f > 0.42 && f < 0.62 ? ramp[2] : ramp[0]) as Rgb;
  };
}
