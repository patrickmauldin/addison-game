/**
 * Cats and dogs.
 *
 * Ambient, not interactive. A cat crossing a lawn is the cheapest possible
 * signal that a street is lived on rather than staged, and it costs nothing to
 * read: there is no rule about cats, so it never competes for the player's
 * attention with something they are supposed to be judging.
 *
 * Deliberately NOT clickable. Everything the player can click is an assertion
 * that something violates an article, and an animal that answers to that would
 * be a trap. Chaz is the exception, and he is a bounty with a notice pinned up
 * explaining himself.
 *
 * Steering is the resident Walker — a cat wandering a yard and a person
 * wandering a yard are the same problem, and it already handles facing,
 * pausing and the yard's shape.
 */

import meta from '../data/animals.json';
import type { Dir, Walker } from './walker.js';

export const ANIMALS = {
  sheet: 'assets/animals.png',
  frameW: meta.frameW,
  frameH: meta.frameH,
  count: meta.animals.length,
};

/** What this one says when you click it. */
export function animalKind(which: number): string {
  return meta.kinds[which % ANIMALS.count];
}

/**
 * Which animals are out, given the hour.
 *
 * The two sets do not overlap: cats and dogs belong to somebody and are indoors
 * after dark, and the armadillo and the raccoon are the neighborhood's own and
 * are not out in daylight. That is a stronger rule than "night also allows the
 * wild ones", and deliberately so — an animal turns up on well under half the
 * lots, so a night set that still contained the cat and the dog would show the
 * new animals almost never. If a cat wandering a night lawn is wanted later,
 * this is the one line to relax.
 *
 * Returning the INDEX list rather than filtering at the draw site keeps the
 * sheet rows as the single source of truth — adding an animal to the packer is
 * then the whole change.
 */
export function animalsAbroad(night: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < ANIMALS.count; i++) {
    if (meta.ambient[i] && meta.nocturnal[i] === night) out.push(i);
  }
  return out;
}

/** Row index of a named animal, for the ones that are placed rather than rolled. */
export function animalNamed(id: string): number {
  const i = (meta.animals as string[]).indexOf(id);
  if (i < 0) throw new Error(`no animal "${id}" in the sheet — is it in tools/pack-animals.ts?`);
  return i;
}

/**
 * How much bigger a cat is drawn than its sprite.
 *
 * Residents are 28px of content at 4x, so 112px tall. A cat is also 28px of
 * content, which means matching their factor would put a housecat eye to eye
 * with a grown adult.
 *
 * 3x lands around 84px. Anatomically that is a very large cat — about
 * three-quarters of a standing person — but the art is a high top-down view
 * where a cat presents its LENGTH, not its shoulder height, and at the size
 * the game actually renders, smaller simply did not read as an animal.
 */
export const ANIMAL_UPSCALE = 3;

/** Eight frames at a pottering pace. Neither of them marches. */
const FPS = 6;

/**
 * Source rect for the pose this cat is in, and whether to draw it mirrored.
 *
 * `flip` exists because of the missing north walk. North is packed from the
 * north-EAST animation, so a cat heading up and to the LEFT would be drawn
 * turned up and to the right — body and travel disagreeing, which is very
 * obvious once you notice it. Mirroring the same frames gives north-west, and
 * a cat has no baked shadow or asymmetric markings to give the flip away.
 */
export function animalFrameFor(which: number, w: Walker): { sx: number; sy: number; flip: boolean } {
  const row = (which % ANIMALS.count) * meta.dirs + w.facing;
  // Standing still means STANDING still. Cycling the walk on the spot reads as
  // a treadmill, which is worse than no animation at all.
  // Modulo this ROW's length, not the sheet width: rows are padded out to the
  // longest walk on the sheet, and cycling past the end of a short one drew the
  // padding — a blank frame once per lap.
  const col = w.moving ? Math.floor(w.phase * FPS) % meta.lens[row] : 0;
  return {
    sx: col * meta.frameW,
    sy: row * meta.frameH,
    // Only the cat needs this: its north walk was never delivered and is
    // mirrored from north-east. The dog has a real one.
    flip: animalKind(which) === 'cat' && w.facing === 3 && w.hx < 0,
  };
}
