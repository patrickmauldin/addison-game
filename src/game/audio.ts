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
  /**
   * One-shot clones that are still sounding.
   *
   * A one-shot is a detached element nothing else holds a reference to, which
   * means muting could not reach one already in the air — a stamp thunk half a
   * second before the mute went on playing through it.
   */
  private live = new Set<HTMLAudioElement>();
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

  /**
   * Every element this instance owns and could make a noise with.
   *
   * The beds are permanent, the cue and the one-shots come and go — and it is
   * the ones that come and go that used to escape a mute.
   */
  private owned(): HTMLAudioElement[] {
    const all = [...this.beds.values(), ...this.live];
    if (this.cueEl) all.push(this.cueEl);
    return all;
  }

  /**
   * WHAT MAKES MUTE HOLD.
   *
   * Every start path in here reads `this.muted`, then calls play(), then fades
   * up — and play() is asynchronous. Between the check and the sound actually
   * arriving there is a window, and the player can hit mute inside it. The
   * button is worse than a coin toss about it: mute runs on `click`, while the
   * theme's retry runs on `pointerdown`, which is EARLIER in the same press. So
   * pressing mute could itself start the bed it was meant to silence, and no
   * amount of checking before a play() can close that, because the mute has not
   * happened yet at the moment of the check.
   *
   * The element's own `muted` flag is synchronous, applies to every element at
   * once, and does not care what a promise in flight decides to do later. That
   * is the guarantee. Pausing is still worth doing — a paused bed is not
   * burning a decode, and it is what makes an unmute resume cleanly — but the
   * flag is what makes the setting true rather than usually true.
   */
  private applyMute(): void {
    for (const a of this.owned()) a.muted = this.muted;
  }

  /**
   * Start an element, then check AGAIN once the browser has really started it.
   *
   * `wanted` is re-asked after the await, because by then the answer may have
   * changed — muted, or moved to a different room, or the cue was cut short.
   */
  private start(a: HTMLAudioElement, wanted: () => boolean): void {
    void a.play().then(
      () => {
        if (!wanted()) {
          a.pause();
          return;
        }
        this.fade(a, BED_VOLUME);
      },
      () => {
        /* refused, or aborted by a pause that landed first; either is fine */
      },
    );
  }

  /** True while `name` is still the room we are in and sound is allowed. */
  private wantBed(name: BedName): () => boolean {
    return () => !this.muted && this.current === name;
  }

  /** Call from a real click. Before this, play() is refused by the browser. */
  unlock(): void {
    this.unlocked = true;
    if (this.muted || !this.current) return;
    const a = this.beds.get(this.current);
    if (!a) return;
    // Brought back up, not just started. A bed that autoBed left refused is
    // sitting at volume 0, and playing it without restoring the level is
    // silent playback that looks from the outside exactly like it worked.
    this.start(a, this.wantBed(this.current));
  }

  /**
   * Start a bed as early as the browser allows.
   *
   * The theme is meant to be playing on the title screen, which is on screen
   * before the player has clicked anything — and autoplay is refused until a
   * gesture. So: try now, and if refused, keep trying on every interaction
   * until one is actually allowed through.
   *
   * KEEP TRYING is the whole point, and the reason this used to fail. The old
   * version armed a one-shot on `pointerdown`, and a one-shot is only correct
   * if that first gesture is guaranteed to work. It is not: pointerdown does
   * not grant media activation in every browser — Safari wants the click or
   * touchend that follows it. So the first click anywhere was spent on a play()
   * that was still refused, the listener came off, and the theme then sat
   * silent until something else happened to call play() from a properly
   * activated context. On the title screen the only thing that ever did was
   * Start Game, which is exactly where the music appeared to begin.
   *
   * Listening on the whole family and disarming only once play() RESOLVES
   * costs nothing when autoplay is allowed (the listeners are never added) and
   * cannot be defeated by a browser that grants activation on a different
   * event than the one guessed at here.
   */
  autoBed(name: BedName): void {
    this.current = name;
    const a = this.beds.get(name);
    if (!a || this.muted) return;

    const EVENTS = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;
    const disarm = (): void => {
      for (const e of EVENTS) window.removeEventListener(e, attempt);
    };
    const attempt = (): void => {
      // Moved on, or silenced while waiting. Either way stop listening.
      if (this.current !== name || this.muted) return disarm();
      a.volume = 0;
      void a.play().then(
        () => {
          this.unlocked = true;
          disarm();
          // Re-asked, because this is the exact race: the retry runs on
          // pointerdown and the mute button on the click that follows it, so
          // by now the player may have asked for silence with the same press
          // that got us in here.
          if (this.muted || this.current !== name) return void a.pause();
          this.fade(a, BED_VOLUME);
        },
        () => {
          /* Not an activation the browser accepts. Stay armed for the next. */
        },
      );
    };

    a.volume = 0;
    a.play().then(
      () => {
        this.unlocked = true;
        if (this.muted || this.current !== name) return void a.pause();
        this.fade(a, BED_VOLUME);
      },
      () => {
        for (const e of EVENTS) window.addEventListener(e, attempt);
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
    // FIRST, and before any of the decisions below, because this is the part
    // that cannot be raced. Everything after it is housekeeping.
    this.applyMute();

    if (m) {
      // Every fade is a timer walking a volume somewhere. Left running across a
      // mute they arrive at full level on a silenced element and the next
      // unmute comes back at whatever they landed on.
      for (const a of this.owned()) {
        clearInterval(this.fades.get(a));
        this.fades.delete(a);
        a.pause();
      }
      // A one-shot is half a second long and nothing waits for it. Stopped
      // rather than tracked, so the set cannot grow across a session.
      this.live.clear();
      return;
    }

    // A cue is audio too. It is not in `beds`, so unmuting has to bring back
    // whichever of the two is the one currently holding the room.
    if (this.cueEl && this.unlocked) {
      const cue = this.cueEl;
      this.start(cue, () => !this.muted && this.cueEl === cue);
      return;
    }
    if (this.current && this.unlocked) {
      const a = this.beds.get(this.current);
      if (a) {
        a.volume = 0;
        this.start(a, this.wantBed(this.current));
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
    // Born muted if the game is. A fresh element defaults to unmuted, so
    // starting a hunt while silenced used to hand the room to the one piece of
    // audio the setting had never been applied to.
    a.muted = this.muted;
    this.cueEl = a;
    a.addEventListener('ended', () => { if (this.cueEl === a) this.cueEl = null; onEnd?.(); }, { once: true });
    const bed = this.current ? this.beds.get(this.current) : undefined;
    if (bed) this.fade(bed, 0);
    if (this.muted || !this.unlocked) return;
    this.start(a, () => !this.muted && this.cueEl === a);
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
    this.start(to, this.wantBed(name));
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
    // Held only while it is sounding, so a mute a beat later can still reach
    // it — and dropped on the way out so the set does not grow all session.
    this.live.add(a);
    a.addEventListener('ended', () => this.live.delete(a), { once: true });
    void a.play().then(
      () => {
        if (this.muted) a.pause();
      },
      () => this.live.delete(a),
    );
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
