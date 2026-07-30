/**
 * NPC barks — the thing a resident is thinking, in a bubble over their head.
 *
 * Two rules from the source doc drive the design:
 *
 *  1. Some barks LEAK INFORMATION. "It's dormant, not dead" flags the decoy;
 *     "the pod's leaving Thursday, it's been leaving Thursday for a month"
 *     tells you a permit window has blown. Those are tagged `tell` and weighted
 *     up on lots where they matter, which makes reading bubbles a real edge
 *     rather than decoration.
 *  2. No repeats within a day. A line you have already seen this session kills
 *     the effect faster than a badly written one.
 *
 * Nobody talks constantly. A speaker holds a thought for a few seconds, then
 * says nothing for a while, and may well never say anything at all — silence is
 * most of what this system outputs, and that is what keeps it from grating.
 */

import data from '../data/barks.json';

export type Tone = 'light' | 'neutral' | 'upset';
/**
 * Who is talking. `any` lines work in either mouth; the other two are exclusive.
 *
 * The split matters because the two speakers are reliable in opposite ways. A
 * homeowner leaks TRUTH by accident — "it's dormant, not dead" flags the decoy.
 * A passer-by states OPINION confidently and is sometimes simply wrong, and
 * "that needs mowing" fires on compliant lawns on purpose. A player who cites on
 * social pressure instead of measuring takes the strike and learns the thing the
 * game is actually about.
 */
export type Speaker = 'owner' | 'passer' | 'any';

type Line = {
  id: string;
  pool: string;
  tone: string;
  who: string;
  needs?: string[];
  tell?: boolean;
  /** Documentation only: this opinion may be flatly false. See Speaker. */
  wrong?: boolean;
  text: string;
};

const LINES = data.lines as Line[];
const WEIGHTS = data.weights as Record<string, number>;

/** What is true about this lot right now. Everything `needs` can gate on. */
export type BarkContext = {
  /** Prop-derived: weeds, bins, fence, junk, vehicle, violation. */
  facts: Set<string>;
};

/** How long a thought stays up, and how long before there might be another. */
export const HOLD_S = 6;
export const GAP_MIN_S = 8;
export const GAP_MAX_S = 14;
/** Chance of actually saying something when a gap elapses, rather than nothing. */
export const SPEAK_CHANCE = 0.55;

/**
 * Lines already used today, so nothing repeats within a session.
 *
 * Module-level rather than per-speaker: hearing the same joke from two
 * different people on the same street is worse than hearing it twice from one.
 */
const usedToday = new Set<string>();

export function resetBarkHistory(): void {
  usedToday.clear();
}

function eligible(l: Line, who: Speaker, ctx: BarkContext): boolean {
  if (usedToday.has(l.id)) return false;
  // A stranger cannot refer to their own fence or a citation against them; a
  // homeowner standing in their own yard cannot be walking past it.
  if (l.who !== 'any' && l.who !== who) return false;
  for (const n of l.needs ?? []) if (!ctx.facts.has(n)) return false;
  return true;
}

/**
 * Pick a line, or null if this speaker has nothing to say.
 *
 * Weighted by pool rather than uniformly over lines, so a pool with forty
 * entries does not drown out one with four. `tell` lines get a thumb on the
 * scale — they are the ones worth reading.
 */
export function pickBark(who: Speaker, ctx: BarkContext, rnd: () => number): string | null {
  const pool = LINES.filter((l) => eligible(l, who, ctx));
  if (!pool.length) return null;

  let total = 0;
  const weighted = pool.map((l) => {
    const w = (WEIGHTS[l.pool] ?? 5) * (l.tell ? 2 : 1);
    total += w;
    return { l, w };
  });

  let r = rnd() * total;
  for (const { l, w } of weighted) {
    r -= w;
    if (r <= 0) {
      usedToday.add(l.id);
      return l.text;
    }
  }
  const last = weighted[weighted.length - 1].l;
  usedToday.add(last.id);
  return last.text;
}

/**
 * A speaker's turn-taking clock.
 *
 * Holds a line for HOLD_S, then goes quiet for a random gap, then MAY speak
 * again. Driven by the same dt the walkers run on.
 */
export class BarkState {
  text: string | null = null;
  private timer: number;
  private showing = false;

  constructor(
    private readonly who: Speaker,
    private readonly rnd: () => number,
    /** Stagger the first one so a street does not speak in chorus. */
    firstDelay: number,
  ) {
    this.timer = firstDelay;
  }

  update(dt: number, ctx: BarkContext): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.showing) {
      this.text = null;
      this.showing = false;
      this.timer = GAP_MIN_S + this.rnd() * (GAP_MAX_S - GAP_MIN_S);
      return;
    }
    // Often nothing. Somebody who speaks on every single beat reads as a
    // machine taking turns rather than a person having the odd thought.
    if (this.rnd() < SPEAK_CHANCE) {
      const t = pickBark(this.who, ctx, this.rnd);
      if (t) {
        this.text = t;
        this.showing = true;
        this.timer = HOLD_S;
        return;
      }
    }
    this.timer = GAP_MIN_S + this.rnd() * (GAP_MAX_S - GAP_MIN_S);
  }
}

/** Which gating facts hold, from the props actually on the lot. */
export function factsFromProps(sprites: string[]): Set<string> {
  const f = new Set<string>();
  for (const s of sprites) {
    if (s.startsWith('weed')) f.add('weeds');
    else if (s.startsWith('trash-')) f.add('bins');
    else if (s.startsWith('fence')) f.add('fence');
    else if (s.startsWith('rv') || s.startsWith('car')) f.add('vehicle');
    else if (['couch', 'washer', 'dryer', 'boxes'].includes(s)) f.add('junk');
  }
  // A fence is scenery on a tidy lot, so it alone is not a violation.
  if (f.has('weeds') || f.has('junk') || f.has('vehicle') || f.has('bins')) f.add('violation');
  return f;
}
