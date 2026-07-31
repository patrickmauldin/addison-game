/**
 * Level driver — Bonerville, Levels 1-2.
 *
 * Deliberately withholds feedback. You find out you were wrong when the audit
 * lands at the end of the day, never at the moment you stamp. Immediate red-X
 * removes all tension and turns the game into a quiz (gameplan section 5).
 */


import { renderLot, type LotSpec, type PropSpec, type RenderedLot, type SceneAssets } from './scene-compositor.js';

import {
  adjudicate,
  type ArticleTiming,
  bumpAccuracy,
  cumulativeAccuracy,
  load,
  noteFirstSeen,
  recordFor,
  reset,
  save,
  type LotOutcome,
  type Ruling,
  type SaveFile,
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
import bulletinData from './data/bulletin.json';
import housesData from './data/houses.json';
import { BarkState, factsFromProps, resetBarkHistory, type BarkContext } from './game/barks.js';
import { BUBBLE_FONT, drawBubble } from './game/bubble.js';
import { ANIMAL_UPSCALE, ANIMALS, animalFrameFor, animalKind, animalNamed, animalsAbroad } from './game/animal.js';
import { dateForLevel } from './game/calendar.js';
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

function loadLevel(i: number): void {
  levelIndex = i;
  day = LEVELS[i];
  today = dateForLevel(day.level_id);
  LOTS = Object.fromEntries(day.lots.map((l) => [l.lot_id, l]));
}
loadLevel(0);

const ARTICLES = rulesData.articles;
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
 * Hide this level's bounty on one of its eligible lots.
 *
 * Never the first lot of the round: the notice is what tells the player there
 * is anything to look for, so finding the animal before reading about it is not a
 * discovery, it is a coincidence. The level data lists the eligible lots.
 */
function placeBounty(): void {
  bountyLot = null;
  bountyCharacter = null;
  const b = day.bounty;
  if (!b?.eligible_lots?.length) return;
  const pool = b.eligible_lots.filter((id) => id !== day.lots[0]?.lot_id && LOTS[id]);
  if (!pool.length) return;
  const rnd = seedFrom(`level${day.level_id}:bounty`);
  bountyLot = pool[Math.floor(rnd() * pool.length)];
  // Drawn, not authored. The player is meant to RECOGNISE a face off a notice,
  // and a face that is the same every playthrough gets memorised instead.
  // Pinned if the level names one, drawn otherwise. The Poop Bandit is a face
  // you have to match and so must not be memorisable; the thief is the only
  // person crossing a lawn after dark and is meant to be recognised on sight.
  if (b.kind === 'person')
    bountyCharacter = b.character ? characterNamed(b.character) : Math.floor(rnd() * RESIDENTS.count);
}

/** The bounty prop, if it is hiding on this lot and has not been claimed. */
function bountyPropFor(lot: LotSpec): PropSpec | null {
  const b = day.bounty;
  if (!b || b.kind === 'person' || b.kind === 'animal' || !b.sprite) return null;
  if (lot.lot_id !== bountyLot || claimed.has(b.id)) return null;
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
const UNPARKED_CARS = ['car1redbad'];

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
const HOUSE_PLANS = ['house1', 'house2', 'house3', 'house4', 'house5', 'house6'];

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
    },
  ]),
);

const HOUSE_VARIANTS = ['window', 'christmas'];
const HOUSE_SPRITES = [
  ...HOUSE_PLANS,
  ...HOUSE_PLANS.flatMap((h) => HOUSE_VARIANTS.map((v) => `${h}-${v}`)),
];

/** Subfolder for a sprite key, '' for the ones at the top of assets/. */
function assetDir(name: string): string {
  return HOUSE_SPRITES.includes(name) ? 'houses/' : '';
}

const ASSET_FILES = [
  'grass', 'road', 'sidewalk',
  ...HOUSE_SPRITES,
  'fence1', 'fence2', 'fence3',
  'weed1', 'weed2', 'weed3', 'trash-green', 'trash-brown',
  // Overgrown turf. Four tufts so a lawn that has got away from its owner does
  // not read as the same clump stamped five times.
  ...TALL_GRASS,
  // Posted notices — the missing-animal flyer, and anything pinned up later.
  'pin',
  ...PARKED_CARS,
  ...UNPARKED_CARS,
  // Not yet placed by any lot, but loaded so content can reference them:
  // R-107 clutter (couch, washer, dryer, boxes) and R-204 recreational
  // vehicles. Missing sprites are skipped at render, so listing them early
  // costs nothing but a fetch.
  'couch', 'washer', 'dryer', 'boxes', 'rv1', 'rv2',
  // Bounty art, referenced straight out of its delivered folder. Copying one
  // frame out to assets/chaz.png would work today and be stale the moment the
  // animal is re-exported.
  'animals/cat-chaz/walking/rotations/south',
];

/**
 * Park a car on the driveway, or leave it empty. 0-1 per house.
 *
 * Returned as a COPY with the car appended, so `current` stays the authored lot:
 * the car is scenery, and the case file, first-seen tracking and adjudication
 * should all carry on seeing exactly the props the content declares.
 *
 * DRIVEWAY_2 rather than _1 or _3 because it is the only one every car clears.
 * The anchor marks where a prop meets the ground, so a sprite hangs UP the
 * screen from it: at _1 (hy 0.70) even the shortest car would reach the garage
 * door, and the longest would sit inside the garage.
 */
function withParkedCar(lot: LotSpec): LotSpec {
  const extra: PropSpec[] = [];
  const rnd = seedFrom(`${lot.lot_id}:car`);
  if (rnd() >= 0.4) {
    const sprite = PARKED_CARS[Math.floor(rnd() * PARKED_CARS.length)];
    // Clickable, like everything else on the lot. A car parked on its own
    // driveway is not a violation of anything live, so citing one is a false
    // positive and takes the strike — which is the whole point of being able
    // to click things that are fine.
    extra.push({ id: `car_${sprite}`, sprite, anchor: 'DRIVEWAY_2', label: 'Vehicle, driveway', flaggable: true });
  }
  const bounty = bountyPropFor(lot);
  if (bounty) extra.push(bounty);
  return extra.length ? { ...lot, props: [...(lot.props ?? []), ...extra] } : lot;
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
let saveFile: SaveFile = load();
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
/** Which lot this level hid the bounty on, if any. */
let bountyLot: string | null = null;
/** For a person bounty: which of the ten they are. Drawn per level. */
let bountyCharacter: number | null = null;
/** Where the tick goes once he is gone from the scene. */
let bountyMark: { x: number; y: number } | null = null;
let outcomes: LotOutcome[] = [];
let stamping = false;

// --- Rendering ------------------------------------------------------------

/**
 * Each lot is rendered once into its own canvas so the transition can slide
 * two finished images past each other with drawImage, instead of recompositing
 * ~900k pixels twice a frame in JS. The scene renders in tens of milliseconds,
 * which is fine once but nowhere near a 60fps budget.
 */
function renderToCanvas(lot: LotSpec, worldX: number): { rl: RenderedLot; cv: HTMLCanvasElement } {
  const { w, h } = stageSize();
  const rl = renderLot(withParkedCar(lot), assets, w, h, worldX);
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
function washNight(w: number, h: number): void {
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
   */
  if (currentGlow) ctx.drawImage(currentGlow, 0, 0);
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
  const b = day.bounty;
  if (b && claimed.has(b.id) && bountyLot === current?.lot_id && checkMark.complete && checkMark.naturalWidth) {
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
  const wanted = day.bounty?.kind === 'person' && lot.lot_id === bountyLot && bountyCharacter !== null;
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
  const speed = L.house.w * 0.085;
  // Weighted, not uniform — see pickCharacter for why the skin mix depends on it.
  // The wanted face is whatever the notice printed, pinned or drawn.
  const character = wanted ? bountyCharacter! : pickCharacter(rnd);
  // Somebody out with a hoe is working a patch of yard, not touring it. Speed
  // zero rather than a separate stationary type: the walker still keeps time,
  // which is what the tool animation cuts its frames from.
  const walker = new Walker(character, { x0, x1, y0: top, y1: bottom }, rnd,
    tool === null ? speed : 0);
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
  const b = day.bounty;
  if (!b || b.kind !== 'animal' || !b.animal) return null;
  if (lot.lot_id !== bountyLot || claimed.has(b.id)) return null;
  const L = rl.layout;
  const top = L.house.y + L.house.h * 0.8;
  const bottom = L.walkTop - 10;
  if (bottom - top < 24) return null;
  const rnd = seedFrom(`${lot.lot_id}:${b.id}:roam`);
  return {
    which: animalNamed(b.animal),
    walker: new Walker(0, { x0: L.w * 0.06, x1: L.w * 0.94, y0: top, y1: bottom }, rnd, L.house.w * 0.05),
  };
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

function claimBounty(b: Bounty, mark: { x: number; y: number }): void {
  bountyMark = mark;
  clearTimeout(bountyTickTimer);
  bountyTickTimer = setTimeout(() => {
    bountyMark = null;
    // Explicit repaint: with the claimed animal gone, the lot may have nothing
    // moving on it, and then no frame would be asked for.
    paint();
  }, BOUNTY_TICK_MS) as unknown as number;
  claimed.add(b.id);
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
    queue.push({ y: walker.y, draw: () => drawPerson(walker.x, walker.y, f.sx, f.sy, k) });
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
    queue.push({ y: c.walker.y, draw: () => drawAnimal(c.walker.x, c.walker.y, f.sx, f.sy, f.flip) });
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

/** Re-render on resize: the layout, not just the canvas, depends on the size. */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
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
  }, 120) as unknown as number;
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
  renderCaseFile(rec);
  paint();
  syncDesk();
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
    el.innerHTML = rec.rulings
      .map((r) => `<div>${shortDate(r.date)} — stamped <b>${VERDICT_WORD[r.verdict] ?? r.verdict}</b>, ${r.findings.length} finding(s)</div>`)
      .join('');
  }
}

type Article = (typeof ARTICLES)[number] & {
  category?: string;
  exhibit?: { cite: string[]; cite_note: string };
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
  const pics = (a.exhibit?.cite ?? [])
    .map((k) => `<img src="assets/${k}.png" alt="" />`)
    .join('');
  const open = expanded.has(a.id);
  return `
    <div class="bk-rule">
      <div class="bk-head">
        <span class="bk-code">${ruleNumber(a.id)}</span>
        <span class="bk-title">${a.title}</span>
      </div>
      <div class="bk-gist">${a.short}</div>
      ${pics ? `<div class="bk-pics">${pics}</div>` : ''}
      <button type="button" class="bk-more" data-more="${a.id}"
              aria-expanded="${open}">${open ? 'collapse' : 'read more'}</button>
      <div class="bk-full"${open ? '' : ' hidden'}>
        <div class="bk-cite">${a.section}</div>
        <p class="bk-formal">${a.text}</p>
        <div class="bk-limits"><b>Enforcement limits.</b> ${a.decoy_note}</div>
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
  // An untrained section is not empty — it is withheld. Saying so in the
  // Association's own voice is worth more than a blank leaf, and it tells the
  // player the tab will be worth something later without spoiling what.
  body.innerHTML = here.length
    ? here.map((a) => binderEntry(a)).join('')
    : `<p class="bk-locked">These rules will be revealed to you once you have
         completed the relevant job training.</p>`;
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
      const locked = !active.some((a) => a.category === c);
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
  $('c-strikes').textContent = `${saveFile.inspector.strikes_today} / 3`;
  $('c-pay').textContent = `$${bankShown}`;
  $('m-day').textContent = `Shift ${day.level_id}`;
  $('m-pay').textContent = `$${bankShown}`;

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

  // The wanted person, if this is a person bounty and you have found them.
  // Same rule as the animals: checked before the id buffer, never a finding.
  const pb = day.bounty;
  if (pb?.kind === 'person' && !claimed.has(pb.id) && bountyCharacter !== null && personHit(p.x, p.y) === bountyCharacter) {
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
  const bAnimal = day.bounty;
  if (bAnimal?.kind === 'animal' && bountyAnimal && !claimed.has(bAnimal.id)
      && overAnimal(bountyAnimal, p.x, p.y)) {
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
  const b = day.bounty;
  if (b && obj.id === b.id) {
    if (claimed.has(b.id)) return;
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
});

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

frame.addEventListener('mousemove', (ev) => {
  if (sliding) return;
  const p = toLotPixel(ev as MouseEvent);
  // Same reach as the click, or the label would disagree with what a click does.
  const obj = rendered.byKey.get(rendered.raster.idNear(p.x, p.y));
  // The loupe is an INFORMATION tool, not a magnifier: label and first-seen
  // date, never more pixels (manifest section 10, "Resolution & zoom").
  $('hover').textContent = obj?.flaggable
    ? `${obj.label}${obj.first_seen ? ` · first observed ${obj.first_seen}` : ''}`
    : '';
});


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
  bountyMark = null;
  clearTimeout(bountyTickTimer);
  resident = null;
  animal = null;
  passersby = [];
  escort = null;
  bountyAnimal = null;
  saveFile.inspector.strikes_today = 0;
  stamping = false;
  sliding = false;
  syncDesk();
  briefing();
}

function syncMute(): void {
  $('mi-mute').innerHTML = `Sound<span class="when">${sound.muted ? 'off' : 'on'}</span>`;
}
$('mi-mute').onclick = () => {
  sound.setMuted(!sound.muted);
  syncMute();
};
syncMute();

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
  });
  outcomes.push(outcome);

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
  saveFile.inspector.pay += day.pay_per_inspection;
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
    renderCaseFile(rec);
    paint();
    syncDesk();
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
    // Both lots are scene, so both go under the same wash — see washNight.
    washNight(sz.w, sz.h);
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
 */
const lotClean = (o: LotOutcome): boolean =>
  o.verdictRight && !o.falsePositives.length && !o.missed.length;

/**
 * ONE mark for the day, off the strike count and nothing else.
 *
 * Strikes are already the thing the game threatens you with — three ends the
 * arrangement — so grading on anything else would put a second, quieter score
 * next to the one that actually matters. A day with a strike is not an A
 * however tidy the rest of it was.
 *
 * There is no D. Four grades for four outcomes, and the gap where a D should be
 * is deliberate: it makes the drop from C to F read as falling off a cliff,
 * which is what a third strike is.
 */
const GRADE = [
  { mark: 'A+', cls: 'g-a' },
  { mark: 'B', cls: 'g-b' },
  { mark: 'C', cls: 'g-c' },
  { mark: 'F', cls: 'g-f' },
];

// --- End of day: the audit ------------------------------------------------

function endDay(): void {
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
  save(saveFile);
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
    <div class="muted">${today.weekday}, ${shortDate(today.iso)} · ${current.street}</div>

    <details class="audit">
      <summary>Board Audit<span class="tally">${
        exceptions ? `${exceptions} of ${outcomes.length} with findings` : 'no exceptions taken'
      }</span></summary>
      <p class="muted">Findings are reviewed the following morning. You were not told at the time.</p>
      ${rows}
    </details>

    <h3>Pay Stub</h3>
    <div class="today-line"><span>${outcomes.length} inspections × $${day.pay_per_inspection}</span>
      <span class="money">$${pay}</span></div>
    ${bountyPay > 0 ? `<div class="today-line"><span>Finder's fee</span>
      <span class="money fee">$${bountyPay}</span></div>` : ''}
    <div class="today-line"><span><b>Total for the round</b></span>
      <span class="money total">$${pay + bountyPay}</span></div>
    <div class="today-line"><span>Balance</span>
      <span class="money">$${saveFile.inspector.pay}</span></div>
    ${shortfall > 0 ? `<p class="muted">Quota was ${day.quota}. Short ${shortfall}. In the full campaign this docks the stub.</p>` : ''}
    <p>Strikes today: <b>${strikes}</b> / 3 &nbsp;·&nbsp; Cumulative accuracy: <b>${acc}%</b>
       ${acc < 70 ? '<br><span class="muted">Below 70%. In the full campaign this triggers probation at the bi-weekly review.</span>' : ''}</p>

    <p style="margin-top:18px">
      <button class="btn" id="btn-after">${hasNext ? `Begin Level ${LEVELS[levelIndex + 1].level_id}` : 'Run this level again'}</button>
    </p>
  `;
  overlay.classList.add('on');
  // Reloading was fine when there was only one day. Now there is a next level
  // to go to, and only the last one has nothing to advance into.
  $('btn-after').onclick = () => (hasNext ? gotoLevel(levelIndex + 1) : gotoLevel(levelIndex));
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

  const storyBeats = ((day as { story?: string[] }).story ?? [day.briefing])
    .map((t) => `<p>${t}</p>`).join('');

  // Backstory is FOUND, never told. The artifact is a thing on the desk, in a
  // different hand from the Association's — so it gets its own register.
  const art0 = (day as { artifact?: { title: string; text: string } }).artifact;
  const artifact = art0
    ? `<div class="artifact"><h4>${art0.title}</h4><p>${art0.text}</p></div>`
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
     <div class="story">${storyBeats}</div>
     ${artifact}`,
  ];
  // Levels that add no article skip the page entirely rather than show an
  // empty one — Level 3 introduces nothing, it just changes the day.
  if (fresh.length) pages.push(
    `<h3>New today</h3>
     <p class="muted" style="margin-bottom:12px">Added to the binder as of this morning.
        Everything already in there still applies — look it up before you stamp.</p>
     ${exhibits()}`);
  pages.push(`<h3>Today's round</h3>
     <div class="today-line"><span>Inspections</span><b>${day.lots.length} on Bonerville</b></div>
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
  // The how-to only earns its place the first time.
  if (day.level_id === 1) {
    pages.splice(2, 0,
      `<h3>How this works</h3>
       <p><b>Click anything on the lot</b> to mark it as a finding. Click it again to unmark.
          Plenty of what you can click is perfectly compliant — being able to click a thing
          is not the game telling you it is wrong.</p>
       <p><b>Read the binder before you stamp.</b> Every article carries an enforcement-limits
          note folded underneath it, and it is load-bearing.</p>
       <p><b>Then stamp.</b> The verdict is about the lot, not the object.</p>`);
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
        <button class="btn" id="pg-next">${page === pages.length - 1 ? 'Begin route' : 'Next &rarr;'}</button>
      </div>`;
    $('pg-prev').onclick = () => { if (page > 0) { page--; render(); } };
    $('pg-next').onclick = () => {
      if (page < pages.length - 1) { page++; render(); return; }
      startRound();
    };
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
function flyerMarkup(): string {
  const b = day.bounty;
  if (!b) return '';
  // A prop shows its own sprite; a person is a window onto the resident sheet,
  // so the face on the notice IS the sprite to spot and cannot drift from it.
  const isPerson = b.kind === 'person' && bountyCharacter !== null;
  let pic = '';
  if (isPerson) {
    // Their south-facing idle frame, at 2x, positioned by row and column.
    const Z = 2;
    const row = bountyCharacter! * RESIDENTS.rowsPerCharacter;
    pic = `<div class="fl-face" style="background-image:url('${RESIDENTS.sheet}${CB}');`
      + `background-size:${RESIDENTS.sheetW * Z}px ${RESIDENTS.sheetH * Z}px;`
      + `background-position:-${RESIDENTS.idleCol * RESIDENTS.frameW * Z}px -${row * RESIDENTS.frameH * Z}px;`
      + `width:${RESIDENTS.frameW * Z}px;height:${RESIDENTS.frameH * Z}px"></div>`;
  } else if (b.sprite) {
    pic = `<img class="fl-pic" src="assets/${b.sprite}.png${CB}" alt="" />`;
  }
  return `
    <div class="fl-paper">
      <img class="fl-pin" src="assets/pin.png" alt="" />
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
function syncFlyer(): void {
  const el = $('flyer');
  const b = day.bounty;
  if (!b) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = flyerMarkup();
  el.classList.toggle('found', claimed.has(b.id));
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
  firedEvents.clear();
  bountyPay = 0;
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
    title.classList.remove('on');
    briefing();
  };
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
