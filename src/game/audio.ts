/**
 * Sound.
 *
 * Two looping beds and a one-shot. The beds mark where you ARE: the office for
 * the briefing and the audit, the neighbourhood while you are out on the route.
 * Crossfading between them does the scene-setting that no text has to.
 *
 * Everything here is defensive about two facts of browser audio:
 *
 *  1. Nothing may play before a user gesture. Calling play() earlier rejects,
 *     and an unhandled rejection is a console error on every load. So the first
 *     real click unlocks, and every play() catches.
 *  2. A file may simply be missing. Sound is an enhancement; a missing bed must
 *     never stop the game, so failures are swallowed rather than surfaced.
 */

export type BedName = 'ambiance' | 'office';

const BED_VOLUME = 0.6;
/**
 * Kept clear of the beds. Raising the beds without raising this buries the
 * stamp under them, and the stamp is feedback for an action the player just
 * took — it has to cut through the room, not blend into it.
 */
const ONESHOT_VOLUME = 0.85;
const FADE_MS = 700;

export class Sound {
  private beds = new Map<BedName, HTMLAudioElement>();
  private oneshots = new Map<string, HTMLAudioElement>();
  private current: BedName | null = null;
  private unlocked = false;
  private fades = new Map<HTMLAudioElement, number>();
  muted: boolean;

  constructor(cacheBust = '') {
    this.muted = localStorage.getItem('addison.muted') === '1';
    for (const name of ['ambiance', 'office'] as BedName[]) {
      const a = new Audio(`assets/${name}.mp3${cacheBust}`);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      this.beds.set(name, a);
    }
    const s = new Audio(`assets/stamp.mp3${cacheBust}`);
    s.preload = 'auto';
    this.oneshots.set('stamp', s);
  }

  /** Call from a real click. Before this, play() is refused by the browser. */
  unlock(): void {
    this.unlocked = true;
    if (this.current) void this.beds.get(this.current)?.play().catch(() => {});
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('addison.muted', m ? '1' : '0');
    } catch {
      /* private browsing; the setting simply does not persist */
    }
    for (const [name, a] of this.beds) {
      if (m) {
        a.pause();
      } else if (name === this.current && this.unlocked) {
        a.volume = 0;
        void a.play().catch(() => {});
        this.fade(a, BED_VOLUME);
      }
    }
  }

  /** Crossfade to a bed. Passing the one already playing does nothing. */
  bed(name: BedName): void {
    if (this.current === name) return;
    const from = this.current ? this.beds.get(this.current) : undefined;
    const to = this.beds.get(name);
    this.current = name;
    if (from) this.fade(from, 0, () => from.pause());
    if (!to || this.muted || !this.unlocked) return;
    to.volume = 0;
    void to.play().catch(() => {});
    this.fade(to, BED_VOLUME);
  }

  /**
   * One-shot. Cloned so rapid repeats overlap instead of cutting each other
   * off — a stamp that restarts mid-thunk sounds broken.
   */
  play(name: 'stamp'): void {
    if (this.muted || !this.unlocked) return;
    const src = this.oneshots.get(name);
    if (!src) return;
    const a = src.cloneNode() as HTMLAudioElement;
    a.volume = ONESHOT_VOLUME;
    void a.play().catch(() => {});
  }

  private fade(a: HTMLAudioElement, target: number, done?: () => void): void {
    clearInterval(this.fades.get(a));
    const start = a.volume;
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      a.volume = Math.max(0, Math.min(1, start + (target - start) * k));
      if (k >= 1) {
        clearInterval(id);
        this.fades.delete(a);
        done?.();
      }
    }, 33) as unknown as number;
    this.fades.set(a, id);
  }
}
