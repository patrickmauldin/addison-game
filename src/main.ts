/**
 * Level driver — Bonerville, Levels 1-2.
 *
 * Deliberately withholds feedback. You find out you were wrong when the audit
 * lands at the end of the day, never at the moment you stamp. Immediate red-X
 * removes all tension and turns the game into a quiz (gameplan section 5).
 */


import { renderLot, solidHeight, type LotSpec, type PropSpec, type RenderedLot, type SceneAssets } from './scene-compositor.js';
import { DEFAULT_ANCHORS, HOUSE_NATIVE, ZOOM_MAX, ZOOM_MIN, housePlan } from './core/scene.js';

import {
  adjudicate,
  type ArticleTiming,
  activateSlot,
  bumpAccuracy,
  cumulativeAccuracy,
  deleteSlot,
  listSlots,
  load,
  newSlot,
  noteFirstSeen,
  recordFor,
  reset,
  passFault,
  waivedBy,
  rulingCounts,
  save,
  type LotOutcome,
  type Pass,
  type Ruling,
  type SaveFile,
  type SlotInfo,
  type Verdict,
} from './game/state.js';

import level1 from './data/levels/level1.json';
import level2 from './data/levels/level2.json';
import level3 from './data/levels/level3.json';
import level4 from './data/levels/level4.json';
import level5 from './data/levels/level5.json';
import level6 from './data/levels/level6.json';
import level7 from './data/levels/level7.json';
import level8 from './data/levels/level8.json';
import rulesData from './data/rules.json';
import streetsData from './data/streets.json';
import bulletinData from './data/bulletin.json';
import housesData from './data/houses.json';
import { BarkState, factsFromProps, resetBarkHistory, type BarkContext } from './game/barks.js';
import { BUBBLE_FONT, drawBubble } from './game/bubble.js';
import { ANIMAL_UPSCALE, ANIMALS, animalFrameFor, animalKind, animalNamed, animalsAbroad } from './game/animal.js';
import { dateForLevel, isCollectionWeek } from './game/calendar.js';
import { makePassersby, remapPassersby, stepPassersby, type Passerby, type Sidewalk } from './game/passerby.js';
import { characterNamed, pickCharacter, RESIDENT_UPSCALE, residentFrame, RESIDENTS, TOOL_NAMES, ToolWork, walkFrame } from './game/residents.js';
import { seedFrom, Walker } from './game/walker.js';
import { Sound } from './game/audio.js';
/**
 * Levels carry their own lots inline.
 *
 * An ADDRESS recurs across levels with different props — that is the whole
 * point of Level 3 onwards, where you come back and find out whether they fixed
 * it. So the lot cannot be one static file per address; the level owns what is
 * on each lot that day, and `lot_id` is the thread that ties an address to its
 * history in the save.
 */
const LEVELS = [level1, level2, level3, level4, level5, level6, level7, level8] as unknown as LevelSpec[];

/**
 * A standing notice and the thing it is about.
 *
 * `kind` decides what you are looking for and how it is found:
 *  - `prop`   an object hidden on a lot, clicked where it stands (Chaz).
 *  - `person` one of the ten residents, identified by their LOOK. The notice
 *             carries their portrait and you have to recognise them in the
 *             street — which is why the character is drawn at random rather
 *             than authored: a fixed one would be memorised, not recognised.
 */
type Bounty = {
  id: string;
  /**
   * What is being looked for.
   *
   *  prop    — a thing standing still in a yard, drawn from the scene.
   *  person  — a face on the notice, walking a lot as a resident.
   *  animal  — a pet, ROAMING the lot it is hiding on. Sitting still made it a
   *            spot-the-difference; a cat that moves has to be found.
   */
  kind?: 'prop' | 'person' | 'animal';
  /** animal only: the id in the packed animal sheet — how it moves in the yard. */
  animal?: string;
  /** MISSING for a pet, WANTED for a person. */
  headline?: string;
  name: string;
  /** The line under the reward: who owns it, or where they are seen. */
  note: string;
  /**
   * The picture on the NOTICE. A prop is also drawn from it in the yard; an
   * animal is not — it walks off the packed sheet, and this is only its photo.
   */
  sprite?: string;
  label: string;
  reward: number;
  scale?: number;
  /** Pin the face instead of drawing one. See placeBounty. */
  character?: string;
  /**
   * This one is not CLICKED, it is SHOT.
   *
   * The drawer comes in, the pointer becomes a sight and the music is the
   * clock. It was the thief's alone and hardwired to his id; it is a property
   * of the notice now, because an armadillo wrecking a lawn is the same
   * encounter with a different animal on the end of it.
   */
  hunt?: boolean;
  eligible_lots: string[];
};
type LevelSpec = {
  level_id: number;
  weather: string;
  /**
   * Named residents pinned to an address on this level. Authored, not rolled —
   * a cameo that might not happen is not a cameo.
   *
   * Two shapes, and a lot may use either:
   *
   *   people + dog   they walk past that lot on the sidewalk (see makeCameo)
   *   animal         that animal is the one loose in the yard (see makeAnimal)
   *
   * Anything a level does not pin stays random, so the street is still mostly
   * strangers and the named faces are the ones you come to know.
   */
  cameos?: { lot_id: string; people?: string[]; dog?: string; animal?: string }[];
  /**
   * Which animals are loose in yards on this shift, by id.
   *
   * Authored per level rather than derived from a nocturnal flag on the sheet.
   * The flag could only ever say "night" or "day", and the schedule wants finer
   * than that — an extra cat on one night round and not the other.
   */
  ambient_animals?: string[];
  /**
   * A thing that happens TO the player, mid-inspection.
   *
   * Fires on marking the named object, before anything is stamped, so it is
   * their own noticing that summons it rather than the lot loading. See
   * maybeEvent.
   */
  event?: {
    id: string;
    lot_id: string;
    object: string;
    speaker: string;
    body: string;
    options: { id: string; label: string; pay?: number; unmark?: boolean; reply: string }[];
  };
  /**
   * Waivers the homeowners on this round will produce. Same trigger as `event`
   * — you have to have written the thing up before anybody argues about it.
   */
  passes?: Pass[];
  /**
   * A night shift. Authored per level rather than derived from the number: the
   * intent is roughly every couple of shifts, but which ones is a pacing
   * decision — a night round wants to land where the street has something worth
   * seeing in the dark, not on a fixed modulus.
   */
  night?: boolean;
  active_rules: string[];
  quota: number;
  pay_per_inspection: number;
  verdict_mode: string;
  briefing: string;
  bounty?: Bounty;
  lots: LotSpec[];
};

let levelIndex = 0;
let day: LevelSpec = LEVELS[0];
let today = dateForLevel(day.level_id);
/** This level's lots by id, so the route can stay a list of addresses. */
let LOTS: Record<string, LotSpec> = {};

/**
 * The notice that outlives its level.
 *
 * A bounty is normally the level's own — authored in the file, settled that
 * round. The thief is not: miss him and he is still out there, so the notice
 * stays up through the daylight rounds and he is back on the street the next
 * night. This copies him forward onto any later level that has not authored a
 * bounty of its own, which is the whole of the mechanism.
 *
 * Copied, not mutated: LEVELS holds the imported JSON and writing to it would
 * make the campaign different on a second playthrough within the session.
 */
const THIEF_BOUNTY = (level3 as { bounty?: Bounty }).bounty!;

/**
 * Every notice the campaign can post, by id.
 *
 * The save records which flyers are still UP as a list of ids; this is what
 * turns one back into the notice that authored it. Read from the level files
 * rather than copied, so the wording, the reward and the eligible lots have one
 * home — the round that introduced them.
 */
const ALL_BOUNTIES: Map<string, Bounty> = new Map(
  LEVELS.map((l) => (l as { bounty?: Bounty }).bounty)
    .filter((b): b is Bounty => !!b)
    .map((b) => [b.id, b]),
);

/** Notices still up, oldest first, skipping any whose level file has gone. */
function outstandingBounties(): Bounty[] {
  return (saveFile.inspector.outstanding ?? [])
    .map((id) => ALL_BOUNTIES.get(id))
    .filter((b): b is Bounty => !!b);
}

/** A notice comes down when the thing on it is found, and not before. */
function markOutstanding(b: Bounty): void {
  const list = (saveFile.inspector.outstanding ??= []);
  if (!list.includes(b.id)) list.push(b.id);
}
function clearOutstanding(id: string): void {
  const list = saveFile.inspector.outstanding;
  if (list) saveFile.inspector.outstanding = list.filter((x) => x !== id);
}

/**
 * Loaded HERE, above the first loadLevel, and not down with the round state.
 *
 * loadLevel runs once at module scope to set up level 1, and it now asks the
 * save whether the thief is still outstanding. A save initialised further down
 * the file is undefined at that point, which took the whole game down on boot
 * with "cannot read properties of undefined".
 */
let saveFile: SaveFile = load();

function loadLevel(i: number): void {
  levelIndex = i;
  day = LEVELS[i];
  today = dateForLevel(day.level_id);
  /**
   * `day.bounty` is THIS ROUND'S notice and nothing else now.
   *
   * It used to be quietly overwritten with the oldest unfound one so a round
   * with none of its own had something to look for. Every open notice is placed
   * on its own lot instead — see placeBounty — so a flyer no longer waits for a
   * quiet round to be answerable, and this level's own bounty stays this
   * level's own.
   */
  LOTS = Object.fromEntries(day.lots.map((l) => [l.lot_id, l]));
}
loadLevel(0);

const ARTICLES = rulesData.articles;
/**
 * Which week the recycling truck runs, read off R-110 rather than repeated.
 *
 * The briefing has to say whether today is a collection week, and adjudication
 * has to agree with it — two copies of the reference date is how the morning
 * meeting starts contradicting the stamp.
 */
/**
 * The days a green bin could legitimately be at the curb, off R-110 itself.
 *
 * Read rather than repeated: which weekdays the containers are allowed out is
 * the Article's business, and a second copy here is a copy that eventually
 * disagrees with the one the stamp is judged against.
 */
const RECYCLING_DAYS: string[] =
  (ARTICLES.find((a) => a.id === 'R-110') as { weekday_window?: string[] } | undefined)
    ?.weekday_window ?? [];
const RECYCLING_WEEK =
  (ARTICLES.find((a) => a.id === 'R-110') as { alternate_weeks?: { week_of: string } } | undefined)
    ?.alternate_weeks?.week_of ?? '2026-03-02';
/** Binder divider order. Fixed by the data, never sorted — see rules.json. */
const CATEGORIES: string[] = (rulesData as { categories?: string[] }).categories ?? [];

/**
 * "2024-01-01" -> "Jan 1". The year is deliberately dropped: it is stored so
 * dates sort and grace periods can be measured, but showing it would date a
 * fictional community for no gain.
 */
/**
 * "R-104" -> "104".
 *
 * The R- prefix is a filing code. It belongs in the data, where it keeps the
 * ids sortable and unambiguous, but on screen it is noise the player has to
 * read past every time. The binder shows the bare number in its own column;
 * the briefing, which has no column to make that obvious, spells out "Rule".
 */
function ruleNumber(id: string): string {
  return id.replace(/^R-/, '');
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// --- DOM ------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('lot');
const ctx = canvas.getContext('2d')!;
const frame = $('frame');
const overlay = $('overlay');
const sheet = $('sheet');
const stampMark = $<HTMLImageElement>('stamp-mark');


// --- Sprite loading -------------------------------------------------------

/**
 * Loads the ground tiles and any house sprites. Every failure path is
 * non-fatal: a missing tile falls back to a flat band, a missing house sprite
 * falls back to a hatched placeholder. Art arriving is an enhancement, never a
 * dependency, so content can be authored and played ahead of it.
 */
/** Dev cache-buster. python -m http.server sends no cache headers, so the
 *  browser applies heuristic caching and happily serves a stale index.json or
 *  sprite after the files on disk have changed — which looks exactly like the
 *  code ignoring your art. */
const CB = `?v=${Math.floor(Date.now() / 1000)}`;

/**
 * Marker drawn over a flagged object. Loaded as an Image rather than through
 * the sprite pipeline because it is UI, not world art: it sits on top of the
 * finished scene and must not scale with the house. Declared after CB, which
 * it uses — const is block-scoped, so referencing it earlier is a dead zone.
 *
 * A photo frame was tried here — marking a finding as photographing it — and
 * reverted. It read as an off-white rectangle rather than as a mark: over the
 * driveway, the sidewalk and the house it is light on light, and there is
 * nothing about a hollow box that says "cited". The X is loud, it is red, and
 * it means one thing. The camera stays in the cursor and the shutter sound.
 */
const xMark = new Image();
xMark.src = 'assets/x.png' + CB;
/** Claimed bounty. Green tick where the red X marks a citation — found, not cited. */
const checkMark = new Image();
checkMark.src = 'assets/checkmark.png' + CB;

/**
 * Beds follow where you are: the theme over the title and the briefing, the
 * neighborhood once you are out on the route, the office for the audit.
 */
const sound = new Sound(CB);

const residentSheet = new Image();
/**
 * The first lot can finish painting before this arrives, and the walk loop
 * only repaints on animation frames — which a backgrounded or on-demand
 * renderer may not deliver. Repaint once it lands so the resident is never
 * simply absent because the image was slow.
 */
residentSheet.onload = () => { if (currentCanvas) paint(); };
residentSheet.src = RESIDENTS.sheet + CB;

/** Roaming cats and dogs. Same late-arrival repaint, for the same reason. */
const animalSheet = new Image();
animalSheet.onload = () => { if (currentCanvas) paint(); };
animalSheet.src = ANIMALS.sheet + CB;

async function loadBitmap(url: string): Promise<{ w: number; h: number; rgba: Uint8ClampedArray } | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url + CB;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, rgba: d.data };
  } catch {
    return undefined;
  }
}

/**
 * Hide every OPEN notice on a lot of its own.
 *
 * Never the first lot of the round: the notice is what tells the player there
 * is anything to look for, so finding the animal before reading about it is not a
 * discovery, it is a coincidence. The level data lists the eligible lots.
 *
 * EVERY open notice, not just this level's. A flyer that stays up for three
 * rounds and can only be answered on the one round that has nothing of its own
 * is a flyer the player watches expire — miss Chaz on Wednesday and he has to
 * be somewhere on Friday. One bounty to a lot, because a lot is the unit
 * everything downstream searches.
 */
function placeBounty(): void {
  bountyLots.clear();
  const taken = new Set<string>([day.lots[0]?.lot_id]);
  for (const b of postedNotices()) {
    if (claimed.has(b.id)) continue;
    const pool = (b.eligible_lots ?? []).filter((id) => !taken.has(id) && LOTS[id]);
    // THE NOTICE OUTLIVES THE MAN. He is a night animal, so on a daylight round
    // the flyer is up and he is simply not on the street — no lot is assigned
    // and nothing places him, while the face is still drawn for the poster.
    if (b.id === 'thief' && !day.night) continue;
    if (!pool.length) continue;
    // Seeded off the level AND the notice, so two open bounties do not draw the
    // same number, and a given notice lands in the same place every replay.
    const rnd = seedFrom(`level${day.level_id}:${b.id}:bounty`);
    const lot = pool[Math.floor(rnd() * pool.length)];
    bountyLots.set(b.id, lot);
    taken.add(lot);
    // Drawn, not authored. The player is meant to RECOGNISE a face off a notice,
    // and a face that is the same every playthrough gets memorised instead.
    // Pinned if the level names one, drawn otherwise. The Poop Bandit is a face
    // you have to match and so must not be memorisable; the thief is the only
    // person crossing a lawn after dark and is meant to be recognised on sight.
    if (b.kind === 'person' && faceOf(b) === null) {
      // Remembered, so the poster shows the same man on every round it stays
      // up — the seed is per level, so a redraw would change him overnight.
      (saveFile.inspector.faces ??= {})[b.id] =
        b.character ? characterNamed(b.character) : Math.floor(rnd() * RESIDENTS.count);
      save(saveFile);
    }
  }
}

/** The notice hiding on this lot, if any is. */
function bountyOn(lotId: string | undefined): Bounty | null {
  if (!lotId) return null;
  for (const b of postedNotices())
    if (bountyLots.get(b.id) === lotId && !claimed.has(b.id)) return b;
  return null;
}

/** Whose face is on this notice. Pinned, remembered, or nobody's yet. */
function faceOf(b: Bounty): number | null {
  if (b.character) return characterNamed(b.character);
  return saveFile.inspector.faces?.[b.id] ?? null;
}

/** The bounty prop, if it is hiding on this lot and has not been claimed. */
function bountyPropFor(lot: LotSpec): PropSpec | null {
  const b = bountyOn(lot.lot_id);
  if (!b || b.kind === 'person' || b.kind === 'animal' || !b.sprite) return null;
  // Seeded off the lot so he is in the same place every time you visit it.
  const rnd = seedFrom(`${lot.lot_id}:${b.id}`);
  const spots = ['YARD_1', 'YARD_2', 'YARD_3', 'YARD_5', 'YARD_6', 'BED_FRONT'];
  return {
    id: b.id,
    sprite: b.sprite!,
    anchor: spots[Math.floor(rnd() * spots.length)],
    scale: b.scale,
    label: b.label,
    flaggable: true,
  };
}

/**
 * Cars that can be parked on a driveway.
 *
 * Every one of these is roadworthy. `car1redbad` — rusted, rear window out — is
 * deliberately NOT here: a derelict vehicle is a VIOLATION under R-204, and a
 * violation that appears at random cannot be adjudicated, because the lot's
 * truth data would not know about it. It wants authoring into a lot the way
 * weeds and bins are, not sprinkling.
 */
const PARKED_CARS = [
  'car1black', 'car1red', 'car1white',
  'car2white', 'car3cyber', 'car4blue', 'car5yellow',
  // Two-wheelers. Shorter than any car, so DRIVEWAY_2 clears them easily.
  'car6red', 'car7black', 'car7blue',
];

/**
 * Art that is loaded but never parked at random.
 *
 * car1redbad is a wreck — rust across the panels, rear window gone. Dropping it
 * into the ambient pool would put a derelict on an innocent driveway as
 * scenery, and a player who cites it takes a strike for reading the picture
 * correctly. It belongs to an inoperable-vehicle article, and until there is
 * one it stays out of the rotation and in the loader, so content can place it
 * deliberately the day that rule exists.
 */
const UNPARKED_CARS = ['car1redbad', 'car8green-bad', 'car9blue-bad'];

/**
 * Overgrown turf, in four tufts.
 *
 * Named here rather than left as loose strings because the compositor needs to
 * recognise them: grass is the one prop class that draws UNDER all the others,
 * so a tuft never covers a bin or a fence it happens to overlap.
 */
const TALL_GRASS = ['grass1', 'grass2', 'grass3', 'grass4'];

/**
 * The house plans, which are filed in assets/houses/ rather than at the top.
 *
 * The KEY stays bare — content says "house1", not "houses/house1" — because
 * where a file is filed is not part of the sprite's name, and moving art
 * between folders should not rewrite every level. assetDir() is the one place
 * that knows the difference.
 */
/**
 * The numbered plans. Each is a distinct building with its own driveway, walk
 * and fence line, and each has one measured anchor table in houses.json.
 */
const HOUSE_PLANS = [
  'house1', 'house2', 'house3', 'house4', 'house5', 'house6', 'house7',
  'house8', 'house9', 'house10', 'house11', 'house12', 'house13',
];

/**
 * Second dressings of a plan — the same house with the garage standing open.
 *
 * PURELY DECORATIVE. Nothing cites them and nothing behaves differently on
 * them; they exist so a street of thirteen plans does not read as thirteen
 * houses repeated. Listed here rather than derived, because only some plans
 * were drawn a second way.
 */
const HOUSE_ALTS = ['house7b', 'house8b', 'house10b', 'house13b'];

/**
 * Repainted versions of each plan — the same house with one thing wrong.
 *
 * Loaded up front rather than on demand: the compositor needs both the base and
 * the variant in hand to work out which pixels changed, and it composites
 * synchronously. All eighteen house files together are about 4.5MB, which is
 * what re-exporting the variants as JPEG bought.
 */
/**
 * When each article bites, lifted straight off the rulebook.
 *
 * Derived rather than restated: the binder page a player reads and the clock
 * the adjudicator runs are the same three fields, and a game where the book
 * says seven days and the code says five is worse than one with no book.
 */
const ARTICLE_TIMING: Record<string, ArticleTiming> = Object.fromEntries(
  (rulesData.articles as Array<Record<string, unknown>>).map((a) => [
    a.id as string,
    {
      weekday_window: a.weekday_window as string[] | undefined,
      season_window: a.season_window as { from: string; to: string } | undefined,
      grace_days: a.grace_days as number | undefined,
      alternate_weeks: a.alternate_weeks as { week_of: string } | undefined,
    },
  ]),
);

const HOUSE_VARIANTS = ['window', 'christmas'];
/**
 * Every house image that could exist. Used to resolve a PATH, not to decide
 * what to fetch — see HOUSE_LOADS.
 */
const HOUSE_SPRITES = [
  ...HOUSE_PLANS,
  ...HOUSE_ALTS,
  // The ALTS take variants too. A "b" dressing is the same plan with the garage
  // open, and it can have its lights up like any other — the cross product was
  // over the numbered plans alone, so house13b-christmas resolved to
  // assets/ rather than assets/houses/ and quietly failed to load.
  ...[...HOUSE_PLANS, ...HOUSE_ALTS].flatMap((h) => HOUSE_VARIANTS.map((v) => `${h}-${v}`)),
];

/**
 * THE HOUSES ACTUALLY FETCHED AT BOOT: every base, plus only the variants some
 * level asks for.
 *
 * The cross-product was 18 images and 4.5MB, all of it downloaded before the
 * title screen, and two thirds of the variants were referenced by nothing. This
 * reads the content instead, so an unused variant costs nothing and the moment
 * a level names one it loads without anybody touching this list.
 *
 * The BASE is always loaded, and the base is the compliant house — renderLot
 * falls back to it with `variant ?? baseHouse`. So a lot that had lights and
 * has taken them down just omits the field; there is no "fixed" model to ship
 * and no pairing to keep straight. What a missing variant costs is only that
 * THAT house can never show THAT violation.
 */
const HOUSE_LOADS = [
  ...HOUSE_PLANS,
  ...HOUSE_ALTS,
  ...new Set(
    LEVELS.flatMap((l) => l.lots.map((lot) => lot.house?.variant)).filter(Boolean) as string[],
  ),
];

/** Subfolder for a sprite key, '' for the ones at the top of assets/. */
function assetDir(name: string): string {
  return HOUSE_SPRITES.includes(name) ? 'houses/' : '';
}

const ASSET_FILES = [
  'grass', 'road', 'sidewalk',
  ...HOUSE_LOADS,
  'fence1', 'fence2', 'fence3',
  'weed1', 'weed2', 'weed3', 'trash-green', 'trash-brown',
  // Signage. Nothing in the declaration covers it, which is the entire reason
  // it is on a lawn the player is being asked to judge.
  'yard-sign',
  // Overgrown turf. Four tufts so a lawn that has got away from its owner does
  // not read as the same clump stamped five times.
  ...TALL_GRASS,
  // Posted notices — the missing-animal flyer, and anything pinned up later.
  'pin',
  ...PARKED_CARS,
  ...UNPARKED_CARS,
  // Loaded so content can reference them before any lot places them: R-107
  // clutter and recreational vehicles. Missing sprites are skipped at render,
  // so listing them early costs nothing but a fetch.
  'couch', 'washer', 'dryer', 'boxes', 'rv1', 'rv2',
  /**
   * EVERY PROP THE CONTENT ACTUALLY PLACES, read from the levels.
   *
   * A sprite named by a lot and missing from this list does not 404 — the
   * compositor skips a prop it has no art for and the lot renders without it,
   * silently. `dumpster` and `storage` had been authored into Shift 5 and never
   * added here, so a driveway the content says has a storage pod on it had
   * nothing on it at all. Reading the content is the only version of this list
   * that cannot fall behind the content.
   */
  ...new Set(LEVELS.flatMap((l) => l.lots.flatMap((lot) =>
    ((lot as { props?: { sprite: string }[] }).props ?? []).map((p) => p.sprite)))),
  // Notices carry art of their own, and a bounty prop is placed at runtime.
  ...new Set(LEVELS.map((l) => (l as { bounty?: Bounty }).bounty?.sprite).filter(Boolean) as string[]),
  // Bounty art, referenced straight out of its delivered folder. Copying one
  // frame out to assets/chaz.png would work today and be stale the moment the
  // animal is re-exported.
  'animals/cat-chaz/walking/rotations/south',
];

/** How much clear paving to leave between two cars, and outside the pair. */
const CAR_GAP = 0.012;
/** Of the lots that get a car at all, how many get a second one beside it. */
const SECOND_CAR_CHANCE = 0.35;

/** A prop's width as a fraction of the house rect it is drawn against. */
function propWidth(sprite: string): number {
  const spr = assets.sprites.get(sprite);
  return spr ? spr.w / HOUSE_NATIVE.w : 0.14;
}

/**
 * A prop's DRAWN height as a fraction of the house rect. Ink, not canvas — the
 * vehicle art carries a baked shadow and a margin, and lining two of them up by
 * the canvas would leave a visible step.
 */
function propHeight(sprite: string): number {
  const spr = assets.sprites.get(sprite);
  return spr ? solidHeight(spr) / HOUSE_NATIVE.h : 0.2;
}

/** What a driveway holds. Two, whoever put them there. */
const DRIVEWAY_SLOTS = 2;
/**
 * The row two things park on, and it is the STREET end.
 *
 * DRIVEWAY_1/2/3 are 0.13 of the house apart and every prop that stands on a
 * driveway is between 0.20 and 0.42 of the house TALL — a dumpster anchored at
 * _3 reaches past _1. So the three anchors were never three parking spaces;
 * anything on two of them overlapped, and the higher one ran into the garage
 * door. Two things go side by side on one row or they do not go at all.
 */
const DRIVEWAY_ROW = 'DRIVEWAY_3';
/**
 * How far up the run everything parks, as a fraction of the house height.
 *
 * The anchors put a vehicle's wheels almost on the sidewalk. Cars pull IN — a
 * driveway is not a kerbside space — so the whole slot lifts by this much.
 */
const DRIVEWAY_LIFT = 0.05;

/**
 * Lay out the driveway: the content's vehicles, plus an ambient car or two.
 *
 * Returned as a COPY, so `current` stays the authored lot: the car is scenery,
 * and the case file, first-seen tracking and adjudication should all carry on
 * seeing exactly the props the content declares. Re-anchoring is part of the
 * same copy — it changes where a thing is DRAWN and nothing else.
 *
 * TWO ABREAST OR ONE IN THE MIDDLE. A single vehicle keeps the anchor it was
 * given; a pair is centred as a group on the street end of the run, which is
 * the only arrangement this art can hold without one sprite standing in
 * another.
 *
 * AND A SECOND CAR IS OFFERED, NOT ASSUMED. Driveways in this set run from
 * 0.256 of the house width to 0.461, and the props from 0.077 to 0.159 — so the
 * widest pair fits house6 and nothing like house11. The test is against the
 * measured pair and the measured driveway, not a blanket rule. The CONTENT gets
 * the slots first: a lot the level already parked two derelicts on takes no
 * ambient car at all.
 */
function withParkedCar(lot: LotSpec): LotSpec {
  const rnd = seedFrom(`${lot.lot_id}:car`);
  const authored = (lot.props ?? []).filter((p) => p.anchor.startsWith('DRIVEWAY'));
  const free = DRIVEWAY_SLOTS - authored.length;
  const span = drivewaySpan(lot) ?? 0;

  const ambient: PropSpec[] = [];
  if (rnd() >= 0.4) {
    const pick = () => PARKED_CARS[Math.floor(rnd() * PARKED_CARS.length)];
    const first = pick();
    // Drawn BEFORE the fit test so the roll sequence does not depend on the
    // answer: a house that turns out to be too narrow must still leave the next
    // lot's seed where it would have been. Same reason the slot count is
    // applied after — a full driveway must not reshuffle the rest of the street.
    const second = rnd() < SECOND_CAR_CHANCE ? pick() : null;
    // Clickable, like everything else on the lot. A car parked on its own
    // driveway is not a violation of anything live, so citing one is a false
    // positive and takes the strike — which is the whole point of being able
    // to click things that are fine.
    const car = (sprite: string, n: number): PropSpec => ({
      // The id carries the slot, not just the sprite: two of the same model on
      // one driveway would otherwise share an id, and the id is what the
      // Findings pad and the click buffer key on.
      id: `car${n}_${sprite}`,
      sprite, anchor: 'DRIVEWAY_2', label: 'Vehicle, driveway', flaggable: true,
      nudgeY: -liftFor(lot, 'DRIVEWAY_2', propHeight(sprite)),
    });
    if (free >= 2 && second !== null && fits(first, second, span)) {
      ambient.push(car(first, 1), car(second, 2));
    } else if (free >= 1) {
      ambient.push(car(first, 1));
    }
  }

  // An ambient car has to fit beside whatever the CONTENT already parked, not
  // just beside another ambient car. house13's run is 0.264 of the house and a
  // storage pod is 0.159 of it — a car alongside overhangs the grass, so the
  // car goes rather than the pod. The content's props are never dropped.
  if (authored.length === 1 && ambient.length === 1
      && !fits(authored[0].sprite, ambient[0].sprite, span)) ambient.length = 0;

  let props = [...(lot.props ?? []), ...ambient];
  let changed = ambient.length > 0;
  const occupants = [...authored, ...ambient];
  if (occupants.length === 2) {
    changed = true;
    const [a, b] = occupants;
    const wa = propWidth(a.sprite);
    const wb = propWidth(b.sprite);
    const total = wa + wb + CAR_GAP;
    /**
     * NOSE TO NOSE, not bumper to bumper.
     *
     * An anchor is where a prop meets the GROUND, so two sprites on one row
     * line up by their back ends — and a motorbike beside a pickup then looks
     * like it is parked halfway down the road. Aligning the TOPS means the
     * shorter one pulls further up the drive, which is where it would be.
     */
    const tallest = Math.max(propHeight(a.sprite), propHeight(b.sprite));
    // One lift for the pair, set by the TALLER of them — they are meant to move
    // together, and clamping each separately would pull them apart again.
    const up = liftFor(lot, DRIVEWAY_ROW, tallest);
    const lift = (p: PropSpec) => -(tallest - propHeight(p.sprite)) - up;
    // Centred as a PAIR, so the two together sit where one would have.
    const moved = new Map<PropSpec, PropSpec>([
      [a, { ...a, anchor: DRIVEWAY_ROW, nudge: -(total - wa) / 2, nudgeY: lift(a) }],
      [b, { ...b, anchor: DRIVEWAY_ROW, nudge: (total - wb) / 2, nudgeY: lift(b) }],
    ]);
    props = props.map((p) => moved.get(p) ?? p);
  }

  const bounty = bountyPropFor(lot);
  if (bounty) { props.push(bounty); changed = true; }
  return changed ? { ...lot, props } : lot;
}

/** Do these two stand side by side on a driveway this wide? */
function fits(a: string, b: string, span: number): boolean {
  return propWidth(a) + propWidth(b) + CAR_GAP * 3 <= span;
}

/** An anchor's height on this lot's plan, falling back to the shared table. */
function anchorHy(lot: LotSpec, name: string): number {
  const plan = housePlan(lot.house?.sprite ?? '');
  const over = (housesData as { houses?: Record<string, { anchors?: Record<string, { hy: number }> }> })
    .houses?.[plan]?.anchors?.[name];
  return over?.hy ?? DEFAULT_ANCHORS[name]?.hy ?? 0;
}

/**
 * How far up the run something this tall may pull, without ending up inside the
 * garage.
 *
 * The garage face is measured per plan — it is where the apron anchors sit —
 * and a sprite hangs UP the screen from its anchor, so the lift a lot can give
 * is whatever is left between the row, the prop's own height and that face. A
 * dumpster is nearly twice a car's height and eats all of it; a motorbike has
 * room to spare. Asking every lot for the same 0.05 put a skip through a
 * garage door.
 */
function liftFor(lot: LotSpec, row: string, height: number): number {
  const room = anchorHy(lot, row) - height - anchorHy(lot, 'APRON_1') - 0.01;
  return Math.max(0, Math.min(DRIVEWAY_LIFT, room));
}

/** The paved run, as [left, right] fractions of the house rect. */
function drivewaySpan(lot: LotSpec): number | undefined {
  const id = lot.house?.sprite;
  if (!id) return undefined;
  const d = (housesData as any).houses?.[housePlan(id)]?.drive;
  return Array.isArray(d) ? d[1] - d[0] : undefined;
}

/**
 * Where this lot's driveway runs, as a fraction across the house rect.
 *
 * Read from the same generated table the compositor uses, and mirrored the same
 * way, so it cannot drift from where the driveway is actually drawn. Undefined
 * for a house with no driveway anchors.
 */
function drivewayFraction(lot: LotSpec): number | undefined {
  const id = lot.house?.sprite;
  if (!id) return undefined;
  const a = (housesData as any).houses?.[id]?.anchors?.DRIVEWAY_2
    ?? (housesData as any).houses?.[id]?.anchors?.DRIVEWAY_1;
  if (!a || typeof a.hx !== 'number') return undefined;
  return lot.house?.mirror ? 1 - a.hx : a.hx;
}

/** Strip the _-prefixed documentation keys out of the authored override data. */
function houseAnchorTable(): Record<string, Record<string, { hx: number; hy: number }>> {
  const out: Record<string, Record<string, { hx: number; hy: number }>> = {};
  for (const [id, h] of Object.entries((housesData as any).houses ?? {})) {
    const anchors = (h as any).anchors ?? {};
    const t: Record<string, { hx: number; hy: number }> = {};
    for (const [name, a] of Object.entries(anchors as Record<string, any>))
      if (a && typeof a.hx === 'number' && typeof a.hy === 'number') t[name] = { hx: a.hx, hy: a.hy };
    out[id] = t;
  }
  return out;
}

async function loadAssets(): Promise<SceneAssets> {
  const sprites = new Map<string, { w: number; h: number; rgba: Uint8ClampedArray }>();
  await Promise.all(
    ASSET_FILES.map(async (name) => {
      // The houses shipped as JPEGs; everything else is PNG. Try both rather
      // than encoding the extension into content — but try the LIKELY one
      // first, or every load opens with six 404s for house PNGs that have
      // never existed.
      for (const ext of HOUSE_SPRITES.includes(name) ? ['jpg', 'png'] : ['png', 'jpg']) {
        const b = await loadBitmap(`assets/${assetDir(name)}${name}.${ext}`);
        if (b) { sprites.set(name, b); return; }
      }
    }),
  );
  return { sprites, houseAnchors: houseAnchorTable() };
}

// --- Session state --------------------------------------------------------
let assets: SceneAssets = { sprites: new Map() };
let currentCanvas: HTMLCanvasElement | null = null;
/** The same scene with only the props kept, for depth-ordering against people. */
let currentProps: HTMLCanvasElement | null = null;
/** The lit part of this lot's house, drawn back over the night wash. */
let currentGlow: HTMLCanvasElement | null = null;
let sliding = false;
/**
 * The resident on this lot, if any. Null on lots that have nobody out.
 *
 * The tool travels WITH the walker rather than in a second global, so the two
 * cannot end up disagreeing and animating a hoe stroke out of a walk row.
 */
type Resident = { walker: Walker; work: ToolWork | null; bark: BarkState | null };
let resident: Resident | null = null;
/** People passing along the sidewalk. Drains as they leave; never refills. */
let passersby: Passerby[] = [];
/**
 * A dog walking the sidewalk with somebody, rather than loose in a yard.
 *
 * Shaped as a Passerby so it steps, remaps on resize and leaves the frame
 * through the same code the people do — the only difference is which sheet it
 * is drawn from, which is what `which` carries.
 */
type Escort = Passerby & { which: number };
let escort: Escort | null = null;
/** An animal pottering about this lot, if one turned up. */
let animal: { which: number; walker: Walker } | null = null;
/**
 * The bounty pet, on the lot it is hiding on.
 *
 * Its own slot rather than reusing `animal`, because a lot can have both — the
 * resident's cat wandering the lawn AND the missing one the notice is about,
 * which is exactly the confusion that makes the search worth doing.
 */
let bountyAnimal: { which: number; walker: Walker } | null = null;
/** What the barks on this lot are allowed to gate on. Rebuilt per lot. */
let barkCtx: BarkContext = { facts: new Set() };
let walkerLast = 0;
let walkerRaf = 0;
let routeIndex = 0;
let current: LotSpec;
let rendered: RenderedLot;
let flagged = new Set<string>();
/**
 * Bounties claimed this round, and what they paid.
 *
 * Kept OUT of `flagged` on purpose. A bounty is not a finding: it must not
 * reach adjudication, must not count toward accuracy, and must not turn a
 * clean lot into a citation. Clicking the animal is noticing, not enforcing.
 */
let claimed = new Set<string>();
let bountyPay = 0;
/** This shift's fine bonuses, for the stub. The balance already has them. */
let fineBonus = 0;
/**
 * The balance AS SHOWN, which is not the balance.
 *
 * Pay is banked the moment a lot is stamped and a finder's fee the moment it is
 * claimed, and a figure that ticked up on each of those turned the route sheet
 * into a score counter — reward for getting through the street rather than for
 * getting it right, and visible before the audit has said whether any of it was
 * right. It is worse than noise: the number went UP on a lot you got wrong.
 *
 * So the sheet holds the figure it opened the shift with and settles once, at
 * the audit, by the round's whole net. `saveFile.inspector.pay` is still the
 * truth and is still written through on every stamp — this is only what the
 * desk is willing to say before the Board has looked at your work.
 */
let bankShown = saveFile.inspector.pay;
/**
 * Which lot each OPEN notice is hiding on this round, by bounty id.
 *
 * A map rather than one lot: several notices can be up at once now, and each
 * gets a lot to itself. The face that goes with a person bounty lives in the
 * save (`inspector.faces`) rather than beside this, because a poster outlives
 * the round that drew it.
 */
const bountyLots = new Map<string, string>();
/** Where the tick goes once he is gone from the scene. */
let bountyMark: { x: number; y: number } | null = null;
let outcomes: LotOutcome[] = [];
let stamping = false;

// --- The office calling ---------------------------------------------------

/**
 * A wrong determination is not corrected on the lot it happened on.
 *
 * The audit at the end of the shift is still where the reasoning lands — what
 * was missed, what was overturned, why. This is only the Association noticing,
 * and it deliberately arrives AFTER the pan: you have stamped the file, driven
 * away, and are looking at somebody else's yard when the phone goes. There is
 * nothing to do about it, which is the whole feeling.
 */
const PHONE_TEXT = 'Incorrect determination: your failure has been noted';
/** A beat into the next lot. Long enough that it reads as a call, not a click. */
const PHONE_DELAY_MS = 1500;
/** How long it stays up. Long enough to read the screen twice. */
const PHONE_HOLD_MS = 6000;
/** Set by a wrong stamp, spent on arrival at the next lot. */
let phonePending = false;
let phoneTimers: number[] = [];

/** Put it away and cancel anything in flight. Safe to call when it is down. */
function hangUp(): void {
  for (const t of phoneTimers) clearTimeout(t);
  phoneTimers = [];
  $('phone').classList.remove('up');
}

/**
 * Called on arrival at every lot. Rings only if the lot BEFORE this one was
 * stamped wrong — the flag is consumed either way, so one bad call is one
 * phone call and never carries past the next address.
 */
function phoneOnArrival(): void {
  hangUp();
  if (!phonePending) return;
  phonePending = false;
  $('phone-text').textContent = PHONE_TEXT;
  phoneTimers.push(
    setTimeout(() => {
      sound.play('error');
      $('phone').classList.add('up');
      phoneTimers.push(setTimeout(hangUp, PHONE_HOLD_MS) as unknown as number);
    }, PHONE_DELAY_MS) as unknown as number,
  );
}

// --- Rendering ------------------------------------------------------------

/**
 * Each lot is rendered once into its own canvas so the transition can slide
 * two finished images past each other with drawImage, instead of recompositing
 * ~900k pixels twice a frame in JS. The scene renders in tens of milliseconds,
 * which is fine once but nowhere near a 60fps budget.
 */
function renderToCanvas(lot: LotSpec, worldX: number): { rl: RenderedLot; cv: HTMLCanvasElement } {
  const { w, h } = stageSize();
  const rl = renderLot(withParkedCar(lot), assets, w, h, worldX, zoom);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')!.putImageData(rl.raster.toImageData(), 0, 0);
  return { rl, cv };
}

/**
 * The props on their own, cut out of the finished scene by their coverage.
 *
 * Built once per lot so the paint pass can put a bin back over somebody
 * standing behind it WITH ITS OWN SILHOUETTE. Re-blitting the bin's bounding
 * rectangle instead drags along whatever is inside the box, and a bin is only
 * about 70% solid — the other 30% is sidewalk, which then lands on the
 * pedestrian's head.
 *
 * Color comes from the composited scene rather than the source sprite, so the
 * prop keeps the exact pixels it was drawn with; only the alpha is restored.
 */
/**
 * The glowing part of a house variant, lifted back out of the finished scene.
 *
 * The night wash goes over everything, which is right for a lawn and wrong for
 * a string of lights — the whole point of lights is that the dark does not
 * land on them. Those pixels are already identified: stampVariant claimed them
 * in the id buffer, so this is a lookup rather than a second diff.
 *
 * FEATHERED, because the mask is a pixel diff and pixel diffs have terrible
 * edges. A bulb differs from the roof behind it by a lot at its centre and by
 * very little at its rim, so the threshold cuts a ragged, speckled outline —
 * fine as a hit region, which is what it was built for, and very obvious as a
 * lighting edge against a dark wash.
 *
 * The blur is applied to the MASK ALONE and the sharp scene is then punched
 * through it, so nothing in the picture is softened: the lights keep every
 * pixel they were drawn with, and only how much of the night they hold off
 * varies across the edge. Blurring the composited layer instead would smear
 * the bulbs.
 *
 * The colour punched through is the whole scene, not just the masked pixels,
 * which is what lets the feather spread OUTWARD as well as in — a few pixels
 * of un-washed roof around each bulb. That is not an artifact to be tolerated;
 * it is what light falling on a surface looks like.
 *
 * Returns null when the lot has no glowing variant, which is almost always.
 */

/** How far the glow is feathered, in device pixels. Enough to kill the stair
 *  steps, short of a halo you would notice as a halo. */
const GLOW_FEATHER = 2;

function glowLayerFor(rl: RenderedLot, lot: LotSpec): HTMLCanvasElement | null {
  if (!lot.house?.variantGlows || !lot.house.variantId) return null;
  const obj = rl.objects.find((o) => o.id === lot.house!.variantId);
  if (!obj) return null;
  const { w, h } = rl.raster;
  const src = rl.raster.color;
  const id = rl.raster.id;

  // Two layers off one pass: where the glow is, and what the scene looks like
  // there. The scene is forced opaque — it is the bottom of the picture, and
  // the mask is the only thing that gets to decide what shows.
  const mask = new ImageData(w, h);
  const scene = new ImageData(w, h);
  let any = false;
  for (let p = 0, i = 0; p < id.length; p++, i += 4) {
    scene.data[i] = src[i];
    scene.data[i + 1] = src[i + 1];
    scene.data[i + 2] = src[i + 2];
    scene.data[i + 3] = 255;
    if (id[p] !== obj.key) continue;
    mask.data[i + 3] = 255;
    any = true;
  }
  // A variant that claimed nothing would otherwise cost a full-frame blur to
  // produce an empty canvas on every lot of the level.
  if (!any) return null;

  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sc = scratch.getContext('2d')!;
  sc.putImageData(mask, 0, 0);

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.filter = `blur(${GLOW_FEATHER}px)`;
  g.drawImage(scratch, 0, 0);
  g.filter = 'none';
  // source-in multiplies the incoming alpha by what is already there, so the
  // soft mask becomes the alpha of the sharp scene. Order matters: mask first.
  g.globalCompositeOperation = 'source-in';
  // putImageData overwrites everything including alpha, so the scratch canvas
  // is reused rather than cleared.
  sc.putImageData(scene, 0, 0);
  g.drawImage(scratch, 0, 0);
  return cv;
}

function propLayerFor(rl: RenderedLot): HTMLCanvasElement {
  const { w, h } = rl.raster;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const img = new ImageData(w, h);
  const src = rl.raster.color;
  const cov = rl.raster.cov;
  for (let p = 0, i = 0; p < cov.length; p++, i += 4) {
    if (!cov[p]) continue;
    img.data[i] = src[i];
    img.data[i + 1] = src[i + 1];
    img.data[i + 2] = src[i + 2];
    img.data[i + 3] = cov[p];
  }
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return cv;
}

function stageSize(): { w: number; h: number } {
  const r = frame.getBoundingClientRect();
  return { w: Math.max(320, Math.round(r.width)), h: Math.max(320, Math.round(r.height)) };
}

/**
 * How far off the auto-fit house scale the player has asked to be.
 *
 * The fit is chosen for the window (see layout()), and on a laptop it is often
 * a whole notch smaller than the room actually allows — the ladder is coarse,
 * so a stage that could take 0.44 gets 1/3 and the house sits in a field of
 * grass. This is the manual override for that, and it is per-machine rather
 * than per-save: it describes the screen the game is being played on, not the
 * inspector.
 */
const ZOOM_KEY = 'addison.zoom';
let zoom = (() => {
  const n = Number(localStorage.getItem(ZOOM_KEY));
  return Number.isFinite(n) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.trunc(n))) : 0;
})();

function setZoom(next: number): void {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  if (z === zoom) return;
  zoom = z;
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    /* private browsing; the setting simply does not persist */
  }
  syncZoomButtons();
  relayout();
}

/** Greyed at the ends of the ladder, so a dead button says why it is dead. */
function syncZoomButtons(): void {
  const inb = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const out = document.getElementById('zoom-out') as HTMLButtonElement | null;
  if (inb) inb.disabled = zoom >= ZOOM_MAX;
  if (out) out.disabled = zoom <= ZOOM_MIN;
}

/**
 * Night.
 *
 * One flat wash over the finished scene rather than re-lighting the art: the
 * houses, props, residents and animals all go under it together, so nothing can
 * be lit inconsistently with anything else.
 *
 * A FUNCTION, not two copies of a fillRect, because the scene reaches the
 * screen by two routes — paint() for a lot you are standing at, and the pan
 * between lots, which blits the two lot canvases itself. The pan missed the
 * wash when it was inline, so the street turned to daylight for the length of
 * the drive and back to night on arrival.
 *
 * Applied after the world and before anything the PLAYER put on it. A red X you
 * cannot read in the dark is not atmosphere, it is a bug — the same reason the
 * Findings pad sits in the DOM above the canvas entirely.
 */
function washNight(w: number, h: number, glows: Array<[HTMLCanvasElement | null, number]> = [[currentGlow, 0]]): void {
  if (!day.night) return;
  ctx.fillStyle = 'rgba(5, 11, 25, .7)';
  ctx.fillRect(0, 0, w, h);
  /**
   * ...and then take the dark back off anything that makes its own light.
   *
   * Drawn from the layer stampVariant's mask produced, so what shines is
   * exactly what the artist painted onto the house and nothing else. This is
   * why the diff is worth keeping after compositing: the same set of pixels
   * that answers "what did you click" also answers "what is lit".
   *
   * Inside washNight rather than beside it, so the pan between lots gets it
   * too — the wash and the glow are one effect and cannot come apart.
   *
   * PLACED, not pinned. The layer is drawn for a lot sitting at the origin,
   * which is true right up until two lots are on the canvas at once and both
   * are moving. Defaulting to the current lot at zero kept it nailed to the
   * screen through the pan, so a lit house left its lights hanging in the air
   * over the one that followed it.
   */
  for (const [g, x] of glows) if (g) ctx.drawImage(g, x, 0);
}

function paint(): void {
  const { w, h } = stageSize();
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.imageSmoothingEnabled = false;
  if (currentCanvas) ctx.drawImage(currentCanvas, 0, 0);
  else ctx.putImageData(rendered.raster.toImageData(), 0, 0);
  drawWalker();
  washNight(w, h);

  // Flag markers, drawn over the finished scene. Half native size (104x117 ->
  // 52x59), an exact halving so the pixel grid survives the downscale.
  const MW = 52;
  const MH = 59;

  // Claimed bounty: a green tick where he was, held until the round ends. The
  // animal himself is gone from the scene — the tick is the receipt.
  const claimedHere = [...bountyLots].find(([id, lot]) => lot === current?.lot_id && claimed.has(id));
  if (claimedHere && checkMark.complete && checkMark.naturalWidth) {
    const spot = bountyMark;
    if (spot) ctx.drawImage(checkMark, Math.round(spot.x - MW / 2), Math.round(spot.y - MH / 2), MW, MH);
  }

  for (const id of flagged) {
    const obj = rendered.objects.find((o) => o.id === id);
    if (!obj) continue;
    const c = centroid(obj.key);
    if (!c) continue;
    if (xMark.complete && xMark.naturalWidth) {
      ctx.drawImage(xMark, Math.round(c.x - MW / 2), Math.round(c.y - MH / 2), MW, MH);
    } else {
      // The marker must never be invisible: a flagged object the player cannot
      // see they flagged is worse than an ugly one.
      ctx.strokeStyle = '#e8452f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c.x - 16, c.y - 16); ctx.lineTo(c.x + 16, c.y + 16);
      ctx.moveTo(c.x + 16, c.y - 16); ctx.lineTo(c.x - 16, c.y + 16);
      ctx.stroke();
    }
  }
}

/**
 * Give roughly every other lot somebody out front.
 *
 * Seeded from the lot id, so a given address always has the same resident
 * doing the same thing — the street should feel populated, not randomised on
 * every visit. Their patch is the front lawn between the house and the walk.
 */
function makeWalker(lot: LotSpec, rl: RenderedLot): Resident | null {
  const rnd = seedFrom(lot.lot_id);
  // A wanted person has to be findable, so on their lot somebody is always out
  // and it is always them. Everywhere else the usual roll applies.
  const here = bountyOn(lot.lot_id);
  const wantedFace = here?.kind === 'person' ? faceOf(here) : null;
  const wanted = wantedFace !== null;
  /**
   * AFTER DARK NOBODY IS OUT ON THEIR OWN LAWN.
   *
   * Not "almost nobody" — nobody. Residents are in for the night, and the only
   * figure crossing a yard is somebody who has no business in it. That is what
   * makes a night round read differently: a person on the grass stops being
   * scenery and becomes the thing you noticed. The sidewalk still has traffic,
   * so the street is quiet rather than abandoned.
   *
   * The bounty is the one exception, and on Shift 3 it is the WHOLE point: the
   * thief is a reported figure with a notice up, and he is the only person
   * you will see on grass after dark. He used to turn up loose on a third of
   * night lots with nothing attached to him, which made him scenery — the thing
   * a night round most needed not to have.
   */
  const thieving = day.night && wanted;
  if (!wanted && (day.night || rnd() < 0.45)) return null; // in for the night, or in anyway
  // Out working, and with what. Drawn from a SEPARATE seed rather than the next
  // number in this stream, so adding tools did not reshuffle who stands where.
  // A thief carries nothing: he is not out doing yard work.
  const trnd = seedFrom(`${lot.lot_id}:tool`);
  const tool = thieving ? null : trnd() < 0.4 ? Math.floor(trnd() * TOOL_NAMES.length) : null;
  const L = rl.layout;
  const top = L.house.y + L.house.h * 0.82;
  const bottom = L.walkTop - 14;
  if (bottom - top < 30) return null;
  // Walking pace, derived rather than dialled in: a house frontage is roughly
  // 50ft and a person walks about 4.5ft/s, so a shade under a tenth of the
  // house's width per second. A flat pixel constant looked right at one window
  // size and glacial at every other.
  // Somebody working is working on the LAWN. The driveway runs down one side of
  // every house, so a worker goes on the wider grass side of it — a resident
  // hoeing the concrete would be a strange thing to render. Wanderers are left
  // alone: crossing your own driveway is a perfectly ordinary thing to do.
  let x0 = L.w * 0.08;
  let x1 = L.w * 0.92;
  const dfrac = tool === null ? undefined : drivewayFraction(lot);
  if (dfrac !== undefined) {
    const edge = L.house.x + dfrac * L.house.w;
    const margin = L.house.w * 0.1;
    if (edge > L.house.x + L.house.w / 2) x1 = Math.max(x0 + 1, edge - margin);
    else x0 = Math.min(x1 - 1, edge + margin);
  }
  // Three times a walking pace on the hunt lot. He is not strolling: the music
  // is running and he knows it. Also the only thing that makes four darts a
  // real budget rather than four chances to click a slow-moving target.
  const speed = L.house.w * 0.085 * (thieving ? 3 : 1);
  // Weighted, not uniform — see pickCharacter for why the skin mix depends on it.
  // The wanted face is whatever the notice printed, pinned or drawn.
  const character = wanted ? wantedFace! : pickCharacter(rnd);
  // Somebody out with a hoe is working a patch of yard, not touring it. Speed
  // zero rather than a separate stationary type: the walker still keeps time,
  // which is what the tool animation cuts its frames from.
  const walker = new Walker(character, { x0, x1, y0: top, y1: bottom }, rnd,
    tool === null ? speed : 0);
  // He barely stops. Three times the pace is not much use if he spends the
  // clock standing in the middle of the lawn being easy to hit.
  if (thieving) walker.dwell = 0.15;
  const work = tool === null ? null : new ToolWork(tool, seedFrom(`${lot.lot_id}:work`));
  // Not everybody has anything to say. Two thirds do; the rest just get on
  // with it, which is what stops the street sounding like a chorus. The thief
  // says nothing at all — the owner lines are all about MY fence, MY lawn.
  const brnd = seedFrom(`${lot.lot_id}:bark`);
  const bark = thieving ? null
    : brnd() < 0.66 ? new BarkState('owner', brnd, 1 + brnd() * 3) : null;
  return { walker, work, bark };
}

/**
 * What is true about this lot, for gating barks.
 *
 * Props come from the lot; the citation history comes from the save, so a
 * resident who has been fined before can say so and one who has not cannot.
 */
function barkContextFor(lot: LotSpec): BarkContext {
  const facts = factsFromProps((lot.props ?? []).map((p) => p.sprite));
  const rec = saveFile.addresses[lot.lot_id];
  for (const r of rec?.rulings ?? []) {
    if (r.verdict !== 'PASS') facts.add('cited');
    if (r.verdict === 'PASS') facts.add('passed');
  }
  const month = Number(today.iso.slice(5, 7));
  if (month >= 6 && month <= 9) facts.add('hot');
  if (today.weekday === 'Wednesday') facts.add('trashday');
  return { facts };
}

/**
 * A animal, on about a third of lots.
 *
 * Its own seed, so adding cats did not reshuffle who lives where or who is
 * walking past. It roams the same yard band the resident does and is not
 * kept off the driveway — a animal has no opinion about paving.
 */
function makeAnimal(lot: LotSpec, rl: RenderedLot): { which: number; walker: Walker } | null {
  const rnd = seedFrom(`${lot.lot_id}:animal`);
  // A level can name the animal on a lot, in which case it is there every time
  // rather than a third of the time — the roll is still drawn so that pinning
  // one lot does not shift the wander of any other.
  const pinned = cameoOn(lot.lot_id)?.animal;
  const rolled = rnd() < (day.night ? 0.6 : 0.35);
  // More of them after dark, not fewer: the lawns have emptied of people, and
  // wildlife on an empty street is the whole point of running a round at night.
  if (!pinned && !rolled) return null;
  const L = rl.layout;
  const top = L.house.y + L.house.h * 0.8;
  const bottom = L.walkTop - 10;
  if (bottom - top < 24) return null;
  // Cats and dogs by day; the armadillo and the raccoon join them after dark.
  // Drawing from the allowed list rather than rolling over every row keeps the
  // roll in the same place in the stream whichever set is in play.
  // The level's own roster if it has one; the sheet's day/night flags otherwise.
  const abroad = day.ambient_animals?.length
    ? day.ambient_animals.map(animalNamed)
    : animalsAbroad(day.night === true);
  if (!abroad.length) return null;
  const pick = Math.floor(rnd() * abroad.length);
  return {
    which: pinned ? animalNamed(pinned) : abroad[pick],
    // Slower than a person and with the Walker's own habit of stopping, which
    // between them is most of what reads as "animal" rather than "small person".
    walker: new Walker(0, { x0: L.w * 0.06, x1: L.w * 0.94, y0: top, y1: bottom }, rnd, L.house.w * 0.05),
  };
}

/**
 * The missing pet, roaming the lot it is on.
 *
 * Same wander as any stray — it is a cat, not a quest marker — but seeded off
 * the lot AND the bounty so adding one did not move the resident's own animal.
 * Gone the moment it is claimed: the tick left behind is the receipt.
 */
function makeBountyAnimal(lot: LotSpec, rl: RenderedLot): { which: number; walker: Walker } | null {
  const b = bountyOn(lot.lot_id);
  if (!b || b.kind !== 'animal' || !b.animal) return null;
  const L = rl.layout;
  const top = L.house.y + L.house.h * 0.8;
  const bottom = L.walkTop - 10;
  if (bottom - top < 24) return null;
  const rnd = seedFrom(`${lot.lot_id}:${b.id}:roam`);
  /**
   * A HUNTED animal moves like the thief, not like a lost cat.
   *
   * Domino is meant to be found — she ambles, and the game is spotting her. The
   * armadillo is meant to be HIT, on the same four darts and the same thirty
   * seconds, and at a cat's pace that budget stops being a budget. Three times
   * the pace and almost no standing still, exactly as makeWalker does for him.
   */
  const speed = L.house.w * 0.05 * (b.hunt ? 3 : 1);
  const walker = new Walker(0, { x0: L.w * 0.06, x1: L.w * 0.94, y0: top, y1: bottom }, rnd, speed);
  if (b.hunt) walker.dwell = 0.15;
  return { which: animalNamed(b.animal), walker };
}

/** The band a passerby's feet may land in. */
function sidewalkOf(rl: RenderedLot): Sidewalk {
  return { w: rl.layout.w, top: rl.layout.walkTop, bottom: rl.layout.roadTop };
}

/**
 * 0-2 people on the walk, seeded off the lot so an address is consistent.
 *
 * A separate seed again, so adding foot traffic did not reshuffle the resident
 * or their tool on any lot that already had one.
 */
function makeTraffic(lot: LotSpec, rl: RenderedLot, taken: number[] = []): Passerby[] {
  const rnd = seedFrom(`${lot.lot_id}:walk`);
  const r = rnd();
  // Weighted rather than a flat third each: an always-empty sidewalk half the
  // time reads as nobody living here.
  const count = r < 0.3 ? 0 : r < 0.75 ? 1 : 2;
  const out = makePassersby(sidewalkOf(rl), rnd, count, taken);
  // Most of them are thinking about something. They draw only from the lines a
  // stranger could say: no "my fence", no citations against them.
  for (const p of out) p.bark = rnd() < 0.6 ? new BarkState('passer', rnd, 2 + rnd() * 4) : null;
  out.push(...makeCameo(lot, rl));
  return out;
}

/** Whatever this level pins to an address, if anything. */
function cameoOn(lotId: string): NonNullable<LevelSpec['cameos']>[number] | undefined {
  return day.cameos?.find((c) => c.lot_id === lotId);
}

/**
 * The named walkers, on the one lot a level says they pass.
 *
 * Not a roll — they are specific people, and a cameo that might not happen is
 * not a cameo. They walk together: same direction, same pace, a step apart in
 * depth so the nearer one passes in front. The dog is separate because she is
 * drawn from the animal sheet, but she is given the same heading and speed and
 * put out ahead, which is where a dog on a lead is.
 *
 * Everything starts off the left edge so the group walks IN. Arriving already
 * halfway across reads as three figures that were spawned there, which is what
 * they are, and the whole point is that it should not look like it.
 */
function makeCameo(lot: LotSpec, rl: RenderedLot): Passerby[] {
  // CLEARED here, not only set. There is one escort and this runs on every lot,
  // so returning early without touching it left the last lot's dog walking onto
  // the next lawn with nobody holding the lead.
  escort = null;
  const c = cameoOn(lot.lot_id);
  if (!c?.people?.length) return [];
  const walk = sidewalkOf(rl);
  const depth = walk.bottom - walk.top;
  const speed = walk.w * 0.06;

  const people = c.people.map((name, i) => ({
    character: characterNamed(name),
    // A stride apart, so they read as walking together rather than as one
    // figure with a rendering fault.
    x: -walk.w * 0.08 - i * 26,
    y: walk.top + depth * (0.42 + i * 0.22),
    dir: 2 as Passerby['dir'],
    vx: speed,
    t: i * 0.4,
    bark: null,
  }));

  escort = c.dog
    ? {
        which: animalNamed(c.dog),
        character: 0,
        x: -walk.w * 0.08 + 64,
        y: walk.top + depth * 0.55,
        dir: 2 as Passerby['dir'],
        vx: speed,
        t: 0,
        bark: null,
      }
    : null;

  return people;
}

/** Shared by everyone drawn from the resident sheet. */
function drawPerson(x: number, y: number, sx: number, sy: number, k: number): void {
  const { frameW: fw, frameH: fh } = RESIDENTS;
  const w = Math.round(fw * k);
  const h = Math.round(fh * k);
  // The sheet carries no baked shadow, so without this they float. Sized off
  // DRAWN HEIGHT rather than frame width, since height is the dimension that
  // means "how tall this person is" whatever the frame pads around them.
  // Half-width lands near shoulder width, about what a midday shadow pools to.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, h * 0.12, h * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Seat the sprite by the PERSON's center line and ground line, not the
  // frame's. The frame is bigger than the figure so a swung hoe fits, and
  // centring on the frame would shove everyone sideways to leave room for a
  // tool most of them are not carrying.
  ctx.drawImage(
    residentSheet, sx, sy, fw, fh,
    Math.round(x - RESIDENTS.centerX * k), Math.round(y - RESIDENTS.ground * k), w, h,
  );
}

/**
 * A animal. Its own draw rather than drawPerson's, because the resident sheet's
 * centre and ground lines are measured for a standing figure and mean nothing
 * here — and a animal's shadow is a much smaller pool than a person's.
 */
function drawAnimal(x: number, y: number, sx: number, sy: number, flip: boolean): void {
  const k = ANIMAL_UPSCALE * rendered.layout.scale;
  const w = Math.round(ANIMALS.frameW * k);
  const h = Math.round(ANIMALS.frameH * k);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  // Tucked up under the body rather than pooled at the sprite's bottom edge.
  // Seen from this high an angle an animal's shadow sits mostly BENEATH it,
  // and one sitting at the very bottom of the frame reads as detached.
  ctx.ellipse(x, y - h * 0.13, w * 0.26, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const dx = Math.round(x - w / 2);
  const dy = Math.round(y - h);
  if (flip) {
    ctx.save();
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(animalSheet, sx, sy, ANIMALS.frameW, ANIMALS.frameH, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(animalSheet, sx, sy, ANIMALS.frameW, ANIMALS.frameH, dx, dy, w, h);
  }
}

/**
 * Pay a bounty and mark it claimed.
 *
 * Shared by both kinds. A prop bounty also needs the scene rebuilt — marking it
 * claimed only drops it from the NEXT prop list, and the image on screen was
 * composited before that, so without this the cat stays drawn and stays in the
 * id buffer: findable again, and still hoverable after supposedly running off.
 * A person just stops being wanted; they carry on living there.
 */
/**
 * How long the tick stays on the lot after a claim.
 *
 * It is a confirmation that the click landed, not a marker: leaving it up for
 * the round put a permanent green tick in a yard the player had already dealt
 * with. The one on the NOTICE stays — that is the receipt, and it belongs with
 * the thing it is a receipt for.
 */
const BOUNTY_TICK_MS = 1800;
let bountyTickTimer = 0;

function claimBounty(b: Bounty, mark: { x: number; y: number } | null): void {
  // A null mark means the claim shows itself some other way. The thief takes a
  // dart and blinks out where he stood, and a tick over the top of that would
  // be the game explaining a thing the player just watched happen.
  bountyMark = mark;
  clearTimeout(bountyTickTimer);
  if (mark) bountyTickTimer = setTimeout(() => {
    bountyMark = null;
    // Explicit repaint: with the claimed animal gone, the lot may have nothing
    // moving on it, and then no frame would be asked for.
    paint();
  }, BOUNTY_TICK_MS) as unknown as number;
  claimed.add(b.id);
  // Found. The flyer comes down, and stays down on every round after this one.
  clearOutstanding(b.id);
  bountyPay += b.reward;
  saveFile.inspector.pay += b.reward;
  save(saveFile);
  sound.play('money');
  // Only a PROP is baked into the scene, so only a prop needs the scene
  // rebuilding to take it back out. A person or a pet is drawn over the top.
  if (b.kind !== 'person' && b.kind !== 'animal') {
    const built = renderToCanvas(current, routeIndex * stageSize().w);
    rendered = built.rl;
    currentCanvas = built.cv;
    currentProps = propLayerFor(rendered);
    currentGlow = glowLayerFor(rendered, current);
    centroidCache.clear();
  }
  syncFlyer();
  paint();
  syncDesk();
}

/** Draw the resident over the finished scene. */
function drawWalker(): void {
  if (!residentSheet.complete || !residentSheet.naturalWidth) return;
  const k = RESIDENT_UPSCALE * rendered.layout.scale;

  /**
   * People and props, interleaved by depth.
   *
   * The scene is composited once into an image, so anything drawn afterwards
   * lands on top of it — which had residents strolling over the tops of the
   * bins. Props therefore go back into the ordering here: each one is re-blitted
   * from the finished scene at its own ground line, which restores it over
   * anybody standing further up the lot. Re-blitting is idempotent for the
   * background, since that is the same image already on screen.
   */
  const queue: { y: number; draw: () => void }[] = [];

  if (resident) {
    const { walker, work } = resident;
    const f = residentFrame(walker, work);
    const a = thiefBlink ? blinkAlpha(performance.now()) : 1;
    queue.push({ y: walker.y, draw: () => {
      if (a >= 1) { drawPerson(walker.x, walker.y, f.sx, f.sy, k); return; }
      ctx.save();
      ctx.globalAlpha = a;
      drawPerson(walker.x, walker.y, f.sx, f.sy, k);
      ctx.restore();
    } });
  }
  for (const p of passersby) {
    const f = walkFrame(p.character, p.dir, p.t);
    queue.push({ y: p.y, draw: () => drawPerson(p.x, p.y, f.sx, f.sy, k) });
  }
  if (animal && animalSheet.complete && animalSheet.naturalWidth) {
    const c = animal;
    const f = animalFrameFor(c.which, c.walker);
    queue.push({ y: c.walker.y, draw: () => drawAnimal(c.walker.x, c.walker.y, f.sx, f.sy, f.flip) });
  }
  if (bountyAnimal && animalSheet.complete && animalSheet.naturalWidth) {
    const c = bountyAnimal;
    const f = animalFrameFor(c.which, c.walker);
    // Blinks out on a dart, exactly as the thief does. Only ever non-1 while a
    // hunt bounty is dying — a cat claimed by clicking is taken off the scene
    // outright and never reaches this branch.
    const a = thiefBlink ? blinkAlpha(performance.now()) : 1;
    queue.push({ y: c.walker.y, draw: () => {
      if (a >= 1) { drawAnimal(c.walker.x, c.walker.y, f.sx, f.sy, f.flip); return; }
      ctx.save();
      ctx.globalAlpha = a;
      drawAnimal(c.walker.x, c.walker.y, f.sx, f.sy, f.flip);
      ctx.restore();
    } });
  }
  // The walked dog. Same sheet as the strays, but she is steered like a
  // passerby, so the frame picker gets a stand-in with the four fields it
  // actually reads: always moving, facing the way she is going.
  if (escort && animalSheet.complete && animalSheet.naturalWidth) {
    const e = escort;
    const f = animalFrameFor(e.which, {
      facing: e.dir, moving: true, phase: e.t, hx: Math.sign(e.vx),
    } as unknown as Walker);
    queue.push({ y: e.y, draw: () => drawAnimal(e.x, e.y, f.sx, f.sy, f.flip) });
  }
  if (currentProps) {
    const layer = currentProps;
    for (const pr of rendered.props) {
      queue.push({
        y: pr.baseY,
        draw: () => ctx.drawImage(layer, pr.x, pr.y, pr.w, pr.h, pr.x, pr.y, pr.w, pr.h),
      });
    }
  }
  queue.sort((a, b) => a.y - b.y);
  for (const item of queue) item.draw();

  // Bubbles last, over everybody. A thought getting a walker's head drawn
  // through it is worse than one overlapping a neighbor.
  const headY = (footY: number) => footY - RESIDENTS.ground * k;
  if (resident?.bark?.text) {
    drawBubble(ctx, resident.bark.text, resident.walker.x, headY(resident.walker.y), canvas.width);
  }
  for (const p of passersby) {
    if (p.bark?.text) drawBubble(ctx, p.bark.text, p.x, headY(p.y), canvas.width);
  }
}

/**
 * The scene itself is a still image; only the resident moves, so the loop just
 * repaints rather than recompositing. Stops when nobody is out.
 */
function startWalkerLoop(): void {
  cancelAnimationFrame(walkerRaf);
  // Traffic alone is reason enough to run: a lot can have an empty yard and
  // still have somebody walking past it.
  if (!resident && !passersby.length && !animal && !escort && !bountyAnimal) return;
  walkerLast = performance.now();
  const step = (now: number) => {
    if (sliding) { walkerRaf = requestAnimationFrame(step); return; }
    const dt = Math.min(0.1, (now - walkerLast) / 1000);
    walkerLast = now;
    resident?.walker.update(dt);
    resident?.work?.update(dt);
    animal?.walker.update(dt);
    bountyAnimal?.walker.update(dt);
    resident?.bark?.update(dt, barkCtx);
    passersby = stepPassersby(passersby, dt, sidewalkOf(rendered));
    // The dog walks off the edge on the same terms as the people beside her.
    escort = (stepPassersby(escort ? [escort] : [], dt, sidewalkOf(rendered))[0] as Escort) ?? null;
    for (const p of passersby) p.bark?.update(dt, barkCtx);
    paint();
    // Once the last of them has gone and there is nobody in the yard there is
    // nothing left moving, so stop asking for frames.
    if (!resident && !passersby.length && !animal && !escort && !bountyAnimal) return;
    walkerRaf = requestAnimationFrame(step);
  };
  walkerRaf = requestAnimationFrame(step);
}

/**
 * Rebuild the scene for a layout that has changed under it.
 *
 * Shared by the window resize and the zoom control, because they are the same
 * event as far as the scene is concerned: the house rect moved, and everything
 * derived from it is now wrong. Zoom used to be nothing and resize was inline;
 * a second caller is what makes it worth a name.
 */
function relayout(): void {
  if (!current) return;
  const wasWalk = sidewalkOf(rendered);
  const built = renderToCanvas(current, routeIndex * stageSize().w);
  rendered = built.rl;
  currentCanvas = built.cv;
  currentProps = propLayerFor(rendered);
  currentGlow = glowLayerFor(rendered, current);
  centroidCache.clear();
  // Rebuild the resident too. Their patch of lawn is derived from the house
  // rect, so a layout change invalidates it — and the walker keeps walking to
  // coordinates from the OLD one, which after a shrink is somewhere up the
  // roof. Seeded from the lot id, so this is the same person, just re-placed.
  resident = makeWalker(current, rendered);
  animal = makeAnimal(current, rendered);
  bountyAnimal = makeBountyAnimal(current, rendered);
  // Traffic is REMAPPED, not respawned: anyone who has already walked off has
  // gone for good, and rebuilding from the seed would march them back on.
  passersby = remapPassersby(passersby, wasWalk, sidewalkOf(rendered));
  escort = (remapPassersby(escort ? [escort] : [], wasWalk, sidewalkOf(rendered))[0] as Escort) ?? null;
  startWalkerLoop();
  paint();
}

/** Re-render on resize: the layout, not just the canvas, depends on the size. */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 120) as unknown as number;
});

/** Average position of an object's pixels in the id buffer. */
const centroidCache = new Map<number, { x: number; y: number } | null>();
function centroid(key: number): { x: number; y: number } | null {
  if (centroidCache.has(key)) return centroidCache.get(key)!;
  const { id } = rendered.raster;
  const W = rendered.raster.w;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < id.length; i++) {
    if (id[i] !== key) continue;
    sx += i % W;
    sy += (i / W) | 0;
    n++;
  }
  const res = n ? { x: sx / n, y: sy / n } : null;
  centroidCache.set(key, res);
  return res;
}

/** Canvas is 1:1 with the stage now, so this is a plain offset. */
function toLotPixel(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: Math.floor(ev.clientX - r.left), y: Math.floor(ev.clientY - r.top) };
}

// --- Lot lifecycle --------------------------------------------------------

function loadLot(index: number): void {
  routeIndex = index;
  current = LOTS[day.lots[index].lot_id];
  const sz = stageSize();
  const built = renderToCanvas(current, index * sz.w);
  rendered = built.rl;
  currentCanvas = built.cv;
  currentProps = propLayerFor(rendered);
  currentGlow = glowLayerFor(rendered, current);
  flagged = new Set();
  centroidCache.clear();
  stamping = false;

  // Record what we saw today. This is the note that grace periods read from
  // on later days — the player's own observation, not an oracle.
  const rec = recordFor(saveFile, current.lot_id, current.address);
  for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? today.iso);
  save(saveFile);

  barkCtx = barkContextFor(current);
  resident = makeWalker(current, rendered);
  animal = makeAnimal(current, rendered);
  bountyAnimal = makeBountyAnimal(current, rendered);
  passersby = makeTraffic(current, rendered, resident ? [resident.walker.character] : []);
  startWalkerLoop();
  startHunt();
  renderCaseFile(rec);
  paint();
  syncDesk();
  phoneOnArrival();
}

/**
 * The case file names the address now. It used to be captioned over the
 * viewport as well, which said the same thing twice and pushed the lot off
 * center — and the address belongs with the record, since that is the tool the
 * player is meant to reach for.
 */
function renderCaseFile(rec: { address: string; lot_id: string; rulings: Ruling[] }): void {
  // A new address means a fresh sheet — the previous verdict's ink goes with it.
  stampMark.classList.remove('on');
  $('cf-addr').textContent = rec.address;
  const el = $('casefile');
  if (!rec.rulings.length) {
    el.className = 'muted';
    el.textContent = 'No prior rulings. First inspection at this address.';
  } else {
    el.className = '';
    el.innerHTML = rec.rulings.map(rulingLine).join('');
  }
}

/** Article id to the word on its binder tab. "R-101" -> "Weeds". */
const ARTICLE_TAB: Record<string, string> = Object.fromEntries(
  ARTICLES.map((a) => [a.id, (a as { tab?: string }).tab ?? a.title]),
);

/**
 * One prior ruling, and WHAT IT WAS FOR.
 *
 * The count of findings was the wrong fact to print. Escalation is per article
 * — a warning for weeds does not license a fine for the bins — so the only
 * question the player brings to this card is "have I written them up for THIS
 * before", and "2 finding(s)" cannot answer it. The articles can.
 *
 * Deduplicated, because a lot with six weeds on it was one finding written six
 * times and the file should say "Weeds" once. Findings with a null article are
 * dropped: those are marks that were not violations of anything, they never
 * armed escalation, and listing them here would suggest they had.
 */
function rulingLine(r: Ruling): string {
  const cited = [...new Set(r.findings.map((f) => f.article).filter(Boolean) as string[])];
  const what = cited.length
    ? cited.map((id) => `<span class="cf-art">${ruleNumber(id)} ${ARTICLE_TAB[id] ?? id}</span>`).join(' ')
    : '<span class="muted">no articles cited</span>';
  /**
   * STRUCK OUT once it can no longer change what you stamp today.
   *
   * A case file that lists everything ever written at an address is a case file
   * nobody reads: the two lines that decide the verdict are buried among the
   * ones that stopped mattering. The same test adjudication uses, so a line
   * through a ruling means exactly what it looks like — spent.
   */
  const spent = !rulingCounts(r, today.iso);
  return `<div class="cf-line${spent ? ' spent' : ''}"${spent ? ' title="Lapsed. No longer counts toward escalation."' : ''}>
      <span>${shortDate(r.date)} — <b>${VERDICT_WORD[r.verdict] ?? r.verdict}</b></span>
      ${what}
    </div>`;
}

type Article = (typeof ARTICLES)[number] & {
  category?: string;
  exhibit?: {
    cite: string[]; cite_note: string; cite_label?: string;
    allow?: string[]; allow_note?: string; allow_label?: string;
  };
};

/**
 * Which leaf of the binder is showing, and what the binder was built from.
 *
 * Page state has to survive syncDesk(), which runs on every click, every mark
 * and every repaint — a player who has flipped to the fence article and then
 * marks a weed should not find the book slammed shut back at page one. The key
 * is the article set: when a LEVEL adds an article the page count changes, and
 * only then does the book reopen at the front.
 */
let binderPage = 0;
let binderKey = '';
/** Shut until the player opens it, and it stays however they left it. */
let binderOpen = false;
/** Which articles have been read in full. Same reasoning: survives repaints. */
const binderExpanded = new Set<string>();

/**
 * One rule, in its compact form.
 *
 * Number and title on one line, then a plain-language sentence, then the art.
 * The formal wording and the enforcement-limits note — the two long things —
 * are behind "read more", because looking a rule up mid-inspection is a
 * question of WHICH article, not a question of statute. The citation goes down
 * there with them: the section number is flavour, not something you scan for.
 */
function binderEntry(a: Article, expanded: Set<string> = binderExpanded): string {
  const thumbs = (keys: string[] = []) =>
    keys.map((k) => `<img src="assets/${k}.png${CB}" alt="" />`).join('');
  const pics = thumbs(a.exhibit?.cite);
  /**
   * THE OTHER HALF OF THE EXHIBIT, which was authored and never drawn.
   *
   * `allow` and `allow_note` have been in rules.json since the book was written
   * and nothing rendered them, so every article showed the player what a
   * violation looks like and nothing of what a NEAR-MISS looks like — which is
   * the harder half of this job and the half the decoys are built on. It shows
   * behind "read more" with the enforcement limits, because that is the same
   * question asked twice: what does this Article NOT reach.
   */
  const allow = thumbs(a.exhibit?.allow);
  const open = expanded.has(a.id);
  return `
    <div class="bk-rule">
      <div class="bk-head">
        <span class="bk-code">${ruleNumber(a.id)}</span>
        <span class="bk-title">${a.title}</span>
      </div>
      <div class="bk-gist">${a.short}
        <!-- INSIDE the summary, not under it: it is the end of that sentence,
             and a row of its own turned a one-line rule into a three-line one. -->
        <button type="button" class="bk-more" data-more="${a.id}"
                aria-expanded="${open}">${open ? 'collapse' : 'read more'}</button>
      </div>
      ${
        pics
          ? `${a.exhibit?.cite_label ? `<div class="bk-pics-label">${a.exhibit.cite_label}</div>` : ''}
             <div class="bk-pics">${pics}</div>`
          : ''
      }
      <div class="bk-full"${open ? '' : ' hidden'}>
        <div class="bk-cite">${a.section}</div>
        <p class="bk-formal">${a.text}</p>
        <div class="bk-limits"><b>Enforcement limits.</b> ${a.decoy_note}</div>
        ${
          allow || a.exhibit?.allow_note
            ? `<div class="bk-allow">
                 <b>${a.exhibit?.allow_label ?? 'Not this Article.'}</b> ${a.exhibit?.allow_note ?? ''}
                 ${allow ? `<div class="bk-pics">${allow}</div>` : ''}
               </div>`
            : ''
        }
      </div>
    </div>`;
}

/**
 * Draw the open page.
 *
 * A page is a SECTION — every active article behind one divider, in compact
 * form. That is what makes the tabs honest: pulling a tab and turning to the
 * next page land you in the same place, rather than the arrows walking through
 * articles the tabs describe as one group.
 *
 * EVERY section is tabbed, including the ones with nothing in them yet. The
 * binder the Association hands you is the whole binder; the sections you have
 * not been trained on are in there, and finding a tab you cannot read yet is
 * the book telling you the job is bigger than today. What is withheld is the
 * CONTENT, not the existence of the section.
 */
/**
 * THE MAP DIVIDER. A page of the binder rather than a section of the
 * declaration: it holds no articles, so it is never locked and never shows the
 * "not yet trained" note.
 */
const MAP_TAB = 'Map';

/**
 * Fetched once and kept, because it is markup rather than a picture.
 *
 * It has to be INLINE for any of this to work: an <img> is an opaque document
 * and neither CSS nor script can reach a path inside it, so dimming a street
 * would be impossible. 2.8KB, so holding the text costs nothing.
 */
let mapSvg: string | null = null;
let mapFetching = false;

function loadMap(): void {
  if (mapSvg !== null || mapFetching) return;
  mapFetching = true;
  void fetch(`assets/map.svg${CB}`)
    .then((r) => (r.ok ? r.text() : ''))
    .then((t) => {
      // Illustrator leaves the tracing template it was drawn over in the file,
      // pointing at a PNG that was never shipped. It is display:none, so it
      // shows nothing and 404s every time the page is opened.
      mapSvg = t
        .replace(/<g id="moIwjp"[\s\S]*?<\/g>/, '')
        // Illustrator escapes an underscore in a layer name as _x5F_, so
        // "whistling_sparrow" ships as "whistling_x5F_sparrow" and matches
        // nothing. Undone here rather than in the artwork, which would only be
        // re-exported the same way next time.
        .replace(/_x5F_/g, '_');
      mapFetching = false;
      syncBinder();
    })
    .catch(() => { mapSvg = ''; mapFetching = false; });
}

/**
 * Which street the player is standing on, as an id the drawing would know.
 *
 * A straight transliteration, with no lookup table in the middle. There was one
 * for a while, holding a single entry because the map called Eyezetta "ibetta" —
 * every id on the drawing matches streets.json now, so the street name IS the
 * shape name and there is nothing to keep in step.
 */
function currentStreetId(): string {
  return (current?.street ?? '').toLowerCase().replace(/\s+/g, '_');
}

/**
 * The streets this round visits, in route order and without repeats.
 *
 * A round used to be one block, so both the briefing and the audit could name
 * "Bonerville" and be right. The route crosses the neighbourhood now, and a
 * single street name taken off the current lot would be whichever address the
 * player happened to stop on.
 */
function routeStreets(): string[] {
  return [...new Set(day.lots.map((l) => l.street).filter(Boolean) as string[])];
}

function syncBinder(): void {
  const active = ARTICLES.filter((a) => day.active_rules.includes(a.id)) as Article[];
  const cats = CATEGORIES;

  const key = active.map((a) => a.id).join(',');
  if (key !== binderKey) {
    binderKey = key;
    binderPage = 0;
  }
  binderPage = Math.min(Math.max(0, binderPage), Math.max(0, cats.length - 1));

  const cat = cats[binderPage];
  const body = $('binder-body');
  const cover = $('binder-cover') as HTMLButtonElement;
  const leaf = $('binder-page');
  if (!cat) {
    body.innerHTML = '<p class="muted">No articles in force.</p>';
    $('binder-tabs').innerHTML = '';
    $('bk-count').textContent = '';
    return;
  }

  // Shut or open. The board is the same size either way, so opening the book
  // does not move the Findings card underneath it.
  cover.hidden = binderOpen;
  leaf.hidden = !binderOpen;
  cover.setAttribute('aria-expanded', String(binderOpen));
  // The sound belongs to the HANDLERS, not to this function: syncBinder runs on
  // every repaint, and a page-turn on each one would rustle continuously while
  // the player is marking a lot. Expanding "read more" is deliberately silent —
  // nothing has been turned, it is the same leaf.
  cover.onclick = () => { binderOpen = true; sound.play('page'); syncBinder(); };

  const here = active.filter((a) => a.category === cat);
  if (cat === MAP_TAB) {
    loadMap();
    body.innerHTML = mapSvg
      ? `<div class="bk-map">${mapSvg}</div>`
      : '<p class="bk-locked">Unfolding the map…</p>';
    // Marked AFTER the markup lands, because the class goes on paths inside the
    // drawing rather than on anything this file wrote.
    //
    // EVERY segment of it. A street that bends is drawn as more than one shape
    // — Goodish is "goodish" plus "goodish1" — and lighting only the first
    // leaves half a road bright and half of it faded, which reads as two
    // streets rather than one.
    const id = currentStreetId();
    const seg = new RegExp(`^${id}\\d*$`);
    for (const el of body.querySelectorAll<SVGElement>('.bk-map [id]'))
      if (seg.test(el.id)) el.classList.add('here');
  } else {
    // An untrained section is not empty — it is withheld. Saying so in the
    // Association's own voice is worth more than a blank leaf, and it tells the
    // player the tab will be worth something later without spoiling what.
    body.innerHTML = here.length
      ? here.map((a) => binderEntry(a)).join('')
      : `<p class="bk-locked">These rules will be revealed to you once you have
           completed the relevant job training.</p>`;
  }
  body.querySelectorAll<HTMLButtonElement>('[data-more]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.more!;
      if (binderExpanded.has(id)) binderExpanded.delete(id);
      else binderExpanded.add(id);
      syncBinder();
    };
  });

  $('bk-count').textContent = `${binderPage + 1} of ${cats.length}`;
  const prev = $('bk-prev') as HTMLButtonElement;
  const next = $('bk-next') as HTMLButtonElement;
  // Forward stops rather than wraps: a book you can leaf off the end of loses
  // you the one bit of orientation a physical binder gives you for free. Back
  // from the first page shuts the book, which is the same gesture — there is
  // nothing before page one except the cover, so no separate close control.
  next.disabled = binderPage >= cats.length - 1;
  prev.disabled = false;
  prev.title = binderPage === 0 ? 'Close' : 'Previous page';
  prev.onclick = () => {
    if (binderPage === 0) binderOpen = false;
    else binderPage--;
    sound.play('page');
    syncBinder();
  };
  next.onclick = () => { binderPage++; sound.play('page'); syncBinder(); };

  $('binder-tabs').innerHTML = cats
    .map((c) => {
      // Dimmed, not disabled. You can pull the tab and read WHY it is empty.
      // The map is never dimmed: it has no articles to be waiting for.
      const locked = c !== MAP_TAB && !active.some((a) => a.category === c);
      // The icon file IS the category name, lowercased — no lookup table to
      // fall out of step with the data when a section is added.
      return `<button type="button" role="tab" data-cat="${c}"
                 class="${locked ? 'locked' : ''}" title="${c}" aria-label="${c}"
                 aria-selected="${binderOpen && c === cat}"
              ><img src="assets/rulebook/${c.toLowerCase()}.png${CB}" alt="" /></button>`;
    })
    .join('');
  $('binder-tabs').querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => {
    // Pulling a divider while the book is shut opens it there, so a tab is a
    // shortcut past the cover rather than something you can only use once you
    // are already inside.
    b.onclick = () => {
      const to = cats.indexOf(b.dataset.cat!);
      // Silent if you pull the tab you are already reading — nothing moved.
      if (to !== binderPage || !binderOpen) sound.play('page');
      binderPage = to;
      binderOpen = true;
      syncBinder();
    };
  });
}

function syncDesk(): void {
  // Day number, weekday and date on one line. The weekday earns its place —
  // rules key off it (trash day, decor windows) — and the date is what makes a
  // grace period legible when the case file says an object was first seen on
  // one and it is now another. Weekday bold, date not: the weekday is the part
  // you check a rule against, the date is only there to be compared later.
  $('c-day').textContent = String(day.level_id);
  // The desk calendar, not the route sheet — the date lives in one place now.
  $('cal-dow').textContent = today.weekday;
  $('cal-date').textContent = shortDate(today.iso);
  $('c-prog').textContent = `${routeIndex + 1} of ${day.lots.length}`;
  // No quota row. `quota` is still authored per level and still checked at the
  // audit, but it currently equals the lot count everywhere, the round can only
  // end by stamping the last lot, and so the shortfall is structurally always
  // zero — the route sheet was printing the same number twice under two labels.
  // Put the row back when a route offers more addresses than the quota needs,
  // or when End Round Early ships and finishing short becomes a real choice.
  /**
   * A RUNNING tally, off this shift's outcomes rather than off the save — the
   * save's count is only written at the audit, so the row used to show last
   * shift's number all the way through this one.
   *
   * It counts exactly what gets billed tonight and nothing else. The audit
   * still holds back WHICH lot and WHY, which is the reveal that matters; a
   * player who budgets on one mistake and is then charged for three would read
   * that as a bug rather than as the Association being the Association.
   */
  const mistakes = outcomes.filter((o) => o.strike).length;
  const billed = Math.max(0, mistakes - FREE_MISTAKES);
  $('c-strikes').textContent = billed
    ? `${mistakes} · -$${billed * MISTAKE_COST}`
    : `${mistakes} / ${FREE_MISTAKES} free`;
  $('c-pay').textContent = money(bankShown);
  $('m-day').textContent = `Shift ${day.level_id}`;
  $('m-pay').textContent = money(bankShown);

  syncBinder();

  const list = $('find-list');
  if (!flagged.size) {
    list.innerHTML = '<li class="none">Nothing marked.</li>';
  } else {
    /**
     * One line per KIND of finding, counted.
     *
     * Six weeds is one thing wrong with the lot written six times. Listing them
     * separately buries the other findings under a wall of identical rows, and
     * it is the same reason adjudication treats one citation as covering the
     * kind — see state.ts. Keyed on `group ?? label`, the same key used there,
     * so the pad and the scoring cannot disagree about what counts as "the
     * same". The key is also what the row is CALLED, which is why a group is
     * written as a finding would be read aloud and not as an internal tag.
     */
    const kinds = new Map<string, string[]>();
    for (const id of flagged) {
      const o = rendered.objects.find((x) => x.id === id);
      if (!o) continue;
      const kind = o.group ?? o.label;
      const ids = kinds.get(kind) ?? [];
      ids.push(id);
      kinds.set(kind, ids);
    }
    list.innerHTML = [...kinds]
      .map(
        ([label, ids]) =>
          `<li><span>${label}${ids.length > 1 ? ` <b>&times; ${ids.length}</b>` : ''}</span>
             <button data-unflag="${ids.join(' ')}">&times;</button></li>`,
      )
      .join('');
    list.querySelectorAll<HTMLButtonElement>('[data-unflag]').forEach((b) => {
      // One row, one remove: taking off a grouped line takes off every instance
      // behind it, or the count would drop by one and leave a row the player
      // thought they had cleared.
      b.onclick = () => {
        for (const id of b.dataset.unflag!.split(' ')) flagged.delete(id);
        paint();
        syncDesk();
      };
    });
  }

  const done = stamping;
  $<HTMLButtonElement>('btn-pass').disabled = done;
  $<HTMLButtonElement>('btn-warn').disabled = done;
  $<HTMLButtonElement>('btn-fine').disabled = done;
}

// --- Interaction ----------------------------------------------------------

/**
 * Where the animal is on screen, for hit-testing.
 *
 * It is drawn in the paint pass rather than composited into the scene, so it
 * has no entry in the id buffer and cannot be found the way props are. A rect
 * is enough: there is at most one of them, and nothing else is checked here.
 */
/**
 * Which character was clicked, or null. Residents and passers-by both count.
 *
 * Like the animals they are drawn in the paint pass rather than composited, so
 * they have no id-buffer entry and are hit-tested by rect.
 */
function personHit(px: number, py: number): number | null {
  const k = RESIDENT_UPSCALE * rendered.layout.scale;
  const w = RESIDENTS.frameW * k;
  const h = RESIDENTS.frameH * k;
  const over = (x: number, y: number) =>
    px > x - RESIDENTS.centerX * k && px < x - RESIDENTS.centerX * k + w &&
    py > y - RESIDENTS.ground * k && py < y - RESIDENTS.ground * k + h;
  for (const p of passersby) if (over(p.x, p.y)) return p.character;
  if (resident && over(resident.walker.x, resident.walker.y)) return resident.walker.character;
  return null;
}

/** Rect test against a walking animal. Feet at y, so the body is ABOVE it. */
function overAnimal(a: { walker: Walker } | null, px: number, py: number): boolean {
  if (!a) return false;
  const k = ANIMAL_UPSCALE * rendered.layout.scale;
  const w = ANIMALS.frameW * k;
  const h = ANIMALS.frameH * k;
  const { x, y } = a.walker;
  return px > x - w / 2 && px < x + w / 2 && py > y - h && py < y;
}

/**
 * Which animal is under the cursor, if any.
 *
 * BOTH of them: the stray wandering the yard and somebody's dog out on the
 * walk. Only the yard one used to be tested, so a dog trotting past on a lead
 * was the one animal in the game that ignored you — and it is the one the
 * player is most likely to try, because it is walking beside a named couple
 * and reads as the most alive thing on the screen.
 *
 * Same box for both, because drawAnimal draws both at the same scale.
 */
function animalAt(px: number, py: number): number | null {
  const k = ANIMAL_UPSCALE * rendered.layout.scale;
  const w = ANIMALS.frameW * k;
  const h = ANIMALS.frameH * k;
  const over = (x: number, y: number) =>
    px > x - w / 2 && px < x + w / 2 && py > y - h && py < y;
  if (animal && over(animal.walker.x, animal.walker.y)) return animal.which;
  if (escort && over(escort.x, escort.y)) return escort.which;
  return null;
}

frame.addEventListener('click', (ev) => {
  if (stamping || sliding) return;
  const p = toLotPixel(ev as MouseEvent);

  // While the drawer is out the lot is not an inspection, it is a target. No
  // marking, no citations, no id buffer — one thing to do and four goes at it.
  if (hunt) { shoot(p); return; }

  // The wanted person, if this is a person bounty and you have found them.
  // Same rule as the animals: checked before the id buffer, never a finding.
  const pb = bountyOn(current?.lot_id);
  const pbFace = pb?.kind === 'person' ? faceOf(pb) : null;
  if (pb && pbFace !== null && personHit(p.x, p.y) === pbFace) {
    claimBounty(pb, { x: p.x, y: p.y });
    return;
  }

  // Animals answer, but they are not findings — no mark, nothing recorded.
  // Checked BEFORE the id buffer so a cat standing over a prop still meows
  // rather than silently citing whatever is behind it.
  /**
   * The missing pet, tested BEFORE the strays.
   *
   * Both are drawn from the same sheet and both wander the same yard, so if the
   * two overlap the click has to resolve to the one that pays — a player who
   * has found Chaz and gets a meow out of the neighbour's cat instead would
   * reasonably conclude the bounty is broken.
   */
  const bAnimal = bountyOn(current?.lot_id);
  if (bAnimal?.kind === 'animal' && bountyAnimal && overAnimal(bountyAnimal, p.x, p.y)) {
    // Its BODY, not its feet. drawAnimal puts the sprite in y-h..y, so the
    // walker's y is the ground line — centring the tick there hangs half of it
    // on the grass below the cat.
    const { x, y } = bountyAnimal.walker;
    const h = ANIMALS.frameH * ANIMAL_UPSCALE * rendered.layout.scale;
    bountyAnimal = null;
    claimBounty(bAnimal, { x, y: y - h / 2 });
    return;
  }

  const which = animalAt(p.x, p.y);
  if (which !== null) {
    const kind = animalKind(which);
    // Two barks, so a dog clicked twice does not sound like a loop. The
    // armadillo and the raccoon have no line — silence is the right answer for
    // an animal with nothing to say, and better than borrowing the cat's.
    if (kind === 'dog') sound.play(Math.random() < 0.5 ? 'bark1' : 'bark2');
    else if (kind === 'cat') sound.play('meow');
    return;
  }

  // idNear, not idAt: a weed is mostly gaps, and a click that lands in one is
  // the player pointing at the weed, not at the grass behind it.
  const key = rendered.raster.idNear(p.x, p.y);
  if (!key) return;
  const obj = rendered.byKey.get(key);
  if (!obj?.flaggable) return;

  // A bounty is claimed, not cited. It pays immediately, never enters `flagged`,
  // and so never reaches adjudication or the accuracy figure.
  const b = bountyOn(current?.lot_id);
  if (b && obj.id === b.id) {
    claimBounty(b, centroid(key) ?? { x: p.x, y: p.y });
    return;
  }

  if (flagged.has(obj.id)) {
    flagged.delete(obj.id);
  } else {
    flagged.add(obj.id);
    // Only on the way IN. Unmarking is a correction, and a correction that
    // sounds identical to the act it undoes tells the player nothing.
    sound.play('camera');
  }
  paint();
  syncDesk();
  // AFTER the mark lands and before anything is stamped. The order is the
  // point: the resident comes out because they saw you photograph it.
  maybeEvent(obj.id);
  maybePass(obj.id);
});

/**
 * THE DART HUNT.
 *
 * Thirty seconds of music, four darts, and a man crossing a dark lawn at three
 * times walking pace. Everything else about a night round is looking carefully
 * at things that are not moving; this is the one minute of it that is not, and
 * it is deliberately the only place in the game with a clock on screen and a
 * resource that runs out.
 *
 * The window is a TIMER, not the audio's `ended` event. A muted player, or one
 * whose browser never unlocked sound, would otherwise stand on that lot
 * forever. The music is the clock the player HEARS; this is the clock the game
 * keeps.
 */
const HUNT_MS = 30_000;
const HUNT_DARTS = 4;
/** A beat after the last dart, so the miss reads before the drawer goes. */
const HUNT_SPENT_MS = 900;

let hunt: { darts: number; timer: number } | null = null;
/**
 * WHAT IS BEING SHOT AT, held for the length of the hunt.
 *
 * Not looked up from the lot each time: endHunt clears the quarry's lot on a
 * miss, and shoot() would then be firing at a notice nothing can find any more.
 * One capture at the top of the encounter, dropped when it ends.
 */
let hunted: Bounty | null = null;

/**
 * HIT. He does not vanish on the frame the dart lands.
 *
 * A blink, slow enough to read and dimming as it goes — a tranquilliser taking
 * hold rather than a sprite being deleted. It is also the only feedback the
 * shot gets: there is no tick over him, because a mark explaining a thing the
 * player just watched happen is the game talking over itself.
 */
const BLINK_MS = 2200;
/** One half-cycle. Slow: this should read as unsteady, not as a strobe. */
const BLINK_HALF = 260;
let thiefBlink = 0;

/** Fades 1 to 0 across the blink, and is 0 outright on the off beat. */
function blinkAlpha(now: number): number {
  const e = now - thiefBlink;
  if (e >= BLINK_MS) return 0;
  return Math.floor(e / BLINK_HALF) % 2 === 0 ? 1 - (e / BLINK_MS) * 0.75 : 0;
}

function huntTarget(): Bounty | null {
  // `hunt`, not the id: the thief was the first of these, not the only one.
  // Still night-only — the drawer, the music and a torch-lit street are one
  // idea, and a dart gun on a Tuesday afternoon is a different game.
  const b = bountyOn(current?.lot_id);
  return b?.hunt && day.night ? b : null;
}

function startHunt(): void {
  const b = huntTarget();
  // Once per round. Missing him closes the lot for the night, and walking back
  // onto it must not hand out four more darts.
  // The thief carries state ACROSS shifts — caught once and he is done with
  // for the campaign. Nothing else does: a bounty that belongs to its own round
  // is settled that round, so only he consults the save.
  if (!b || hunt || firedEvents.has('hunt')) return;
  if (b.id === 'thief' && saveFile.inspector.thief === 'caught') return;
  firedEvents.add('hunt');
  // The dart drawer covers the panel. Shut the desk drawer under it, so putting
  // the gun away does not reveal a drawer left open before the music started.
  setDrawerOpen(false);
  hunt = { darts: HUNT_DARTS, timer: 0 };
  hunted = b;
  const drawer = $('drawer');
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  syncDarts();
  // Next frame, so the transform has a value to animate FROM. Setting hidden
  // and the class in the same tick lands the drawer open with no slide.
  requestAnimationFrame(() => drawer.classList.add('open'));
  frame.classList.add('aiming');
  sound.playCue('thief');
  hunt.timer = setTimeout(() => endHunt(false), HUNT_MS) as unknown as number;
}

function syncDarts(): void {
  const left = hunt?.darts ?? 0;
  $('dr-darts').innerHTML = Array.from({ length: HUNT_DARTS }, (_, i) =>
    `<img src="assets/dart.png${CB}" alt="" class="${i < left ? '' : 'spent'}" />`).join('');
}

function endHunt(caught: boolean): void {
  if (!hunt) return;
  clearTimeout(hunt.timer);
  hunt = null;
  sound.stopCue();
  frame.classList.remove('aiming');
  const drawer = $('drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => { if (!hunt) drawer.hidden = true; }, 460);
  // Only the thief outlives his round. The armadillo is this shift's problem
  // and writing him into the save would put the thief's flag on the wrong
  // animal — which is what decides whether the notice stays up for the rest of
  // the campaign.
  const quarry = hunted;
  hunted = null;
  if (quarry?.id === 'thief') saveFile.inspector.thief = caught ? 'caught' : 'outstanding';
  save(saveFile);
  if (!caught) {
    // Gone for the night. The lot goes quiet, which is the point — you had him
    // and the music ran out. Off the map too, so nothing else looks for him.
    resident = null;
    if (quarry) bountyLots.delete(quarry.id);
    paint();
  }
  // On a catch he is deliberately left standing: shoot() is mid-blink and owns
  // him until it ends. Clearing him here would cut the dart's only feedback.
  syncFlyer();
  syncDesk();
}

/**
 * A shot. Costs a dart whether or not it lands, and makes a noise either way —
 * a gun that only sounded on a hit would tell the player what happened before
 * they could see it.
 */
function shoot(p: { x: number; y: number }): void {
  if (!hunt || hunt.darts <= 0) return;
  hunt.darts--;
  syncDarts();
  sound.play('shot');
  const b = hunted;
  if (!b) return;
  const face = b.kind === 'person' ? faceOf(b) : null;
  // A dart hits whatever the notice is FOR, and a notice is for a person or for
  // an animal. Testing only for a person was fine while the thief was the only
  // hunt; it made the armadillo unshootable, which reads as the gun being
  // broken rather than as the player missing.
  if (face !== null && personHit(p.x, p.y) === face) {
    endHunt(true);
    // He stays on his feet and stays walking; only the drawing goes. The walker
    // is torn down when the blink finishes, not when the dart lands — which is
    // also what keeps the frame loop alive long enough to draw it.
    thiefBlink = performance.now();
    setTimeout(() => {
      thiefBlink = 0;
      resident = null;
      paint();
    }, BLINK_MS);
    claimBounty(b, null);
    return;
  }
  if (b.kind === 'animal' && bountyAnimal && overAnimal(bountyAnimal, p.x, p.y)) {
    endHunt(true);
    // Same blink as the thief, and for the same reason: the dart is the only
    // feedback there is, so the thing it hit has to be visibly leaving. The
    // walker survives until the blink ends, which is what keeps the frame loop
    // running long enough to draw it going.
    thiefBlink = performance.now();
    setTimeout(() => {
      thiefBlink = 0;
      bountyAnimal = null;
      paint();
    }, BLINK_MS);
    claimBounty(b, null);
    return;
  }
  if (hunt.darts === 0) setTimeout(() => endHunt(false), HUNT_SPENT_MS);
}

/**
 * A resident with something to say about what you just marked.
 *
 * Fires on the MARK, not on arrival at the lot — a man offering you money
 * before you have noticed anything is a man confessing, and the whole tension
 * of the thing is that he only comes out once you have raised the camera.
 *
 * Once per round. He does not get a second go at you if you unmark and remark,
 * and the verdict stays entirely the player's: taking the money removes the
 * finding but does not stamp the lot, so passing it afterwards is a second
 * decision and the audit will treat it as one.
 */
const firedEvents = new Set<string>();

/**
 * WAIVERS THE PLAYER HAS ACCEPTED, by object id, for this round.
 *
 * Accepting is not what makes a pass genuine — `passFault` decides that off the
 * paper, and adjudication reads the genuine ones whether or not the player was
 * taken in. This is only what they did about it, which is the mark.
 */
const passesSeen = new Set<string>();

/** Every waiver produced on this lot for this object, genuine or not. */
function passFor(objectId: string): Pass | undefined {
  return day.passes?.find((p) => p.lot_id === current.lot_id && p.object === objectId);
}

/**
 * The note on the doorstep.
 *
 * Produced the moment the player writes the thing up, because that is when a
 * homeowner who has one produces it. It is EVIDENCE, not an offer: the two
 * buttons only decide whether the mark stays, and whether that was right is
 * settled by the paper, not by the choice. Accept a forgery and the finding is
 * simply missing from the pad in the morning.
 *
 * Small on purpose. A full-screen document reads itself; a note held up at the
 * door has to be looked at.
 */
function maybePass(objectId: string): void {
  const p = passFor(objectId);
  if (!p || passesSeen.has(p.id) || !flagged.has(objectId)) return;
  passesSeen.add(p.id);

  const box = $('pass');
  $('pass-who').textContent = p.speaker;
  $<HTMLImageElement>('pass-head').src = `assets/${p.letterhead}.png${CB}`;
  $<HTMLImageElement>('pass-seal').src = `assets/${p.stamp}.png${CB}`;
  $('pass-covers').textContent = p.covers;
  $('pass-exp').textContent = p.expires;
  box.hidden = false;

  const close = () => { box.hidden = true; };
  $('pass-accept').onclick = () => {
    // Taken at face value. The pad simply stops saying it — which is right if
    // the paper was real and a missed finding if it was not.
    flagged.delete(objectId);
    paint();
    syncDesk();
    close();
  };
  $('pass-reject').onclick = close;
}

function maybeEvent(objectId: string): void {
  const e = day.event;
  if (!e || firedEvents.has(e.id)) return;
  if (e.lot_id !== current.lot_id || e.object !== objectId || !flagged.has(objectId)) return;
  firedEvents.add(e.id);

  const box = $('event');
  const opts = $('ev-opts');
  $('ev-who').textContent = e.speaker;
  $('ev-body').textContent = e.body;
  $('ev-reply').hidden = true;
  box.hidden = false;
  opts.innerHTML = e.options
    .map((o, i) => `<button class="btn" data-opt="${i}">${o.label}</button>`)
    .join('');
  opts.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => {
    b.onclick = () => {
      const o = e.options[Number(b.dataset.opt)];
      if (o.pay) {
        saveFile.inspector.pay += o.pay;
        save(saveFile);
        sound.play('money');
      }
      // Quietly. The pad simply no longer says it, which is the deal: what the
      // Board reads in the morning is the pad, and the lights are not on it.
      if (o.unmark) {
        flagged.delete(e.object);
        paint();
        syncDesk();
      }
      $('ev-reply').textContent = o.reply;
      $('ev-reply').hidden = false;
      opts.innerHTML = '<button class="btn" id="ev-close">Close</button>';
      $('ev-close').onclick = () => { box.hidden = true; };
    };
  });
}

/**
 * The loupe, at the pointer.
 *
 * An INFORMATION tool, not a magnifier: label and first-seen date, never more
 * pixels (manifest section 10, "Resolution & zoom"). What changed is where it
 * says it — a strip along the foot of the scene meant looking away from the
 * thing you were pointing at in order to find out what it was.
 */
const hoverTip = $('hover');
/**
 * How far off the pointer the label sits.
 *
 * Sized to the CURSOR, not to taste. The camera is a 118px sprite with its
 * hotspot dead centre (see #frame's cursor rule), so the art reaches 59px above
 * the point the mouse is actually at — at 14px the label was sitting on the
 * viewfinder. This clears it with a few pixels of air.
 */
const HOVER_GAP = 66;
const hideHover = () => { hoverTip.hidden = true; };

frame.addEventListener('mousemove', (ev) => {
  // Nothing to point AT mid-pan, and the dart hunt has replaced the pointer
  // with a sight — naming the thing you are about to shoot is not the game.
  if (sliding || hunt) return hideHover();
  const p = toLotPixel(ev as MouseEvent);
  // Same reach as the click, or the label would disagree with what a click does.
  const obj = rendered.byKey.get(rendered.raster.idNear(p.x, p.y));
  if (!obj?.flaggable) return hideHover();

  hoverTip.innerHTML = obj.first_seen
    ? `${obj.label}<span class="seen"> · first observed ${obj.first_seen}</span>`
    : obj.label;
  hoverTip.hidden = false;

  // Measured AFTER the text lands: the label decides the width, and placing it
  // off last frame's width makes it lag the cursor by one move.
  const st = frame.parentElement!.getBoundingClientRect();
  const w = hoverTip.offsetWidth;
  const h = hoverTip.offsetHeight;
  const x = clamp(ev.clientX - st.left, w / 2 + 4, st.width - w / 2 - 4);
  const above = ev.clientY - st.top - HOVER_GAP;
  // Near the top of the stage there is no room over the cursor, and the stage
  // clips. Sit under it instead of being cut in half.
  const below = above - h < 0;
  hoverTip.classList.toggle('below', below);
  hoverTip.style.left = `${x}px`;
  hoverTip.style.top = `${below ? ev.clientY - st.top + HOVER_GAP : above}px`;
});
// Leaving the lot, or leaving the window mid-move, has to put it away.
frame.addEventListener('mouseleave', hideHover);


$('btn-pass').onclick = () => stamp('PASS');
// A warning IS the adverse verdict until fines exist, which is why the early
// levels have two buttons rather than a greyed-out third.
$('btn-warn').onclick = () => stamp('NOTICE');
$('btn-fine').onclick = () => stamp('CITATION');
// --- Menu bar -------------------------------------------------------------
// Most items are inert on purpose and say when they unlock. A grayed row that
// reads "Permit Ledger — Day 9" tells the player the job gets bigger, which is
// worth more than hiding the tool until it appears.
document.querySelectorAll<HTMLElement>('[data-menu]').forEach((m) => {
  const btn = m.querySelector('button')!;
  btn.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = m.classList.contains('open');
    document.querySelectorAll('[data-menu]').forEach((o) => o.classList.remove('open'));
    if (!wasOpen) m.classList.add('open');
  };
});
window.addEventListener('click', () =>
  document.querySelectorAll('[data-menu]').forEach((m) => m.classList.remove('open')),
);

/**
 * Dev level select.
 *
 * Pacing is the thing being tuned now, and tuning it by replaying from Level 1
 * every time is how pacing goes untuned. Jumping lands on the level's briefing
 * rather than mid-route, because the briefing is where the level explains
 * itself and is exactly what needs reviewing.
 */
function buildDevMenu(): void {
  const drop = $('dev-drop');
  drop.innerHTML = LEVELS.map((l, i) => {
    const d = dateForLevel(l.level_id);
    return `<button data-level="${i}">Shift ${l.level_id}` +
      `<span class="lvl-when">${d.weekday.slice(0, 3)} ${d.label}</span></button>`;
  }).join('') + '<hr><button data-wipe="1">Wipe save &amp; restart</button>';

  drop.querySelectorAll<HTMLButtonElement>('button[data-level]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('[data-menu]').forEach((m) => m.classList.remove('open'));
      gotoLevel(Number(b.dataset.level));
    };
  });
  drop.querySelector<HTMLButtonElement>('button[data-wipe]')!.onclick = () => {
    reset();
    location.reload();
  };
}

/** Start a level from its briefing, with the round's state wound back. */
function gotoLevel(i: number): void {
  if (i < 0 || i >= LEVELS.length) return;
  cancelAnimationFrame(walkerRaf);
  loadLevel(i);
  routeIndex = 0;
  outcomes = [];
  flagged.clear();
  claimed.clear();
  bountyPay = 0;
  fineBonus = 0;
  bountyMark = null;
  clearTimeout(bountyTickTimer);
  resident = null;
  animal = null;
  passersby = [];
  escort = null;
  bountyAnimal = null;
  saveFile.inspector.strikes_today = 0;
  // Where the slot list reads "Shift 3" from, and where a resume lands. Written
  // when a shift BEGINS rather than when it ends: quitting halfway through a
  // round should put you back at the top of that round, not the one before it.
  saveFile.level_id = day.level_id;
  save(saveFile);
  stamping = false;
  sliding = false;
  syncDesk();
  briefing();
}

/**
 * TWO CONTROLS, ONE STATE. The corner icon and the Tools entry are the same
 * switch, so both are written from `sound.muted` rather than either of them
 * tracking a flag of its own.
 */
function syncMute(): void {
  const off = sound.muted;
  $('mi-mute').innerHTML = `Sound<span class="when">${off ? 'off' : 'on'}</span>`;
  $<HTMLImageElement>('mute-icon').src = `assets/sound-${off ? 'off' : 'on'}.svg${CB}`;
  const btn = $('mute');
  btn.setAttribute('aria-pressed', String(off));
  btn.setAttribute('aria-label', off ? 'Sound off' : 'Sound on');
}
const toggleMute = () => {
  sound.setMuted(!sound.muted);
  syncMute();
};
$('mi-mute').onclick = toggleMute;
$('mute').onclick = toggleMute;
syncMute();

$('zoom-in').onclick = () => setZoom(zoom + 1);
$('zoom-out').onclick = () => setZoom(zoom - 1);
syncZoomButtons();

/**
 * The drawer under the desk.
 *
 * Open, the paperwork is off the panel entirely — which also means the stamps
 * are, so the two `inert` calls are not decoration: without them a Tab still
 * lands on a PASS button sitting somewhere off to the left of the window, and
 * Enter stamps a verdict the player cannot see.
 */
function setDrawerOpen(open: boolean): void {
  const desk = $('desk');
  if (desk.classList.contains('open') === open) return;
  desk.classList.toggle('open', open);
  const h = $('desk-handle');
  h.setAttribute('aria-expanded', String(open));
  h.setAttribute('aria-label', open ? 'Close the drawer' : 'Open the drawer');
  $('desk-scroll').toggleAttribute('inert', open);
  $('stamps').toggleAttribute('inert', open);
  // No sound: there is no drawer effect in assets/, and the page-turn is paper.
}
$('desk-handle').onclick = () => setDrawerOpen(!$('desk').classList.contains('open'));

/**
 * Everything in the drawer can be picked up and moved.
 *
 * Position is left/top so `transform` stays free for the angle a thing was
 * dropped at — a key lying square to the drawer looks placed, and nothing in a
 * drawer is placed.
 *
 * The clamp works in VISUAL coordinates rather than layout ones, which is the
 * only reason a tilted item cannot be shoved half off the side: an element
 * rotated 14 degrees has a bounding box wider than its width, and clamping on
 * offsetWidth would let the corner leave the panel. The gap between the two is
 * fixed for the length of a drag, since the rotation does not change, so it is
 * measured once on pick-up.
 */
let dragTop = 0;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
function makeDraggable(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Whatever corner the thing was laid out from, it is dragged by left/top
    // from here on. Doing this once on pick-up means an item anchored bottom
    // right in the stylesheet does not have to be re-expressed as a top-left
    // offset that only holds at one window height.
    el.style.left = `${el.offsetLeft}px`;
    el.style.top = `${el.offsetTop}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    const box = $('desk-under').getBoundingClientRect();
    const vis = el.getBoundingClientRect();
    // Where in the item the player took hold of it.
    const grabX = e.clientX - vis.left;
    const grabY = e.clientY - vis.top;
    // Visual box minus layout box. Constant while the angle is.
    const skewX = vis.left - box.left - el.offsetLeft;
    const skewY = vis.top - box.top - el.offsetTop;

    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    // Whatever was picked up last is on top of the pile.
    el.style.zIndex = String(++dragTop);

    const move = (m: PointerEvent) => {
      const x = clamp(m.clientX - grabX - box.left, 0, box.width - vis.width);
      const y = clamp(m.clientY - grabY - box.top, 0, box.height - vis.height);
      el.style.left = `${x - skewX}px`;
      el.style.top = `${y - skewY}px`;
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
for (const el of document.querySelectorAll<HTMLElement>('#desk-under .dr-item')) makeDraggable(el);

$('mi-reset').onclick = () => {
  reset();
  location.reload();
};
$('mi-howto').onclick = () => briefing();

/**
 * What the buttons say, versus what the record calls it.
 *
 * The association writes NOTICE and CITATION; the desk has a WARNING stamp and
 * a FINE stamp. Same act, different register — so the mapping lives in one
 * place rather than the UI and the save file drifting into two vocabularies.
 */
const VERDICT_WORD: Record<string, string> = {
  PASS: 'PASS', NOTICE: 'WARNING', CITATION: 'FINE', FAIL: 'FINE',
};

/** Which stamps are on the desk this level. */
function syncStampButtons(): void {
  const three = day.verdict_mode === 'full';
  $('stamps').classList.toggle('three', three);
  $('btn-fine').hidden = !three;
}

function stamp(v: Verdict): void {
  if (stamping) return;
  stamping = true;
  syncDesk();

  const labels = new Map(rendered.objects.map((o) => [o.id, o.label]));
  // What the audit calls each object, and what counts as the same finding. Two
  // maps because they are two questions: the audit names the brown bin, the
  // coverage rule does not care which bin it was.
  const kinds = new Map(rendered.objects.map((o) => [o.id, o.group ?? o.label]));
  // The record has to exist BEFORE adjudication now: the grace clocks read
  // first_seen off it and escalation reads its rulings.
  const rec = recordFor(saveFile, current.lot_id, current.address);
  const outcome = adjudicate(current, labels, kinds, flagged, v, day.pay_per_inspection, {
    today: { iso: today.iso, weekday: today.weekday },
    timing: ARTICLE_TIMING,
    rec,
    waived: waivedBy(current, day.passes, today.iso),
  });
  outcomes.push(outcome);
  // Read here rather than at the next lot: `outcomes` is cleared per level and
  // the flag has to survive the pan, which is the only thing between the two.
  phonePending = !outcome.verdictRight;

  /**
   * Log the ruling with correctness UNRESOLVED. The audit fills it in later.
   *
   * The ARTICLE is the load-bearing part and it used to be the string 'R-101'
   * for everything — harmless while a ruling was only ever read back as a line
   * of prose on the case file, and wrong the moment escalation started asking
   * which article this address had already been warned about. Taken off the
   * lot's own truth now; null for anything marked that was not a violation.
   */
  const articleOf = new Map(current.truth.violations.map((x) => [x.object, x.article]));
  rec.rulings.push({
    day_id: day.level_id,
    date: today.iso,
    verdict: v,
    findings: [...flagged].map((object) => ({ object, article: articleOf.get(object) ?? null })),
    correct: null,
  });
  // The base salary: paid for turning up at the address, whatever you decide
  // there. The only money the job pays without asking anything of you.
  saveFile.inspector.pay += day.pay_per_inspection;
  /**
   * A cut of the fine — and only of a fine that STANDS.
   *
   * "From the fine" is the whole of it: the Association pays the inspector out
   * of what it collects, and it collects nothing on a citation the homeowner
   * appeals and wins. Which is what keeps this from being a bounty on stamping
   * FINE at everything, since a wrong one is also a billed mistake tonight.
   */
  if (v === 'CITATION' && outcome.verdictRight) {
    fineBonus += FINE_BONUS;
    saveFile.inspector.pay += FINE_BONUS;
  }
  save(saveFile);

  // The verdict lands as ink on the case file. Still no feedback on whether it
  // was RIGHT — that waits for the audit; this is only the physical act of
  // stamping, which is what the player just did.
  sound.play('stamp');
  // A warning and a fine are different marks. No level runs in 'full' mode
  // yet, so CITATION is unreachable in play, but the art is there for when
  // fines are switched on.
  stampMark.src = v === 'PASS' ? 'assets/stamp-pass.png'
    : v === 'CITATION' ? 'assets/stamp-fine.png'
    : 'assets/stamp-warning.png';
  stampMark.classList.remove('on');
  // Force a reflow so re-stamping restarts the animation rather than skipping it.
  void stampMark.offsetWidth;
  stampMark.classList.add('on');

  // Long enough to read the impression land, short enough that it does not
  // become a wait. The drive that follows is the longer beat.
  setTimeout(() => {
    if (routeIndex + 1 < day.lots.length) slideToLot(routeIndex + 1);
    else endDay();
  }, 820);
}

/**
 * Drive to the next house.
 *
 * The whole street slides left and the next lot arrives from the right, so the
 * route reads as a drive rather than a slideshow. Ground tiles are phased by
 * world position (see renderLot's worldX), which is what lets two separately
 * rendered lots meet without a seam down the middle of the pan.
 */
function slideToLot(index: number): void {
  const sz = stageSize();
  const next = renderToCanvas(LOTS[day.lots[index].lot_id], index * sz.w);

  // Respect a reduced-motion preference: the transition is decorative, and a
  // full-screen horizontal pan is exactly the kind of thing that triggers
  // vestibular discomfort.
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !currentCanvas) {
    loadLot(index);
    return;
  }

  const from = currentCanvas;
  // Built once, before the first frame: rebuilding a full-frame layer inside
  // the animation would cost more than the pan is worth.
  const fromGlow = currentGlow;
  const nextGlow = glowLayerFor(next.rl, LOTS[day.lots[index].lot_id]);
  // Half the previous speed. A slower pan reads less like a UI transition and
  // more like actually rolling down the block to the next address.
  const DURATION = 1800;
  const start = performance.now();
  sliding = true;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sliding = false;
    // Adopt the arrived lot without re-rendering it.
    routeIndex = index;
    current = LOTS[day.lots[index].lot_id];
    rendered = next.rl;
    currentCanvas = next.cv;
    currentProps = propLayerFor(rendered);
    currentGlow = glowLayerFor(rendered, current);
    flagged = new Set();
    centroidCache.clear();
    stamping = false;
    const rec = recordFor(saveFile, current.lot_id, current.address);
    for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? today.iso);
    save(saveFile);
    barkCtx = barkContextFor(current);
    resident = makeWalker(current, rendered);
    animal = makeAnimal(current, rendered);
    bountyAnimal = makeBountyAnimal(current, rendered);
    passersby = makeTraffic(current, rendered, resident ? [resident.walker.character] : []);
    startWalkerLoop();
    startHunt();
    renderCaseFile(rec);
    paint();
    syncDesk();
    phoneOnArrival();
  };

  /**
   * Backstop. requestAnimationFrame is suspended when a page is not painting —
   * a backgrounded tab, or an embedded view that only draws on demand. Measured
   * zero callbacks in a full second inside one such viewer. The easing is
   * wall-clock based so it cannot run slow, but it CAN sit unfinished, and an
   * unfinished slide leaves the route stuck on a lot that has already been
   * stamped. This guarantees arrival whether or not a frame ever lands.
   */
  const guard = setTimeout(finish, DURATION + 500);

  const frame = (now: number) => {
    if (done) return;
    const t = Math.min(1, (now - start) / DURATION);
    // Ease in and out: a car pulling away and settling, not a linear wipe.
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const dx = Math.round(-e * sz.w);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, sz.w, sz.h);
    ctx.drawImage(from, dx, 0);
    ctx.drawImage(next.cv, dx + sz.w, 0);
    // Both lots are scene, so both go under the same wash — and each carries
    // its own lights at its own offset. See washNight.
    washNight(sz.w, sz.h, [[fromGlow, dx], [nextGlow, dx + sz.w]]);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      clearTimeout(guard);
      finish();
    }
  };
  requestAnimationFrame(frame);
}

/**
 * The Inspection Manager's header. `gif` picks which of her two talking loops
 * plays — the briefing and the audit are different conversations, so they get
 * different deliveries.
 */
let bossTimer = 0;

/**
 * Cycle her between the still portrait and her two talking loops.
 *
 * A face that mouths continuously for as long as a panel is open stops reading
 * as speech and starts reading as a glitch. Talking in bursts with pauses
 * between them is what makes it look like someone delivering something.
 */
function startBossIdle(): void {
  clearTimeout(bossTimer);
  const img = document.querySelector<HTMLImageElement>('.boss-photo img');
  if (!img) return;
  const talk = ['boss1.gif', 'boss2.gif'];
  let n = 0;
  const rest = () => {
    img.src = 'assets/boss.jpg' + CB;
    bossTimer = setTimeout(speak, 3200 + Math.random() * 3500) as unknown as number;
  };
  const speak = () => {
    // Alternate the two loops rather than picking at random, so the same one
    // never runs twice in a row.
    img.src = 'assets/' + talk[n++ % talk.length] + CB;
    bossTimer = setTimeout(rest, 2600 + Math.random() * 1800) as unknown as number;
  };
  speak();
}

function bossHeader(gif: 'boss1' | 'boss2'): string {
  return `
    <div class="boss">
      <div class="boss-photo">
        <img src="assets/${gif}.gif" alt="" />
        <img class="paperclip" src="assets/paperclip.png" alt="" />
      </div>
      <div class="boss-id">
        <div class="role">Inspection Manager</div>
        <div class="who">${gif === 'boss1' ? 'Your morning briefing' : "Your day, reviewed"}</div>
        <div class="org">She reports to the Board. You report to her.</div>
      </div>
    </div>`;
}

/**
 * ONE definition of a clean lot, so the accuracy figure, the ruling record, the
 * marks on the report and the tally on the audit header cannot drift apart.
 * They had: accuracy once ignored missed findings, so a day could show a red
 * mark on half its rows and still report 100%. A report that argues with itself
 * is worse than no report — the player stops believing any of it.
 *
 * Clean means NO EXCEPTIONS. Not merely that the verdict was right.
 *
 * Now literally the inverse of a strike, since a missed violation became one.
 * Defined off `strike` rather than restating its three terms — two copies of
 * the same predicate in two files is how the report starts disagreeing with the
 * pay stub, which is the exact fault this was written to fix.
 */
const lotClean = (o: LotOutcome): boolean => !o.strike;

/**
 * ONE mark for the day, off the mistake count and nothing else.
 *
 * Mistakes are already the thing the game charges you for, so grading on
 * anything else would put a second, quieter score next to the one that actually
 * costs money. A day with a mistake is not an A however tidy the rest of it was
 * — even the forgiven one, because forgiven is not the same as unnoticed.
 *
 * There is no D. Four grades for four outcomes, and the gap where a D should be
 * is deliberate: it makes the drop from C to F read as falling off a cliff,
 * which is what a third mistake is once two of them are being billed.
 */
const GRADE = [
  { mark: 'A+', cls: 'g-a' },
  { mark: 'B', cls: 'g-b' },
  { mark: 'C', cls: 'g-c' },
  { mark: 'F', cls: 'g-f' },
];

// --- What a shift is worth, and what it costs ------------------------------
/**
 * THE ARRANGEMENT.
 *
 * The Association does not sack you for being wrong. It bills you for it, once
 * a shift, after the fact — which is a worse thing to be on the end of, and the
 * only reason it can afford to be generous with the first one.
 *
 * The numbers are here rather than in the level files on purpose: `quota` and
 * `pay_per_inspection` are what a ROUND is worth and change with the content,
 * while these are the terms of employment and are the same on every shift. One
 * of them moving without the others is how an economy stops making sense.
 */
/**
 * "$48", and "-$2" rather than "$-2".
 *
 * A balance could not go negative before this round, so nothing ever had to
 * decide where the sign went. It can now, and the minus belongs in front of the
 * whole amount the way it is written on a statement.
 */
const money = (n: number) => (n < 0 ? `-$${-n}` : `$${n}`);
/** Mistakes forgiven per shift. Everything past this is billed. */
const FREE_MISTAKES = 1;
/** What each billed mistake costs. Two of them is most of a shift's wages. */
const MISTAKE_COST = 25;
/** The inspector's cut of a fine that stands. */
const FINE_BONUS = 20;
/**
 * Billed mistakes across the last two shifts that end the arrangement. STRICTLY
 * more than this — four is a warning you survive, five is not.
 */
const MAX_RECENT_DEDUCTIONS = 4;
/** How many shifts "recently" means for that count. */
const DEDUCTION_WINDOW = 2;

// --- End of day: the audit ------------------------------------------------

function endDay(): void {
  // The last lot of the shift has no next house to be called at, and the audit
  // is about to say the same thing at length anyway.
  phonePending = false;
  hangUp();
  /**
   * The shift ends; anything still not found stays on the wall.
   *
   * Recorded HERE rather than when the notice goes up, so a bounty claimed
   * during the round never touches the list at all. Every posted notice is
   * checked, not just the round's own — walking past a carried-forward flyer
   * for a second time must not quietly take it down.
   */
  for (const b of postedNotices()) if (!claimed.has(b.id)) markOutstanding(b);
  let strikes = 0;
  for (const o of outcomes) {
    if (o.strike) strikes++;
    const clean = lotClean(o);
    bumpAccuracy(saveFile, 'R-101', clean);
    const rec = saveFile.addresses[o.lot_id];
    const last = rec.rulings[rec.rulings.length - 1];
    if (last) last.correct = clean;
    rec.state = o.missed.length ? 'UNCAUGHT' : o.hits.length ? 'FLAGGED' : 'CLEAN';
    if (o.falsePositives.length) rec.disposition -= 1;
  }
  saveFile.inspector.strikes_today = strikes;

  /**
   * SETTLEMENT. The one moment money moves against the player.
   *
   * The first mistake of the shift is forgiven and the rest are billed, which
   * is why this is counted at the end and not on the lot: you cannot know
   * whether the one you just made was the free one until the shift is over.
   */
  const billed = Math.max(0, strikes - FREE_MISTAKES);
  const penalty = billed * MISTAKE_COST;
  saveFile.inspector.pay -= penalty;

  const history = (saveFile.inspector.deductions ??= []);
  history.push(billed);
  const recent = history.slice(-DEDUCTION_WINDOW).reduce((a, b) => a + b, 0);

  // Order matters. Broke is checked first because it is the more final of the
  // two and reads worse — being told you were sloppy while your balance is
  // also gone is the Association burying the lede.
  const firedWhy =
    saveFile.inspector.pay <= 0
      ? 'Your balance is gone. The Association does not carry an inspector it is owed money by.'
      : recent > MAX_RECENT_DEDUCTIONS
        ? `${recent} deductions in ${DEDUCTION_WINDOW} shifts. The Board has reviewed the pattern.`
        : null;
  save(saveFile);
  /**
   * Dismissed is the end of the file, so the file goes.
   *
   * Deleted here rather than left on the title as a dead row: a save that
   * cannot be resumed is not a save, and a list of them would grow forever with
   * no way to clear it. The stub on screen is the only record the player gets,
   * which is the right amount of record for a run that ended this way.
   *
   * After this, `save()` has no slot to write to and quietly does nothing —
   * which is what should happen to anything the audit screen tries to record.
   */
  if (firedWhy) reset();
  sound.bed('office');
  sound.play('money');
  $('flyer').hidden = true;

  const pay = outcomes.length * day.pay_per_inspection;
  const shortfall = day.quota - outcomes.length;
  const acc = Math.round(cumulativeAccuracy(saveFile) * 100);

  const rows = outcomes
    .map((o) => {
      const bits: string[] = [];
      for (const h of o.hits) bits.push(`<div>✓ Upheld — ${h.label} (${h.article})</div>`);
      for (const m of o.missed)
        bits.push(
          `<div><b>Audit finding</b> — ${m.label} (${m.article}) was present and not cited.<br>
           <span class="muted">${m.why}</span></div>`,
        );
      for (const f of o.falsePositives)
        bits.push(
          `<div><b>Appeal granted</b> — ${f.label}. The Association pays costs.<br>
           <span class="muted">${f.why}</span></div>`,
        );
      const ok = lotClean(o);
      return `<div class="verdict-row ${ok ? 'good' : 'bad'}">
        <img class="mark" src="assets/${ok ? 'good' : 'bad'}.png" alt="${ok ? 'clean' : 'exception taken'}" />
        <b>${o.address}</b> — you stamped ${VERDICT_WORD[o.stamped] ?? o.stamped}; correct verdict was ${VERDICT_WORD[o.expected] ?? o.expected}.
        ${bits.join('') || '<div>No exceptions taken.</div>'}
      </div>`;
    })
    .join('');

  // Clamped: the round is meant to end on the third strike, but the mark should
  // not depend on that holding.
  const dayGrade = Math.min(strikes, GRADE.length - 1);
  // The shift is over, so the sheet settles. Everything earned today lands in
  // one movement, behind the audit the player is about to read.
  bankShown = saveFile.inspector.pay;
  syncDesk();
  /**
   * The audit is FOLDED AWAY by default, and this is what has to survive the
   * fold. Shut, the sheet reads as a receipt — grade, pay, balance — and the
   * lot-by-lot argument is there for anyone who wants it. But a collapsed
   * section that gives no hint of its contents is one nobody opens, and the
   * audit is the part the player most needs to take seriously. The count is the
   * hook: it says how much you got wrong without saying where.
   */
  const exceptions = outcomes.filter((o) => !lotClean(o)).length;
  const hasNext = levelIndex + 1 < LEVELS.length;
  sheet.innerHTML = `
    <div class="day-mark ${GRADE[dayGrade].cls}" aria-label="Grade ${GRADE[dayGrade].mark}">${GRADE[dayGrade].mark}</div>
    ${bossHeader('boss2')}
    <h1>END OF LEVEL ${day.level_id}</h1>
    <div class="muted">${today.weekday}, ${shortDate(today.iso)} · ${routeStreets().join(', ')}</div>

    <details class="audit">
      <summary>Board Audit<span class="tally">${
        exceptions ? `${exceptions} of ${outcomes.length} with findings` : 'no exceptions taken'
      }</span></summary>
      <p class="muted">Findings are reviewed the following morning. You were not told at the time.</p>
      ${rows}
    </details>

    <h3>Pay Stub</h3>
    <div class="today-line"><span>Base salary — ${outcomes.length} inspections × $${day.pay_per_inspection}</span>
      <span class="money">$${pay}</span></div>
    ${fineBonus > 0 ? `<div class="today-line"><span>Share of fines collected</span>
      <span class="money fee">$${fineBonus}</span></div>` : ''}
    ${bountyPay > 0 ? `<div class="today-line"><span>Finder's fee</span>
      <span class="money fee">$${bountyPay}</span></div>` : ''}
    ${
      penalty > 0
        ? `<div class="today-line"><span>Errors charged — ${billed} × $${MISTAKE_COST}
             <span class="muted">(first ${FREE_MISTAKES} forgiven)</span></span>
           <span class="money debit">&minus;$${penalty}</span></div>`
        : ''
    }
    <div class="today-line"><span><b>Total for the round</b></span>
      <span class="money total">${money(pay + fineBonus + bountyPay - penalty)}</span></div>
    <div class="today-line"><span>Balance</span>
      <span class="money">${money(saveFile.inspector.pay)}</span></div>
    ${shortfall > 0 ? `<p class="muted">Quota was ${day.quota}. Short ${shortfall}.</p>` : ''}
    <p>Mistakes today: <b>${strikes}</b>${
      penalty > 0
        ? ` — ${FREE_MISTAKES} forgiven, ${billed} charged`
        : `. ${strikes ? 'Forgiven.' : 'None.'}`
    } &nbsp;·&nbsp; Cumulative accuracy: <b>${acc}%</b>
       ${acc < 70 ? '<br><span class="muted">Below 70%. The Board reviews an inspector who stays there.</span>' : ''}</p>

    ${
      firedWhy
        ? `<div class="dismissed">
             <h2>NOTICE OF DISMISSAL</h2>
             <p>${firedWhy}</p>
             <p class="muted">Your access to the E-Binder has been revoked. Leave the stamps on the desk.</p>
           </div>
           <p style="margin-top:18px">
             <button class="btn primary" id="btn-after">Back to title</button>
           </p>`
        : `<p style="margin-top:18px">
             <button class="btn primary" id="btn-after">${hasNext ? `Begin Level ${LEVELS[levelIndex + 1].level_id}` : 'Run this level again'}</button>
           </p>`
    }
  `;
  overlay.classList.add('on');
  // Reloading was fine when there was only one day. Now there is a next level
  // to go to, and only the last one has nothing to advance into.
  $('btn-after').onclick = () => {
    // Dismissed is the end of the file, not the end of the session. Back to the
    // title, where the run is listed as what it turned out to be.
    if (firedWhy) {
      location.reload();
      return;
    }
    hasNext ? gotoLevel(levelIndex + 1) : gotoLevel(levelIndex);
  };
  startBossIdle();
}

// --- Boot -----------------------------------------------------------------

/**
 * The morning briefing, paged.
 *
 * It used to be four paragraphs of gray text that DESCRIBED the rules coming
 * into play. A rule introduced in prose is a rule the player meets for the
 * first time on the lot; introduced with its own art, beside the near-miss it
 * has to be told apart from, it is a rule they arrive already holding.
 *
 * Three pages: who you are and what today is, what is live and what it looks
 * like, then the route. The how-to-play page only appears on Level 1.
 */
/** Which articles the BRIEFING has expanded. Separate from the binder's own
 *  set, so reading a rule at the morning meeting does not leave the book open
 *  at that page for the rest of the round. */
const briefExpanded = new Set<string>();

/**
 * A desk calendar showing today, as markup.
 *
 * The one on the desk is a fixed element the desk sync writes into; this builds
 * a second, self-contained copy for the briefing panel, which is rebuilt from
 * scratch on every page turn. Same classes, so both are the same object — the
 * date on the manager's desk cannot drift from the date on yours.
 */
function calendarMarkup(extraClass = ''): string {
  return `
    <div class="cal ${extraClass}">
      <div class="cal-spine" aria-hidden="true">
        <i class="h-start"></i><i class="h-mid"></i><i class="h-end"></i>
      </div>
      <div class="cal-dow">${today.weekday}</div>
      <div class="cal-date">${shortDate(today.iso)}</div>
    </div>`;
}

/**
 * SHE TALKS. The briefing's opening beats type themselves in.
 *
 * A paragraph that is already on the page has been said; a paragraph arriving a
 * character at a time is being said, and that is the difference between a wall
 * of exposition and somebody addressing you. The pauses are where the timing
 * lives — a beat between paragraphs, and a longer one after a line that lands.
 *
 * SKIPPABLE, always. A player on their second run should not have to sit
 * through it, so any click or key finishes the whole thing instantly. An
 * unskippable cutscene is a worse crime than a silent one.
 *
 * Runs once per level. The sheet re-renders whenever a read-more is toggled,
 * and retyping the manager's dialogue every time would be maddening.
 */
const TYPE_MS = 16;
/** Between paragraphs. */
const BEAT_MS = 380;
/** Extra, after a paragraph that ends on a full stop and wants to land. */
const LAND_MS = 320;
let typedLevel = -1;
let typeCancel: (() => void) | null = null;

function typeStory(root: HTMLElement): void {
  const ps = [...root.querySelectorAll<HTMLElement>('p[data-type]')];
  if (!ps.length) return;
  const full = () => { for (const p of ps) { p.textContent = p.dataset.type ?? ''; } };
  if (typedLevel === day.level_id) { full(); return; }
  typedLevel = day.level_id;

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    typeCancel = null;
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('keydown', stop, true);
    full();
  };
  typeCancel = stop;
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('keydown', stop, true);

  void (async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const p of ps) {
      const text = p.dataset.type ?? '';
      for (let i = 0; i < text.length; i++) {
        if (stopped) return;
        p.textContent = text.slice(0, i + 1);
        await wait(TYPE_MS);
      }
      if (stopped) return;
      await wait(BEAT_MS + (text.endsWith('.') ? LAND_MS : 0));
    }
    stop();
  })();
}

/**
 * What the Association knows about you, dropped into her dialogue.
 *
 * Both fall back to something impersonal, because a save written before the
 * application existed has neither — and "you" is in character for her anyway.
 */
function fillTokens(t: string): string {
  const ins = saveFile.inspector;
  const st = HOME_STREETS.find((x) => x.id === ins.street)?.name;
  return t
    .replace(/\{name\}/g, ins.name || 'Inspector')
    .replace(/\{address\}/g, ins.house && st ? `${ins.house} ${st}` : 'the address on your form');
}

/**
 * The streets the player may claim as home.
 *
 * Everything on the map with a character written for it. Whistling Sparrow is
 * excluded on purpose: the street data says in as many words that it has no
 * phase, role or position yet, and letting somebody live on it would invent
 * those by the back door.
 */
const HOME_STREETS = (streetsData.streets as Array<{ id: string; name: string; role: string }>)
  .filter((s) => s.role !== 'unassigned');

function briefing(): void {
  /**
   * DRAWN BEFORE THE BOARD IS BUILT, not on the way out to the street.
   *
   * A person bounty has no face until this runs — it picks one from the sheet —
   * and the corkboard's whole job is to show that face. Drawing it at the end
   * of the briefing, which is where it used to happen, printed a notice with a
   * blank where the photograph goes.
   *
   * Safe to move earlier because it is seeded off the level id alone: same lot,
   * same face, whenever it is called. briefing() is the only route to the round
   * — the button that starts one lives inside it — so once here is enough.
   */
  placeBounty();

  /**
   * Only what is NEW today.
   *
   * The briefing used to list every live article, so by Level 4 it was three
   * paragraphs the player had already read and one they had not — which is how
   * the one that matters gets skimmed past. Everything introduced so far stays
   * in the binder, permanently, which is what the binder is for.
   */
  const fresh = ARTICLES.filter(
    (a) => (a as { introduced_level?: number }).introduced_level === day.level_id
      && day.active_rules.includes(a.id),
  );

  /**
   * Rendered as BINDER PAGES, by the binder's own function.
   *
   * A new article is introduced here and lived with in the book, and the two
   * used to look nothing alike — the briefing had a tagged header and a boxed
   * pair of thumbnails, the binder a compact entry with a read-more. Sharing
   * one renderer means the thing you are shown at the morning meeting is
   * literally the page you will be turning to at the third house.
   */
  const exhibits = () => fresh.map((a) => binderEntry(a as Article, briefExpanded)).join('');

  /**
   * A beat may be a QUESTION rather than a line.
   *
   * Asked inline, in the middle of what the manager is already saying, because
   * that is what it is — she is making conversation while she reads your file,
   * not opening a settings screen. It sits where "You're at 2118 Eyezetta, yes?"
   * used to, which told the player where they lived instead of asking.
   *
   * Answering is optional and she moves on either way. Gating the first round
   * of the game on a dropdown would be a worse first impression than not
   * knowing the answer.
   */
  const beats = () => ((day as { story?: string[] }).story ?? [day.briefing]).map(fillTokens);
  /**
   * Rendered EMPTY, with the words in a data attribute.
   *
   * typeStory fills them in afterwards. Putting the text in the markup and
   * hiding it would mean a screen reader, or anyone who lands mid-animation,
   * gets the paragraph twice.
   */
  const storyBeats = () => beats()
    .map((t) => `<p data-type="${t.replace(/"/g, '&quot;')}"></p>`)
    .join('');

  /**
   * PARKED, not deleted.
   *
   * Backstory is FOUND, never told: the artifact is a thing on the desk in a
   * different hand from the Association's, which is why it gets its own
   * register. The four that were written — Shifts 2, 4, 6 and 8 — are still in
   * their level files under `_artifact`, the underscore being what takes them
   * out of play. Rename the key back and put `${artifact}` on the first page
   * and the thread is running again.
   */
  const art0 = (day as { artifact?: { title: string; text: string } }).artifact;
  const artifact = art0
    ? `<div class="artifact"><h4>${art0.title}</h4><p>${art0.text}</p></div>`
    : '';
  void artifact;

  /**
   * THE DAY THE THIRD STAMP ARRIVES.
   *
   * Shift 2 is the first round in `full` verdict mode, and escalation is the
   * one rule the player cannot work out by looking at a lot: whether an address
   * gets a warning or a fine depends on what THEY wrote there before, and the
   * only place that is recorded is the case file on their own desk.
   *
   * Shown with the stamp rather than described, for the same reason the
   * articles are introduced with their exhibits — a control the player meets
   * for the first time on the lot is a control they misuse on the lot.
   */
  /**
   * WHICH WEEK IT IS, but only on a day when that is the question.
   *
   * A green bin at the curb on a Thursday is a finding whichever week it is —
   * the weekday window has already decided it — so telling the player about the
   * collection cycle on a Thursday is noise that reads like the reason. The
   * cycle is only the deciding fact on the two days a container may legally be
   * out at all, and on those days it is worth saying either way round: this is
   * the week, or this is not.
   */
  const recyclingAlert = (): string => {
    if (!day.active_rules.includes('R-110')) return '';
    if (!RECYCLING_DAYS.includes(today.weekday)) return '';
    return isCollectionWeek(today.iso, RECYCLING_WEEK)
      ? `<p class="brief-alert"><b>Recycling runs this week.</b> It is ${today.weekday}, so a green
           container at the curb is compliant today — and so is the brown one. Neither is on any
           other day of the week.</p>`
      : `<p class="brief-alert"><b>This is the off week.</b> No recycling truck is coming, so a
           green container at the curb is a finding even though it is ${today.weekday} — and the
           brown one beside it is not. Write up every green bin you see.</p>`;
  };

  const fineNote = day.level_id === 2
    ? `<div class="brief-note">
         <img src="assets/fine.png" alt="" />
         <div>
           <p><b>There is a third stamp on the desk from today.</b> A warning is for
              something you have not written up at this address before.</p>
           <p>If you HAVE — if the case file shows you already warned them under that
              same article — a second warning is the wrong call. Today that is a fine.</p>
         </div>
       </div>`
    : '';

  /**
   * Rebuilt on every render, not built once.
   *
   * The new-article page contains read-more entries whose open/shut state is
   * baked into the markup, so a page held as a constant string cannot change
   * when one is expanded — the click toggled the set and re-rendered stale
   * HTML. Anything with state in it has to be regenerated at draw time.
   */
  const buildPages = (): string[] => {
  // No date heading: the calendar in the corner of the panel is the date, and
  // printing it twice on the same sheet is how a prop stops being a prop.
  const pages: string[] = [
    `<h3>This morning</h3>
     <div class="story">${storyBeats()}</div>
     ${fineNote}`,
  ];
  // Levels that add no article skip the page entirely rather than show an
  // empty one — Level 3 introduces nothing, it just changes the day.
  if (fresh.length) pages.push(
    `<h3>New today</h3>
     <p class="muted" style="margin-bottom:12px">Added to the binder as of this morning.
        Everything already in there still applies — look it up before you stamp.</p>
     ${recyclingAlert()}
     <div class="bk-leaf">
       <div class="bk-leaf-book">
         <div class="bk-leaf-page">${exhibits()}</div>
       </div>
       <!-- A sibling of the page, never a child: the page is clipped to its
            stepped corners and a clip-path takes its descendants with it. -->
       <div class="bk-leaf-spine" aria-hidden="true">
         <i class="r-top"></i><i class="r-mid"></i><i class="r-bot"></i>
       </div>
     </div>`);
  pages.push(`<h3>Today's round</h3>
     <div class="today-line"><span>Inspections</span><b>${day.lots.length} across ${routeStreets().length} streets</b></div>
     <div class="today-line"><span>Route</span><b>${routeStreets().join(', ')}</b></div>
     <div class="today-line"><span>Pay</span><b>$${day.pay_per_inspection} each</b></div>
     <div class="today-line"><span>Verdicts</span><b>${day.verdict_mode === 'notice' ? 'Pass or Notice — no fines today' : 'Pass, Notice or Citation'}</b></div>
     <p style="margin-top:14px">Mark what you find, then stamp. You will not be told
        whether you were right — the Board reviews your calls overnight.</p>`);
  /**
   * THE BOARD, and always last.
   *
   * A notice used to be a sentence in the manager's briefing and a number on
   * the round summary — which made the thing you are supposed to go out and
   * RECOGNISE something you had read about rather than looked at. It gets a
   * screen of its own now, the last one before the street, showing the actual
   * paper you will be carrying: same markup, same face, still pinned.
   *
   * Only when there is one. An empty corkboard is worse than no corkboard.
   */
  const notes = day.bounty ? postItMarkup() : [];
  if (day.bounty) pages.push(
    `<h3>Posted on the route</h3>
     <p class="muted" style="margin-bottom:14px">The Association has authorised a finder's fee of
        $${day.bounty.reward}. This is not a compliance matter.</p>
     <div class="board"><div class="board-cork">
       <div class="board-col">${notes.slice(0, 2).join('')}</div>
       <div class="board-note">${flyerMarkup()}</div>
       <div class="board-col">${notes.slice(2).join('')}</div>
     </div></div>`);
  /**
   * The how-to only earns its place the first time, and it goes BEFORE the
   * articles rather than after them.
   *
   * Index 1, immediately behind her opening. What the articles say only means
   * anything once you know that reading them is the job — shown the other way
   * round, the first thing a new player sees after being hired is three
   * regulations and no idea what they are for.
   */
  if (day.level_id === 1) {
    pages.splice(1, 0,
      `<h3>How this works</h3>
       <div class="howto">
         <img src="assets/binder.png" alt="" />
         <p><b>Read the binder first.</b> It holds every article you have been trained on, and
            each one carries an enforcement-limits note folded underneath it. Those notes are
            load-bearing: most of what looks wrong on this street is allowed.</p>
         <img src="assets/camera.png" alt="" />
         <p><b>Then click anything on the lot</b> to mark it as a finding. Click it again to
            unmark. Plenty of what you can click is perfectly compliant — being able to click a
            thing is not the game telling you it is wrong.</p>
         <div class="hw-stamps">
           <img src="assets/pass.png" alt="" />
           <img src="assets/warning.png" alt="" />
         </div>
         <div>
           <p><b>Then stamp.</b> The verdict is about the lot, not the object.</p>
           <ul class="hw-verdicts">
             <li><b>Nothing wrong with it</b> — pass.</li>
             <li><b>Something wrong you have not written up here before</b> — warning.</li>
           </ul>
         </div>
       </div>
       <!-- The terms, in the Association's voice, on the one page that exists to
            tell a new inspector what they have agreed to. Deliberately not in
            the .howto grid: it is not a step, it is the deal. Fines are left
            out because there is no FINE stamp on the desk until Shift 2. -->
       <p class="hw-terms"><b>The arrangement.</b> You are paid a base salary for every
          inspection you complete. One mistake a shift is forgiven; every one after that is
          charged to you out of your balance at the end of the day. Empty that balance — or
          take more than ${MAX_RECENT_DEDUCTIONS} deductions across ${DEDUCTION_WINDOW}
          shifts — and the arrangement ends.</p>`);
  }
    return pages;
  };

  let page = 0;
  const render = () => {
    const pages = buildPages();
    sheet.innerHTML = `
      ${calendarMarkup('brief-cal')}
      ${bossHeader('boss1')}
      <div class="muted">Compliance Inspector &middot; Shift ${day.level_id}</div>
      ${pages.map((p, i) => `<div class="pg${i === page ? ' on' : ''}">${p}</div>`).join('')}
      <div class="pg-nav">
        <div class="pg-dots">${pages.map((_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn" id="pg-prev"${page === 0 ? ' disabled' : ''}>&larr; Back</button>
        <button class="btn primary" id="pg-next">${page === pages.length - 1 ? 'Begin route' : 'Next &rarr;'}</button>
      </div>`;
    $('pg-prev').onclick = () => { if (page > 0) { page--; render(); } };
    $('pg-next').onclick = () => {
      if (page < pages.length - 1) { page++; render(); return; }
      startRound();
    };
    const story = sheet.querySelector<HTMLElement>('.pg.on .story');
    if (story) typeStory(story);
    else typeCancel?.();
    // Same read-more as the binder's, against the briefing's own open set.
    sheet.querySelectorAll<HTMLButtonElement>('[data-more]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.more!;
        if (briefExpanded.has(id)) briefExpanded.delete(id);
        else briefExpanded.add(id);
        render();
      };
    });
  };
  render();
  overlay.classList.add('on');
  startBossIdle();
}

/**
 * The rest of the board.
 *
 * A corkboard holding one notice is a peg with a poster on it. What makes it a
 * board is everything ELSE pinned to it — the treadmill nobody wants, the cat
 * nobody asked to be fed, the fourth notice about locking your cars — which is
 * a street talking to itself, and the only place in the game it gets to.
 *
 * It also carries the story. One fixed posting per shift, sitting in among the
 * noise and looking like more of it. That is the whole trick: the thread about
 * the last inspector is legible only because everything around it is about
 * Pablo, so the ambient pool never references it and never should.
 *
 * Seeded off the level, so a board is the same board every time that shift is
 * played. A board that reshuffled on reload would be wallpaper.
 */
const POSTIT_SLOTS = 4;

function postItMarkup(): string[] {
  const rnd = seedFrom(`level${day.level_id}:board`);
  const notes = [...bulletinData.ambient];
  const out: string[] = [];
  const story = (bulletinData.story as Record<string, string>)[String(day.level_id)];
  if (story) out.push(story);
  while (out.length < POSTIT_SLOTS && notes.length)
    out.push(notes.splice(Math.floor(rnd() * notes.length), 1)[0]);
  // Shuffled AFTER, so the story posting is not always the top left one — the
  // player should have to read the board rather than learn where to look.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  /**
   * Nothing hangs straight on a corkboard, and nothing hangs like the thing
   * beside it.
   *
   * The DIRECTION is dealt, not rolled. Four draws off a symmetric range is not
   * enough samples to look symmetric — one board came up -1.6, -1.8, -1.5, -1.6,
   * which does not read as four notes pinned by four people in a hurry, it reads
   * as a container with a transform on it. Handing out two lefts and two rights
   * and shuffling WHICH note gets which keeps the variety without leaving it to
   * a coin that only gets flipped four times.
   *
   * Offsets are jitter and can stay random — a note a few pixels high is
   * unremarkable on its own and only has to avoid agreeing with its neighbour.
   * Bounded well inside the column gap so two notes never touch.
   */
  const signs = [-1, 1, -1, 1];
  for (let i = signs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [signs[i], signs[j]] = [signs[j], signs[i]];
  }
  return out.map((t, i) => {
    const tilt = ((1.4 + rnd() * 3.1) * signs[i]).toFixed(1);
    const dx = (rnd() * 14 - 7).toFixed(1);
    const dy = (rnd() * 12 - 6).toFixed(1);
    return `<div class="post-it t${i % 5}" style="--tilt:${tilt}deg;--dx:${dx}px;--dy:${dy}px">${t}</div>`;
  });
}

/**
 * The notice itself, wherever it is hanging.
 *
 * ONE renderer for both places it appears — the board at the briefing and the
 * corner of the stage for the rest of the round. They are the same piece of
 * paper, and the player is meant to recognise it as such: what they studied
 * before setting off is literally what stays clipped up while they look. Two
 * copies of this markup would eventually disagree about something, and the
 * thing they would disagree about is the face you are supposed to be matching.
 *
 * Returns classes and no ids, so it can be dropped in twice.
 */
function flyerMarkup(b: Bounty | undefined = day.bounty, pinned = true): string {
  if (!b) return '';
  /**
   * Whose face, for a notice that may not be this level's.
   *
   * A pinned character is the same man whatever round it is. A drawn one is
   * only known for the bounty the level actually placed — so a second notice
   * for somebody the level did not place shows their sprite if the notice
   * names one and nothing if it does not, rather than borrowing the face of
   * whoever this round happens to be looking for.
   */
  /**
   * A face is DRAWN PER ROUND, so a notice for somebody this round did not
   * place has none to show — and a sheet with no picture on it is a third
   * shorter than the ones beside it in the stack, which reads as a broken
   * flyer rather than as a flyer about a face nobody has drawn.
   *
   * So it falls back to the face this notice was FIRST drawn with, kept in
   * the save when the round that posted it placed him. Nothing to borrow only
   * on a save that pre-dates the record.
   */
  const character = faceOf(b);
  // A prop shows its own sprite; a person is a window onto the resident sheet,
  // so the face on the notice IS the sprite to spot and cannot drift from it.
  const isPerson = b.kind === 'person' && character !== null;
  let pic = '';
  if (isPerson) {
    // Their south-facing idle frame, at 2x, positioned by row and column.
    const Z = 2;
    const row = character! * RESIDENTS.rowsPerCharacter;
    pic = `<div class="fl-face" style="background-image:url('${RESIDENTS.sheet}${CB}');`
      + `background-size:${RESIDENTS.sheetW * Z}px ${RESIDENTS.sheetH * Z}px;`
      + `background-position:-${RESIDENTS.idleCol * RESIDENTS.frameW * Z}px -${row * RESIDENTS.frameH * Z}px;`
      + `width:${RESIDENTS.frameW * Z}px;height:${RESIDENTS.frameH * Z}px"></div>`;
  } else if (b.sprite) {
    pic = `<img class="fl-pic" src="assets/${b.sprite}.png${CB}" alt="" />`;
  }
  return `
    <div class="fl-paper">
      ${pinned ? '<img class="fl-pin" src="assets/pin.png" alt="" />' : ''}
      <div class="fl-head">${b.headline ?? 'Missing'}</div>
      ${pic}
      <div class="fl-name">${b.name}</div>
      <div class="fl-reward">$${b.reward} reward</div>
      <div class="fl-owner">${b.note}</div>
      ${claimed.has(b.id) ? '<img class="fl-found" src="assets/checkmark.png" alt="Found" />' : ''}
    </div>`;
}

/**
 * The notice pinned to the corner of the stage.
 *
 * Stays up for the whole round once the level has a bounty — a reward poster
 * that vanished the moment you claimed it would take the reminder away at the
 * exact point it becomes a receipt. Claimed just stamps a tick across it.
 */
/**
 * Every notice currently posted, which is not always one.
 *
 * The level's own, plus the thief if he is still outstanding and is not that
 * notice already. He stays up through the daylight rounds — the Association
 * does not take a notice down because it is Tuesday — and on those rounds the
 * paper is all there is of him: placeBounty leaves him off the street until it
 * is dark again.
 */
function postedNotices(): Bounty[] {
  const out: Bounty[] = [];
  // Today's first, because it is the one the briefing just talked about.
  if (day.bounty) out.push(day.bounty);
  for (const b of outstandingBounties()) if (!out.some((x) => x.id === b.id)) out.push(b);
  return out;
}

/**
 * Which of the posted notices is on top. Loops, and survives a re-render.
 */
let flyerTop = 0;

function syncFlyer(): void {
  const el = $('flyer');
  const notes = postedNotices();
  el.hidden = notes.length === 0;
  if (!notes.length) { el.innerHTML = ''; return; }
  flyerTop %= notes.length;

  /**
   * STACKED, not listed. Two notices side by side is a noticeboard; two pinned
   * through the same tack, one a few pixels off the other, is what actually
   * happens to a corner of a wall that people keep putting paper on.
   *
   * Only the front sheet gets the pin — the ones underneath are behind it, and
   * a second tack floating over a sheet it does not hold reads as a mistake.
   * Each sheet casts a hard shadow onto the one below, which is the only thing
   * telling the player there is more than one.
   */
  el.classList.toggle('stacked', notes.length > 1);
  const order = notes.map((_, i) => (flyerTop + i) % notes.length);
  el.innerHTML = order
    .map((n, depth) => {
      const b = notes[n];
      // `order` runs front to back, so depth IS the depth. Reversed on the way
      // out so the front sheet is last in the DOM and needs no z-index.
      return `<div class="fl-note${claimed.has(b.id) ? ' found' : ''}${depth === 0 ? ' top' : ''}"
                   style="--depth:${depth}">${flyerMarkup(b, depth === 0)}</div>`;
    })
    .reverse()
    .join('')
    + (notes.length > 1
      ? `<div class="fl-flip">
           <button type="button" data-flip="-1" aria-label="Previous notice">
             <img class="flip" src="assets/rulebook/next-page.png${CB}" alt="" /></button>
           <span>${flyerTop + 1}/${notes.length}</span>
           <button type="button" data-flip="1" aria-label="Next notice">
             <img src="assets/rulebook/next-page.png${CB}" alt="" /></button>
         </div>`
      : '');

  el.querySelectorAll<HTMLButtonElement>('[data-flip]').forEach((b) => {
    b.onclick = () => {
      flyerTop = (flyerTop + Number(b.dataset.flip) + notes.length) % notes.length;
      syncFlyer();
    };
  });
}

/** Leave the briefing and put the player on the first lot. */
function startRound(): void {
  clearTimeout(bossTimer);
  // The street's own bed, day or night. Chosen here rather than inside bed()
  // because the audio module has no idea what a level is.
  sound.bed(day.night ? 'ambiance-night' : 'ambiance');
  overlay.classList.remove('on');
  // A line heard twice in one round lands worse than a line written badly, so
  // the used set is cleared per level rather than per lot.
  resetBarkHistory();
  claimed.clear();
  // Cancels an in-flight hunt too: leaving the round mid-music must put the
  // drawer away and give the pointer back.
  if (hunt) endHunt(false);
  firedEvents.clear();
  passesSeen.clear();
  // A shift jumped out of mid-round must not ring on the new shift's first lot.
  phonePending = false;
  // Nobody starts a shift with the drawer hanging open.
  setDrawerOpen(false);
  bountyPay = 0;
  fineBonus = 0;
  bountyMark = null;
  // What the sheet will say for the rest of the shift, whatever gets earned.
  bankShown = saveFile.inspector.pay;
  clearTimeout(bountyTickTimer);
  syncFlyer();
  syncStampButtons();
  loadLot(0);
}

/**
 * Clearing the boot guard is the LAST thing that happens. If anything above
 * threw, the guard stays up and explains itself instead of leaving an inert
 * desk on screen with no indication of why.
 */
/**
 * The qualifications. None of them is read by anything, ever.
 *
 * That is the joke and it has to survive contact with the temptation to make
 * one of them do something: the Association asked, the answer is on file, and
 * the file is never opened again. Ticking all seven and ticking none produces
 * the same job.
 */
const QUALIFICATIONS = [
  ['pretty', 'I want to make the world a prettier place'],
  ['hungry', "I haven't eaten in 3 days"],
  ['mulch', 'I have opinions about mulch'],
  ['fence', "My neighbor's fence has been leaning for two years"],
  ['cart', 'I was told there would be a golf cart'],
  ['covenants', 'I have read the covenants recreationally'],
  ['feared', 'I want to be feared in a small way'],
];

/**
 * THE FORM, and the last moment before the Association has any hold on you.
 *
 * It comes before the first briefing rather than being part of it, because the
 * briefing is already the job — the manager is talking to somebody who works
 * there. This is the paperwork that made that true, and it is deliberately the
 * least game-looking screen in the game.
 *
 * Submit is gated on a name and an address. Not to be strict, but because the
 * first thing she says is that you can fill out a form, and she should be
 * right about that.
 */
function application(done: () => void): void {
  const box = $('apply');
  const form = $<HTMLFormElement>('apply-form');
  const name = $<HTMLInputElement>('ap-name');
  const house = $<HTMLInputElement>('ap-house');
  const street = $<HTMLSelectElement>('ap-street');
  const submit = $<HTMLButtonElement>('ap-submit');

  street.innerHTML = '<option value="">— street —</option>'
    + HOME_STREETS.map((st) => `<option value="${st.id}">${st.name}</option>`).join('');
  $('ap-qual-list').innerHTML = QUALIFICATIONS
    .map(([id, text]) => `<label><input type="checkbox" value="${id}" /><span>${text}</span></label>`)
    .join('');

  // Pre-filled from the save, so replaying does not make you type it again.
  const ins = saveFile.inspector;
  name.value = ins.name ?? '';
  house.value = ins.house ?? '';
  street.value = ins.street ?? '';
  for (const cb of form.querySelectorAll<HTMLInputElement>('.ap-quals input'))
    cb.checked = (ins.quals ?? []).includes(cb.value);

  const check = () => {
    submit.disabled = !name.value.trim() || !house.value.trim() || !street.value;
  };
  form.oninput = check;
  check();

  form.onsubmit = (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    ins.name = name.value.trim();
    ins.house = house.value.trim();
    ins.street = street.value;
    ins.quals = [...form.querySelectorAll<HTMLInputElement>('.ap-quals input')]
      .filter((cb) => cb.checked).map((cb) => cb.value);
    save(saveFile);
    box.hidden = true;
    done();
  };

  box.hidden = false;
  name.focus();
}

/**
 * Title screen. Start Game leads into the morning briefing rather than
 * straight to the route, because the briefing is a beat of the day loop
 * (gameplan section 2) and not just a how-to-play panel.
 */
function titleScreen(): void {
  const title = $('title');
  const logo = $<HTMLImageElement>('title-logo');
  const fallback = $('title-fallback');

  // If assets/logo.png has not been dropped in yet, fall back to type rather
  // than showing a broken-image box on the first screen of the game.
  const showFallback = () => {
    logo.style.display = 'none';
    fallback.style.display = 'block';
  };
  logo.onerror = showFallback;
  // Covers the case where the image already failed before this ran.
  if (logo.complete && logo.naturalWidth === 0) showFallback();

  title.classList.add('on');
  $('btn-start-game').onclick = () => {
    // Autoplay may already have started the theme; if it was refused this is
    // the gesture that lets it in. Either way the theme keeps running through
    // the briefing — the handover is the route, not this button.
    sound.unlock();
    showSlotMenu();
  };
}

/**
 * The second thing the title screen says: new file, or one of the old ones.
 *
 * Still the title screen. Picking a file is not a scene, and pushing it onto
 * its own black panel would put a loading screen in front of a game that has
 * never had one.
 */
function showSlotMenu(): void {
  const menu = $('menu');
  const slots = listSlots();
  menu.innerHTML = `
    <div class="tm-slots">
      <button class="btn primary" id="btn-new-game">NEW GAME</button>
      ${
        slots.length
          ? `<div class="tm-or">or continue</div>
             <div class="tm-list">${slots.map(slotRow).join('')}</div>`
          : `<div class="tm-or">No saved shifts yet.</div>`
      }
    </div>`;

  $('btn-new-game').onclick = () => beginGame(null);
  for (const s of slots) {
    $(`slot-${s.id}`).onclick = () => beginGame(s.id);

    /**
     * Delete, in two clicks.
     *
     * The x sits a few pixels from the row you press to PLAY that campaign, and
     * what it does cannot be undone — there is one copy of a save and no
     * server holding another. So the first click only arms it: the button turns
     * red and asks, and anything else on the screen puts it away again. One
     * misclick costs a player their whole run otherwise.
     */
    const del = $<HTMLButtonElement>(`del-${s.id}`);
    del.onclick = (ev) => {
      ev.stopPropagation();
      if (del.dataset.armed !== 'yes') {
        disarmDeletes();
        del.dataset.armed = 'yes';
        del.textContent = 'Delete?';
        del.setAttribute('aria-label', `Confirm deleting ${s.name ?? 'this file'}`);
        return;
      }
      deleteSlot(s.id);
      showSlotMenu();
    };
  }
  // Clicking anywhere that is not an armed x is an answer of no.
  menu.addEventListener('click', (ev) => {
    if (!(ev.target as HTMLElement).closest('.tm-del')) disarmDeletes();
  });
}

/** Put every armed delete back to being an x. */
function disarmDeletes(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tm-del[data-armed]')) {
    delete b.dataset.armed;
    b.textContent = '×';
    b.setAttribute('aria-label', 'Delete this file');
  }
}

/**
 * One saved file, named by the shift it stopped on and that shift's own date.
 *
 * The in-game date is a function of the shift, so the two together are
 * redundant as identification — which is why the real-world timestamp is on
 * there as well. Two files on Shift 3 are the same sentence otherwise, and the
 * player's own question is "which one was I playing last night".
 */
function slotRow(s: SlotInfo): string {
  const d = dateForLevel(s.level_id);
  const who = s.name ? `${s.name} · ` : '';
  // Every file on this list can be resumed. A dismissal deletes its own file,
  // so there is no dead state to represent here.
  // A row, not a button: the delete is its own control and a button cannot be
  // nested inside another one.
  return `<div class="tm-row">
      <button class="btn tm-slot" id="slot-${s.id}" type="button">
        <span class="tm-when">Shift ${s.level_id} — ${d.weekday}, ${d.label}</span>
        <span class="tm-meta">${who}played ${playedAt(s.saved_at)}</span>
      </button>
      <button class="btn tm-del" id="del-${s.id}" type="button"
              aria-label="Delete this file">&times;</button>
    </div>`;
}

/** Real-world, and only as precise as it needs to be to tell two files apart. */
function playedAt(ms: number): string {
  if (!ms) return 'date unknown';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today, ${time}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

/**
 * Take up a file and start playing it.
 *
 * `null` means a new one. Either way the module's round state is rebuilt from
 * whatever the file says, because boot ran loadLevel(0) against no save at all
 * — the thief, the bounty and the level itself all have to be re-read now that
 * there is something to read them from.
 */
function beginGame(id: string | null): void {
  if (id) activateSlot(id);
  else newSlot();
  saveFile = load();
  saveFile.inspector.strikes_today = 0;
  // Module state seeded from the save AT BOOT, when there was no slot to seed
  // it from. The route re-reads this when a shift starts, but the briefing in
  // between would otherwise announce $0 to somebody resuming on $180.
  bankShown = saveFile.inspector.pay;
  $('title').classList.remove('on');

  const i = LEVELS.findIndex((l) => l.level_id === (saveFile.level_id ?? 1));
  const start = () => gotoLevel(i < 0 ? 0 : i);
  // Only once. Somebody replaying Shift 1 has already been hired.
  if (saveFile.inspector.name) start();
  else application(start);
}

async function boot(): Promise<void> {
  try {
    saveFile.inspector.strikes_today = 0;
    sound.autoBed('theme');
    // Loaded before the title screen, so the first lot never renders a
    // placeholder that then pops to real art a frame later.
    assets = await loadAssets();
    // The barks are drawn INTO the canvas, and canvas text silently falls back
    // to the generic monospace if the face is not resident yet. Waiting here
    // costs nothing — the title screen is next — and avoids the first bubble of
    // a session rendering in the wrong font.
    try {
      await document.fonts.load(BUBBLE_FONT);
    } catch {
      /* a missing face is a cosmetic problem, never a fatal one */
    }
    buildDevMenu();
    titleScreen();
    // Hidden, not removed: the window error handler re-shows this element if
    // something throws later (inside a click handler, say), which is otherwise
    // another silent failure with an inert desk on screen.
    const g = document.getElementById('boot');
    if (g) g.style.display = 'none';
  } catch (err) {
    const detail = document.getElementById('boot-detail');
    const why = document.getElementById('boot-why');
    if (why) why.textContent = 'The script loaded but threw while starting up:';
    if (detail) {
      detail.style.display = 'block';
      detail.innerHTML = `<code>${String(err instanceof Error ? err.stack ?? err.message : err)}</code>`;
    }
    throw err;
  }
}

void boot();
