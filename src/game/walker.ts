/**
 * A resident wandering the front yard.
 *
 * Steering only. This class owns WHERE somebody walks and which way they are
 * facing; it knows nothing about sprite sheets. What they look like is
 * game/residents.ts, which reads `facing`, `moving` and `phase` off this and
 * picks its own frames — so swapping the art out never touches the movement.
 */

export type Dir = 0 | 1 | 2 | 3; // S, W, E, N

export type Bounds = { x0: number; x1: number; y0: number; y1: number };

export class Walker {
  /** Index into whatever roster the caller drew it from. */
  readonly character: number;
  x: number;
  y: number;
  private tx: number;
  private ty: number;
  /** Public via `facing`. */
  private dir: Dir = 0;
  /**
   * Sign of horizontal travel, -1 / 0 / +1.
   *
   * Four facings cannot express "up and to the left" versus "up and to the
   * right", and the cat sheet has no north walk — north is mirrored from
   * north-east, so it needs to know which way to mirror.
   */
  hx = 0;
  private t = 0;
  /** Seconds left standing still before choosing a new destination. */
  private pause = 0;
  private readonly speed: number;
  private readonly bounds: Bounds;
  private readonly rnd: () => number;

  constructor(character: number, bounds: Bounds, rnd: () => number, speed: number) {
    this.character = character;
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
    this.hx = Math.sign(dx);
    this.dir = Math.abs(dx) / bw > Math.abs(dy) / bh ? (dx < 0 ? 1 : 2) : dy > 0 ? 0 : 3;
  }

  /** False while standing about, which is most of the time. */
  get moving(): boolean {
    return this.pause <= 0;
  }

  /** 0 S, 1 W, 2 E, 3 N — the same order the char-pack sheets are laid out in. */
  get facing(): Dir {
    return this.dir;
  }

  /** Seconds since spawn — the clock any sheet can cut its own cycle from. */
  get phase(): number {
    return this.t;
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
