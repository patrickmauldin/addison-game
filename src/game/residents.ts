/**
 * The neighbors.
 *
 * Ten people composited out of assets/char-pack's paper-doll layers by
 * tools/pack-residents.ts — different skin, hair, top, bottom and boots each.
 * Building them from layers rather than shipping one model is the point: a
 * street wants a population, and the pack recombines into far more of one than
 * any single delivered character could.
 *
 * Most of them wander. Three are out working on the yard with a tool, and those
 * stand still and work — someone hoeing a bed does not stroll about while doing
 * it, and standing still also avoids needing the pack's separate carry-walk.
 *
 * Four directions, in the same order the Walker already steers in, so this
 * sheet reuses its facing outright rather than re-deriving one.
 */

import meta from '../data/residents.json';
import type { Dir, Walker } from './walker.js';

/** Tool rows sit after the four direction rows, in this order. */
export const TOOL_NAMES = meta.tools.map((t) => t.name);

/**
 * Row index of a named character, for the ones that are PLACED rather than
 * drawn. The named cast carry a pick weight of 0, so they never come out of
 * pickCharacter — this is the only way they reach the street.
 */
export function characterNamed(name: string): number {
  const i = (meta.characters as string[]).indexOf(name);
  if (i < 0) throw new Error(`no character "${name}" — is it in tools/pack-residents.ts?`);
  return i;
}

/**
 * Draw a character, respecting how often each is meant to turn up.
 *
 * NOT a uniform pick. Skins 1 and 2 are on two of the ten characters but are
 * weighted down to 15% of appearances between them, so sampling the cast evenly
 * would show them twice as often as intended. The weights live in the generated
 * data next to the skins they come from.
 *
 * `exclude` keeps everybody on one lot looking different: two identical
 * strangers passing each other reads as a rendering fault, not a coincidence.
 */
export function pickCharacter(rnd: () => number, exclude: number[] = []): number {
  const w = meta.pick as number[];
  let total = 0;
  const pool: number[] = [];
  for (let i = 0; i < w.length; i++) {
    if (exclude.includes(i)) continue;
    pool.push(i);
    total += w[i];
  }
  // Only an exclusion list as long as the cast could empty the pool, and then
  // a repeat is unavoidable anyway.
  if (!pool.length) return Math.floor(rnd() * w.length);
  let r = rnd() * total;
  for (const i of pool) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return pool[pool.length - 1];
}

export const RESIDENTS = {
  sheet: 'assets/residents.png',
  frameW: meta.frameW,
  frameH: meta.frameH,
  /**
   * Where the PERSON sits inside the frame. Not the frame's own middle and
   * floor: the frame had to grow to fit a swung hoe, which reaches above the
   * head and out to one side, and centring on the frame would shove everybody
   * sideways to make room for a tool most of them are not holding.
   */
  centerX: meta.centerX,
  ground: meta.ground,
  count: meta.characters.length,
  /** For showing one character outside the game — a face on a notice. */
  rowsPerCharacter: meta.rowsPerCharacter,
  idleCol: meta.walkLen,
  sheetW: meta.frameW * meta.cols,
  sheetH: meta.frameH * meta.rowsPerCharacter * meta.characters.length,
};

/**
 * How much bigger a resident is drawn than their sprite.
 *
 * Stated as the upscale rather than as a target height, because the upscale is
 * what actually governs how the art reads: it is the factor every source pixel
 * gets multiplied by, and at a whole number the sprite's pixel grid stays
 * square and aligned instead of some rows being a pixel taller than others.
 *
 * 4x on a 28px figure is 112 scene pixels, roughly 9% of the 1254px house.
 * Measuring the houses argues for ~157 (the art runs ~27px per foot; house1's
 * garage door is ~188px for a seven-foot opening) but that reads too large for
 * art this coarse — every extra pixel of height is more upscale, and more
 * upscale is what makes a character look blockier than the world it stands in.
 */
export const RESIDENT_UPSCALE = 4;

/** From the pack's own timing notes: walk 200ms a frame, idle 1000 then 500. */
const WALK_FPS = 5;
const IDLE_HOLD = [1.0, 0.5];
const IDLE_CYCLE = IDLE_HOLD[0] + IDLE_HOLD[1];

/** A stretch of work, then a breather. Nobody hoes without stopping. */
const WORK_MIN_S = 5;
const WORK_MAX_S = 11;
const REST_MIN_S = 3;
const REST_MAX_S = 7;

/**
 * A worker's rhythm.
 *
 * Somebody who swings a hoe continuously from the moment you arrive reads as a
 * looping sprite, not a person. So they work a while, stop and stand a while,
 * then go back to it — and turn to a different part of the bed when they do,
 * which is the other thing that stops it looking like one clip on repeat.
 *
 * Facing is limited to south, west and east. Not north: with their back turned
 * the tool spends most of the swing hidden behind them.
 */
export class ToolWork {
  /** 0 S, 1 W, 2 E. */
  dir: Dir = 0;
  working = true;
  private timer = 0;

  constructor(
    /** Index into TOOL_NAMES. */
    readonly tool: number,
    private readonly rnd: () => number,
  ) {
    this.dir = this.pickDir();
    this.timer = WORK_MIN_S + rnd() * (WORK_MAX_S - WORK_MIN_S);
  }

  /** Never the same way twice running — turning is the point of turning. */
  private pickDir(): Dir {
    const options = ([0, 1, 2] as Dir[]).filter((d) => d !== this.dir);
    return options[Math.floor(this.rnd() * options.length)];
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.working) {
      this.working = false;
      this.timer = REST_MIN_S + this.rnd() * (REST_MAX_S - REST_MIN_S);
    } else {
      this.working = true;
      this.dir = this.pickDir();
      this.timer = WORK_MIN_S + this.rnd() * (WORK_MAX_S - WORK_MIN_S);
    }
  }
}

/**
 * A frame of the plain walk cycle.
 *
 * Split out from residentFrame because people on the sidewalk are not
 * residents — they hold no tool, never idle, and have no Walker steering them —
 * but they are drawn from the same ten characters and the same rows.
 */
export function walkFrame(character: number, dir: Dir, phase: number): { sx: number; sy: number } {
  const row = (character % RESIDENTS.count) * meta.rowsPerCharacter + dir;
  const col = Math.floor(phase * WALK_FPS) % meta.walkLen;
  return { sx: col * meta.frameW, sy: row * meta.frameH };
}

/** The two idle frames, in whichever direction. Used for standing and resting. */
function idleFrame(character: number, dir: Dir, phase: number): { sx: number; sy: number } {
  const base = (character % RESIDENTS.count) * meta.rowsPerCharacter;
  // Deliberately uneven — a long beat then a short one, which reads as
  // breathing rather than a metronome.
  const col = meta.walkLen + (phase % IDLE_CYCLE < IDLE_HOLD[0] ? 0 : 1);
  return { sx: col * meta.frameW, sy: (base + dir) * meta.frameH };
}

/**
 * Source rect for the pose the walker is currently in.
 *
 * `work` is passed in rather than read off the character because holding a
 * watering can is a fact about this afternoon, not about who someone is — every
 * resident can be handed any implement.
 */
export function residentFrame(w: Walker, work: ToolWork | null): { sx: number; sy: number } {
  if (work) {
    // On a break they stand in the same spot, facing the same way, so the pause
    // reads as a pause rather than as a different person appearing.
    if (!work.working) return idleFrame(w.character, work.dir, w.phase);
    const hold = meta.tools[work.tool].hold;
    // Uneven frame holds, straight from the pack's timing notes — a hoe stroke
    // hangs at the top of the swing and then comes down fast.
    const total = hold.reduce((a, b) => a + b, 0);
    let t = w.phase % total;
    let col = hold.length - 1;
    for (let i = 0; i < hold.length; i++) {
      if (t < hold[i]) { col = i; break; }
      t -= hold[i];
    }
    const base = (w.character % RESIDENTS.count) * meta.rowsPerCharacter;
    const row = base + meta.dirsPerCharacter + work.tool * meta.toolDirs + work.dir;
    return { sx: col * meta.frameW, sy: row * meta.frameH };
  }

  if (w.moving) return walkFrame(w.character, w.facing, w.phase);
  return idleFrame(w.character, w.facing, w.phase);
}
