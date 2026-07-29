/**
 * A resident wandering the front yard.
 *
 * Sheet layout, derived from the PNG's alpha and confirmed against the Unity
 * package's clip list: 12 columns x 16 rows of 18x26 frames. Each row holds
 * FOUR characters of THREE frames; rows cycle S, W, E, N; every four rows is a
 * new set of four characters. Sixteen characters in total, matching
 * Townspeople_0..15 in the package.
 *
 *   character c -> row group floor(c/4), column block c%4
 *   direction  -> row within the group: 0 S, 1 W, 2 E, 3 N
 *   frame      -> column within the block: 0, 1, 2
 *
 * The walk cycle is 0-1-2-1 at 4fps, taken from the .anim keyframes (0, 0.25,
 * 0.5, 0.75s) rather than guessed.
 */

export const FRAME_W = 18;
export const FRAME_H = 26;
const DIRS = 4;
const WALK_CYCLE = [0, 1, 2, 1];
const FPS = 4;

export type Dir = 0 | 1 | 2 | 3; // S, W, E, N

/**
 * How much bigger a person is than their sprite, in house-art pixels.
 *
 * The house art is far denser than this sheet: house1's garage door is about
 * 188px tall for roughly seven feet, so the art runs ~27px per foot, which puts
 * a five-foot-eight resident at ~153px. The sprite is 26px. Hence ~5.9x.
 *
 * That ratio is not a preference, it is what standing them next to the house
 * requires — and it is also why they read as much blockier than everything
 * around them. See the note in README.
 */
export const PERSON_UPSCALE = 5.9;

export type Bounds = { x0: number; x1: number; y0: number; y1: number };

export class Walker {
  /** 0..15 */
  readonly character: number;
  x: number;
  y: number;
  private tx: number;
  private ty: number;
  private dir: Dir = 0;
  private t = 0;
  /** Seconds left standing still before choosing a new destination. */
  private pause = 0;
  private readonly speed: number;
  private readonly bounds: Bounds;
  private readonly rnd: () => number;

  constructor(character: number, bounds: Bounds, rnd: () => number, speed: number) {
    this.character = character % 16;
    this.bounds = bounds;
    this.rnd = rnd;
    this.speed = speed;
    this.x = bounds.x0 + rnd() * (bounds.x1 - bounds.x0);
    this.y = bounds.y0 + rnd() * (bounds.y1 - bounds.y0);
    this.tx = this.x;
    this.ty = this.y;
    this.retarget();
  }

  private retarget(): void {
    const { x0, x1, y0, y1 } = this.bounds;
    this.tx = x0 + this.rnd() * (x1 - x0);
    this.ty = y0 + this.rnd() * (y1 - y0);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.pause > 0) {
      this.pause -= dt;
      return;
    }
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      // Standing about is most of what people in a front yard actually do.
      this.pause = 1 + this.rnd() * 3;
      this.retarget();
      return;
    }
    const step = Math.min(d, this.speed * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    // Face the axis of travel, measured against the SHAPE of the yard rather
    // than in raw pixels. A front lawn is wide and shallow — roughly 800x135 —
    // so raw comparison makes horizontal win essentially always, and half the
    // sprite sheet never gets used. Normalising by the bounds means a move that
    // is proportionally more vertical turns the walker to face the street.
    const bw = Math.max(1, this.bounds.x1 - this.bounds.x0);
    const bh = Math.max(1, this.bounds.y1 - this.bounds.y0);
    this.dir = Math.abs(dx) / bw > Math.abs(dy) / bh ? (dx < 0 ? 1 : 2) : dy > 0 ? 0 : 3;
  }

  /** Source rect in the sheet for the current pose. */
  frame(): { sx: number; sy: number } {
    const moving = this.pause <= 0;
    const f = moving ? WALK_CYCLE[Math.floor(this.t * FPS) % WALK_CYCLE.length] : 1;
    const group = Math.floor(this.character / 4);
    const block = this.character % 4;
    return {
      sx: (block * 3 + f) * FRAME_W,
      sy: (group * DIRS + this.dir) * FRAME_H,
    };
  }
}

/** Deterministic per-lot RNG so a resident is the same person every visit. */
export function seedFrom(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
