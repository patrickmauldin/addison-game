/**
 * Sound.
 *
 * Two looping beds and a one-shot. The beds mark where you ARE: the office for
 * the briefing and the audit, the neighborhood while you are out on the route.
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

/**
 * The looping beds. `ambiance-night` is the street after dark — same street,
 * different room tone, so a night shift sounds like one as well as looking like
 * one. Crossfading between the two day/night beds never happens inside a round;
 * a level is one or the other.
 */
export type BedName = 'ambiance' | 'ambiance-night' | 'office' | 'theme';
/**
 * A CUE is a bed that ends.
 *
 * It takes the room over from whatever was playing, runs once, and hands it
 * back. The dart hunt is the only one so far and it is what the type is shaped
 * around: a fixed stretch of music that IS the clock the player is racing.
 */
export type CueName = 'thief';
/**
 * One-shots, and the file each comes from.
 *
 * The name is NOT the filename: the delivered effects are a mix of mp3 and
 * wav, and encoding that into the call sites would mean every caller knowing
 * which format an artist happened to export.
 */
export const ONESHOT_FILES = {
  /** A verdict stamped. */
  stamp: 'stamp.mp3',
  /** A bounty claimed, and the day's takings at the audit. */
  money: 'money.mp3',
  /** A finding marked. A shutter: the inspector is photographing it. */
  camera: 'camera.mp3',
  /** The rulebook opened, and every leaf turned after that. */
  page: 'page-turn.mp3',
  /** The dart gun going off. Fires on every shot, hit or miss. */
  shot: 'shot.mp3',
  /** The office calling about a determination you got wrong. */
  error: 'error.mp3',
  meow: 'meow.wav',
  bark1: 'bark1.wav',
  bark2: 'bark2.wav',
} as const;
export type OneShot = keyof typeof ONESHOT_FILES;

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
  private cueEl: HTMLAudioElement | null = null;
  private cb: string;
  muted: boolean;

  constructor(cacheBust = '') {
    this.cb = cacheBust;
    this.muted = localStorage.getItem('addison.muted') === '1';
    for (const name of ['ambiance', 'ambiance-night', 'office', 'theme'] as BedName[]) {
      const a = new Audio(`assets/${name}.mp3${cacheBust}`);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      this.beds.set(name, a);
    }
    for (const [name, file] of Object.entries(ONESHOT_FILES)) {
      const a = new Audio(`assets/${file}${cacheBust}`);
      a.preload = 'auto';
      this.oneshots.set(name, a);
    }
  }

  /** Call from a real click. Before this, play() is refused by the browser. */
  unlock(): void {
    this.unlocked = true;
    if (this.current) void this.beds.get(this.current)?.play().catch(() => {});
  }

  /**
   * Start a bed as early as the browser allows.
   *
   * The theme is meant to be playing on the title screen, which is on screen
   * before the player has clicked anything — and autoplay is refused until a
   * gesture. So: try now, and if refused, arm a one-shot listener and start on
   * the very first interaction anywhere on the page. That is as early as it is
   * possible to be, and it costs nothing when autoplay happens to be allowed.
   */
  autoBed(name: BedName): void {
    this.current = name;
    const a = this.beds.get(name);
    if (!a) return;
    const begin = () => {
      if (this.current !== name || this.muted) return;
      a.volume = 0;
      void a.play().catch(() => {});
      this.fade(a, BED_VOLUME);
    };
    if (this.muted) return;
    a.volume = 0;
    a.play().then(
      () => {
        this.unlocked = true;
        this.fade(a, BED_VOLUME);
      },
      () => {
        const arm = () => {
          window.removeEventListener('pointerdown', arm);
          window.removeEventListener('keydown', arm);
          this.unlocked = true;
          begin();
        };
        window.addEventListener('pointerdown', arm);
        window.addEventListener('keydown', arm);
      },
    );
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('addison.muted', m ? '1' : '0');
    } catch {
      /* private browsing; the setting simply does not persist */
    }
    // A cue is audio too. It is not in `beds`, so muting used to leave the
    // thief's music playing over a silenced game.
    if (this.cueEl) {
      if (m) this.cueEl.pause();
      else if (this.unlocked) { void this.cueEl.play().catch(() => {}); this.fade(this.cueEl, BED_VOLUME); }
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

  /**
   * Play a cue, ducking the bed under it, and hand the room back when it ends.
   *
   * `onEnd` is NOT the caller's clock. It fires when the audio finishes, which
   * does not happen at all if the player is muted or the browser never
   * unlocked — so the hunt runs its own timer and treats this as sound. Wiring
   * a 30-second window to an `ended` event would mean a muted player waits
   * forever on a lot with a thief on it.
   */
  playCue(name: CueName, onEnd?: () => void): void {
    this.stopCue();
    const a = new Audio(`assets/${name}.mp3${this.cb}`);
    a.loop = false;
    a.volume = 0;
    this.cueEl = a;
    a.addEventListener('ended', () => { if (this.cueEl === a) this.cueEl = null; onEnd?.(); }, { once: true });
    const bed = this.current ? this.beds.get(this.current) : undefined;
    if (bed) this.fade(bed, 0);
    if (this.muted || !this.unlocked) return;
    void a.play().catch(() => {});
    this.fade(a, BED_VOLUME);
  }

  /** Cut the cue short and bring the bed back up. Safe to call when idle. */
  stopCue(): void {
    const a = this.cueEl;
    this.cueEl = null;
    if (a) {
      clearInterval(this.fades.get(a));
      a.pause();
    }
    const bed = this.current ? this.beds.get(this.current) : undefined;
    if (bed && !this.muted && this.unlocked) this.fade(bed, BED_VOLUME);
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
  play(name: OneShot): void {
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
