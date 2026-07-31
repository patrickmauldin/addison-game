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
import rulesData from './data/rules.json';
import housesData from './data/houses.json';
import { BarkState, factsFromProps, resetBarkHistory, type BarkContext } from './game/barks.js';
import { BUBBLE_FONT, drawBubble } from './game/bubble.js';
import { ANIMAL_UPSCALE, ANIMALS, animalFrameFor, animalKind } from './game/animal.js';
import { dateForLevel } from './game/calendar.js';
import { makePassersby, remapPassersby, stepPassersby, type Passerby, type Sidewalk } from './game/passerby.js';
import { pickCharacter, RESIDENT_UPSCALE, RESIDENTS, residentFrame, TOOL_NAMES, ToolWork, walkFrame } from './game/residents.js';
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
const LEVELS = [level1, level2, level3, level4] as unknown as LevelSpec[];

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
  kind?: 'prop' | 'person';
  /** MISSING for a pet, WANTED for a person. */
  headline?: string;
  name: string;
  /** The line under the reward: who owns it, or where they are seen. */
  note: string;
  /** prop only. */
  sprite?: string;
  label: string;
  reward: number;
  scale?: number;
  eligible_lots: string[];
};
type LevelSpec = {
  level_id: number;
  weather: string;
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
  if (b.kind === 'person') bountyCharacter = Math.floor(rnd() * RESIDENTS.count);
}

/** The bounty prop, if it is hiding on this lot and has not been claimed. */
function bountyPropFor(lot: LotSpec): PropSpec | null {
  const b = day.bounty;
  if (!b || b.kind === 'person' || !b.sprite) return null;
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
];

const ASSET_FILES = [
  'grass', 'road', 'sidewalk',
  'house1', 'house2', 'house3', 'house4', 'house5', 'house6',
  'fence1', 'fence2', 'fence3',
  'weed1', 'weed2', 'weed3', 'trash-green', 'trash-brown',
  // Posted notices — the missing-animal flyer, and anything pinned up later.
  'pin',
  ...PARKED_CARS,
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
      // house1 shipped as a JPEG; everything else is PNG. Try both rather than
      // encoding the extension into content.
      for (const ext of ['png', 'jpg']) {
        const b = await loadBitmap(`assets/${name}.${ext}`);
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
/** An animal pottering about this lot, if one turned up. */
let animal: { which: number; walker: Walker } | null = null;
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
  if (!wanted && rnd() < 0.45) return null; // nobody home, or nobody outside
  // Out working, and with what. Drawn from a SEPARATE seed rather than the next
  // number in this stream, so adding tools did not reshuffle who stands where.
  const trnd = seedFrom(`${lot.lot_id}:tool`);
  const tool = trnd() < 0.4 ? Math.floor(trnd() * TOOL_NAMES.length) : null;
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
  const character = wanted ? bountyCharacter! : pickCharacter(rnd);
  // Somebody out with a hoe is working a patch of yard, not touring it. Speed
  // zero rather than a separate stationary type: the walker still keeps time,
  // which is what the tool animation cuts its frames from.
  const walker = new Walker(character, { x0, x1, y0: top, y1: bottom }, rnd,
    tool === null ? speed : 0);
  const work = tool === null ? null : new ToolWork(tool, seedFrom(`${lot.lot_id}:work`));
  // Not everybody has anything to say. Two thirds do; the rest just get on
  // with it, which is what stops the street sounding like a chorus.
  const brnd = seedFrom(`${lot.lot_id}:bark`);
  const bark = brnd() < 0.66 ? new BarkState('owner', brnd, 1 + brnd() * 3) : null;
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
  if (rnd() >= 0.35) return null;
  const L = rl.layout;
  const top = L.house.y + L.house.h * 0.8;
  const bottom = L.walkTop - 10;
  if (bottom - top < 24) return null;
  return {
    which: Math.floor(rnd() * ANIMALS.count),
    // Slower than a person and with the Walker's own habit of stopping, which
    // between them is most of what reads as "animal" rather than "small person".
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
  return out;
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
function claimBounty(b: Bounty, mark: { x: number; y: number }): void {
  bountyMark = mark;
  claimed.add(b.id);
  bountyPay += b.reward;
  saveFile.inspector.pay += b.reward;
  save(saveFile);
  sound.play('money');
  if (b.kind !== 'person') {
    const built = renderToCanvas(current, routeIndex * stageSize().w);
    rendered = built.rl;
    currentCanvas = built.cv;
    currentProps = propLayerFor(rendered);
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
  if (!resident && !passersby.length && !animal) return;
  walkerLast = performance.now();
  const step = (now: number) => {
    if (sliding) { walkerRaf = requestAnimationFrame(step); return; }
    const dt = Math.min(0.1, (now - walkerLast) / 1000);
    walkerLast = now;
    resident?.walker.update(dt);
    resident?.work?.update(dt);
    animal?.walker.update(dt);
    resident?.bark?.update(dt, barkCtx);
    passersby = stepPassersby(passersby, dt, sidewalkOf(rendered));
    for (const p of passersby) p.bark?.update(dt, barkCtx);
    paint();
    // Once the last of them has gone and there is nobody in the yard there is
    // nothing left moving, so stop asking for frames.
    if (!resident && !passersby.length && !animal) return;
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
    centroidCache.clear();
    // Rebuild the resident too. Their patch of lawn is derived from the house
    // rect, so a layout change invalidates it — and the walker keeps walking to
    // coordinates from the OLD one, which after a shrink is somewhere up the
    // roof. Seeded from the lot id, so this is the same person, just re-placed.
    resident = makeWalker(current, rendered);
    animal = makeAnimal(current, rendered);
    // Traffic is REMAPPED, not respawned: anyone who has already walked off has
    // gone for good, and rebuilding from the seed would march them back on.
    passersby = remapPassersby(passersby, wasWalk, sidewalkOf(rendered));
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
function binderEntry(a: Article): string {
  const pics = (a.exhibit?.cite ?? [])
    .map((k) => `<img src="assets/${k}.png" alt="" />`)
    .join('');
  const open = binderExpanded.has(a.id);
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
    ? here.map(binderEntry).join('')
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
              ><img src="assets/rulebook/${c.toLowerCase()}.png" alt="" /></button>`;
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
  $('c-pay').textContent = `$${saveFile.inspector.pay}`;
  $('m-day').textContent = `Shift ${day.level_id}`;
  $('m-pay').textContent = `$${saveFile.inspector.pay}`;

  syncBinder();

  const list = $('find-list');
  if (!flagged.size) {
    list.innerHTML = '<li class="none">Nothing marked.</li>';
  } else {
    list.innerHTML = [...flagged]
      .map((id) => {
        const o = rendered.objects.find((x) => x.id === id)!;
        return `<li><span>${o.label}<br><span class="muted" style="font-size:11px">R-101</span></span>
                <button data-unflag="${id}">&times;</button></li>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('[data-unflag]').forEach((b) => {
      b.onclick = () => {
        flagged.delete(b.dataset.unflag!);
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

function animalHit(px: number, py: number): boolean {
  if (!animal) return false;
  const k = ANIMAL_UPSCALE * rendered.layout.scale;
  const w = ANIMALS.frameW * k;
  const h = ANIMALS.frameH * k;
  const { x, y } = animal.walker;
  return px > x - w / 2 && px < x + w / 2 && py > y - h && py < y;
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
  if (animalHit(p.x, p.y)) {
    const kind = animalKind(animal!.which);
    // Two barks, so a dog clicked twice does not sound like a loop.
    sound.play(kind === 'dog' ? (Math.random() < 0.5 ? 'bark1' : 'bark2') : 'meow');
    return;
  }

  const key = rendered.raster.idAt(p.x, p.y);
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
    sound.play('select');
  }
  paint();
  syncDesk();
});

frame.addEventListener('mousemove', (ev) => {
  if (sliding) return;
  const p = toLotPixel(ev as MouseEvent);
  const obj = rendered.byKey.get(rendered.raster.idAt(p.x, p.y));
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
  resident = null;
  animal = null;
  passersby = [];
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
  const outcome = adjudicate(current, labels, flagged, v, day.pay_per_inspection);
  outcomes.push(outcome);

  // Log the ruling with correctness UNRESOLVED. The audit fills it in later.
  const rec = recordFor(saveFile, current.lot_id, current.address);
  rec.rulings.push({
    day_id: day.level_id,
    date: today.iso,
    verdict: v,
    findings: [...flagged].map((object) => ({ object, article: 'R-101' })),
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
    flagged = new Set();
    centroidCache.clear();
    stamping = false;
    const rec = recordFor(saveFile, current.lot_id, current.address);
    for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? today.iso);
    save(saveFile);
    barkCtx = barkContextFor(current);
    resident = makeWalker(current, rendered);
    animal = makeAnimal(current, rendered);
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

// --- End of day: the audit ------------------------------------------------

function endDay(): void {
  let strikes = 0;
  for (const o of outcomes) {
    if (o.strike) strikes++;
    /**
     * ONE definition of a clean lot, used by the accuracy figure, the ruling
     * record and the marks on the report. They had drifted: accuracy ignored
     * missed findings, so a day could show a red mark on half its rows and
     * still report 100%. A report that argues with itself is worse than no
     * report — the player stops believing any of it.
     */
    const clean = o.verdictRight && !o.falsePositives.length && !o.missed.length;
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
      // "Clean" has to mean NO EXCEPTIONS, missed findings included. Marking a
      // row good while it lists an audit finding contradicts itself, and the
      // audit finding is the part the player most needs to take seriously.
      const ok = o.verdictRight && !o.falsePositives.length && !o.missed.length;
      return `<div class="verdict-row ${ok ? 'good' : 'bad'}">
        <img class="mark" src="assets/${ok ? 'good' : 'bad'}.png" alt="${ok ? 'clean' : 'exception taken'}" />
        <b>${o.address}</b> — you stamped ${VERDICT_WORD[o.stamped] ?? o.stamped}; correct verdict was ${VERDICT_WORD[o.expected] ?? o.expected}.
        ${bits.join('') || '<div>No exceptions taken.</div>'}
      </div>`;
    })
    .join('');

  // One mark for the day as a whole. Clean means every lot came back without
  // an audit finding or a successful appeal — not merely that the verdicts
  // were right.
  const cleanDay = outcomes.every((o) => o.verdictRight && !o.falsePositives.length && !o.missed.length);
  const hasNext = levelIndex + 1 < LEVELS.length;
  sheet.innerHTML = `
    <img class="day-mark" src="assets/${cleanDay ? 'good' : 'bad'}.png" alt="" />
    ${bossHeader('boss2')}
    <h1>END OF LEVEL ${day.level_id}</h1>
    <div class="muted">${today.weekday}, ${shortDate(today.iso)} · ${current.street}</div>

    <h3>Board Audit</h3>
    <p class="muted">Findings are reviewed the following morning. You were not told at the time.</p>
    ${rows}

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
function briefing(): void {
  const art = (key: string) => `assets/${key}.png`;
  const pics = (keys: string[]) =>
    keys.length
      ? keys.map((k) => `<img src="${art(k)}" alt="${k}" />`).join('')
      : '<span class="none">no example art yet</span>';

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
   * Only the VIOLATING examples, too.
   *
   * A cite/leave pair reads badly the moment the same object appears on both
   * sides — R-104's bins are cited at the curb and left when screened, so the
   * old layout showed an identical bin under "cite this" and "leave this",
   * which teaches confusion rather than the rule. The near-miss lives in the
   * article's enforcement-limits note, one click away in the binder.
   */
  const exhibits = fresh.map((a) => {
    const e = (a as { exhibit?: { cite: string[]; cite_note: string } }).exhibit;
    return `
      <div class="exh">
        <div class="exh-head">
          <span class="code">Rule ${ruleNumber(a.id)}</span>
          <span class="tab">${a.tab}</span>
          <span class="one">${a.short}</span>
        </div>
        <div class="exh-body">
          <div class="exh-pics">${pics(e?.cite ?? [])}</div>
          <p>${e?.cite_note ?? ''}</p>
        </div>
      </div>`;
  }).join('');

  const storyBeats = ((day as { story?: string[] }).story ?? [day.briefing])
    .map((t) => `<p>${t}</p>`).join('');

  // Backstory is FOUND, never told. The artifact is a thing on the desk, in a
  // different hand from the Association's — so it gets its own register.
  const art0 = (day as { artifact?: { title: string; text: string } }).artifact;
  const artifact = art0
    ? `<div class="artifact"><h4>${art0.title}</h4><p>${art0.text}</p></div>`
    : '';

  const pages: string[] = [
    `<h3>${today.weekday} &middot; ${shortDate(today.iso)}</h3>
     <div class="story">${storyBeats}</div>
     ${artifact}`,
  ];
  // Levels that add no article skip the page entirely rather than show an
  // empty one — Level 3 introduces nothing, it just changes the day.
  if (fresh.length) pages.push(
    `<h3>New today</h3>
     <p class="muted" style="margin-bottom:12px">Added to the binder as of this morning.
        Everything already in there still applies — look it up before you stamp.</p>
     ${exhibits}`);
  pages.push(`<h3>Today's round</h3>
     <div class="today-line"><span>Inspections</span><b>${day.lots.length} on Bonerville</b></div>
     <div class="today-line"><span>Pay</span><b>$${day.pay_per_inspection} each</b></div>
     <div class="today-line"><span>Verdicts</span><b>${day.verdict_mode === 'notice' ? 'Pass or Notice — no fines today' : 'Pass, Notice or Citation'}</b></div>
     ${day.bounty ? `<div class="today-line"><span>Also</span><b>$${day.bounty.reward} finder's fee</b></div>` : ''}
     <p style="margin-top:14px">Mark what you find, then stamp. You will not be told
        whether you were right — the Board reviews your calls overnight.</p>`);
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

  let page = 0;
  const render = () => {
    sheet.innerHTML = `
      ${bossHeader('boss1')}
      <h1>ADDISON MASTER COMMUNITY ASSOCIATION</h1>
      <div class="muted">Compliance Inspector &middot; Level ${day.level_id}</div>
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
  };
  render();
  overlay.classList.add('on');
  startBossIdle();
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
  $('flyer-head').textContent = b.headline ?? 'Missing';
  $('flyer-name').textContent = b.name;
  $('flyer-reward').textContent = `$${b.reward} reward`;
  $('flyer-note').textContent = b.note;

  // A prop shows its own sprite; a person is a window onto the resident sheet.
  const pic = $<HTMLImageElement>('flyer-pic');
  const face = $('flyer-face');
  const isPerson = b.kind === 'person' && bountyCharacter !== null;
  pic.hidden = isPerson;
  face.hidden = !isPerson;
  if (isPerson) {
    // Their south-facing idle frame, at 2x, positioned by row and column.
    const Z = 2;
    const row = bountyCharacter! * RESIDENTS.rowsPerCharacter;
    face.style.backgroundImage = `url('${RESIDENTS.sheet}${CB}')`;
    face.style.backgroundSize = `${RESIDENTS.sheetW * Z}px ${RESIDENTS.sheetH * Z}px`;
    face.style.backgroundPosition = `-${RESIDENTS.idleCol * RESIDENTS.frameW * Z}px -${row * RESIDENTS.frameH * Z}px`;
    face.style.width = `${RESIDENTS.frameW * Z}px`;
    face.style.height = `${RESIDENTS.frameH * Z}px`;
  } else if (b.sprite) {
    pic.src = `assets/${b.sprite}.png${CB}`;
  }

  const found = claimed.has(b.id);
  $('flyer-found').hidden = !found;
  el.classList.toggle('found', found);
}

/** Leave the briefing and put the player on the first lot. */
function startRound(): void {
  clearTimeout(bossTimer);
  sound.bed('ambiance');
  overlay.classList.remove('on');
  // A line heard twice in one round lands worse than a line written badly, so
  // the used set is cleared per level rather than per lot.
  resetBarkHistory();
  claimed.clear();
  bountyPay = 0;
  bountyMark = null;
  placeBounty();
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
