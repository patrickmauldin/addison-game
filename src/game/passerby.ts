/**
 * People on the sidewalk.
 *
 * Not residents: they are passing through. They walk one way along the walk,
 * leave the frame, and are gone — nobody turns round at the edge and comes
 * back, because a figure that bounces off an invisible wall reads as a bug even
 * when it is deliberate. So the street quietly empties while you inspect, which
 * is also what a street does.
 *
 * They hold nothing. Tools belong to people working on their own yard.
 */

import type { BarkState } from './barks.js';
import { pickCharacter } from './residents.js';
import type { Dir } from './walker.js';

export type Passerby = {
  /** Index into the same ten-character roster the residents come from. */
  character: number;
  x: number;
  /** Feet y — somewhere in the sidewalk band. */
  y: number;
  /** 1 W or 2 E, matching Walker's Dir; the sheet rows are shared. */
  dir: Dir;
  /** Signed pixels per second. */
  vx: number;
  /** Seconds walked, for cutting the animation cycle. */
  t: number;
  /** Their turn-taking clock, or null if this one is not the talkative sort. */
  bark?: BarkState | null;
};

/** How far past the edge somebody may spawn, or must reach to be gone. */
const OFFSCREEN = 0.2;

export type Sidewalk = { w: number; top: number; bottom: number };

/**
 * 0-2 of them, seeded from the lot so a given address is consistent.
 *
 * Direction follows from where they start — left half walks right, right half
 * walks left — so everybody crosses most of the frame rather than spawning one
 * step from the edge they were heading for and vanishing unseen.
 *
 * Characters come from pickCharacter, so the skin mix is respected, and nobody
 * already on the lot can come round again — two identical strangers passing each
 * other on the same pavement reads as a rendering fault, not a coincidence.
 */
export function makePassersby(
  walk: Sidewalk,
  rnd: () => number,
  count: number,
  taken: number[] = [],
): Passerby[] {
  const spoken = [...taken];
  const out: Passerby[] = [];
  for (let i = 0; i < count; i++) {
    const x = walk.w * (-OFFSCREEN + rnd() * (1 + OFFSCREEN * 2));
    const right = x < walk.w / 2;
    // Weighted, and never anyone already on this lot.
    const pick = pickCharacter(rnd, spoken);
    spoken.push(pick);
    out.push({
      character: pick,
      x,
      // Spread across the depth of the walk so two of them do not overlap
      // exactly, and so the nearer one passes in front.
      y: walk.top + (walk.bottom - walk.top) * (0.35 + rnd() * 0.5),
      dir: right ? 2 : 1,
      // A little spread in pace. Everyone walking in lockstep looks staged.
      vx: (right ? 1 : -1) * walk.w * (0.055 + rnd() * 0.03),
      t: rnd() * 2,
    });
  }
  return out;
}

/**
 * Move everyone onto a new layout, keeping how far across they are.
 *
 * Used on resize instead of respawning: whoever has already walked off has
 * walked off for good, and rebuilding from the seed would march them back on.
 */
export function remapPassersby(list: Passerby[], from: Sidewalk, to: Sidewalk): Passerby[] {
  const kx = to.w / Math.max(1, from.w);
  const depth = Math.max(1, from.bottom - from.top);
  return list.map((p) => ({
    ...p,
    x: p.x * kx,
    y: to.top + ((p.y - from.top) / depth) * (to.bottom - to.top),
    vx: p.vx * kx,
  }));
}

/** Advance, and drop anyone who has walked off. Returns the survivors. */
export function stepPassersby(list: Passerby[], dt: number, walk: Sidewalk): Passerby[] {
  const margin = walk.w * OFFSCREEN;
  const out: Passerby[] = [];
  for (const p of list) {
    p.t += dt;
    p.x += p.vx * dt;
    if (p.x > -margin && p.x < walk.w + margin) out.push(p);
  }
  return out;
}
