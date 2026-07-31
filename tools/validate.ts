/**
 * CONTENT VALIDATOR — gameplan section 11.
 *
 * "Content bugs in a rules game are lethal and near-invisible without this."
 *
 * Walks every day file and asserts:
 *   1. every violation cites an article that is ACTIVE that day
 *   2. every violation/decoy names an object that exists on the lot
 *   3. every flaggable object is VISIBLE — an object you cannot click is an
 *      unwinnable lot, and a violation with a tiny target is an eye test
 *   4. every expected_verdict is derivable from truth + active_rules
 *   5. every rule introduced has a decoy in play
 *   6. no generator or anchor is referenced that does not exist
 *   7. delivered art is exportable: hard alpha, and tiles that actually tile
 *
 * Note what is NOT checked any more: palette conformance. That lock existed to
 * keep procedurally generated layers consistent with each other. Art is now
 * hand-authored and carries its own color, so the useful question became
 * "is this exportable" rather than "is this on my palette".
 */

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderLot, type Bitmap, type LotSpec } from '../src/scene-compositor.js';
import { ANCHOR_SURFACE, DEFAULT_ANCHORS, mergeAnchors } from '../src/core/scene.js';
import { decodePng } from '../src/core/png.js';
import { adjudicate, emptySave, noteFirstSeen, recordFor, type ArticleTiming } from '../src/game/state.js';
import { dateForLevel } from '../src/game/calendar.js';

import housesData from '../src/data/houses.json';
import rulesData from '../src/data/rules.json';
import residentsData from '../src/data/residents.json';
import animalsData from '../src/data/animals.json';
import level1 from '../src/data/levels/level1.json';
import level2 from '../src/data/levels/level2.json';
import level3 from '../src/data/levels/level3.json';
import level4 from '../src/data/levels/level4.json';
import level5 from '../src/data/levels/level5.json';
import level6 from '../src/data/levels/level6.json';
import level7 from '../src/data/levels/level7.json';
import level8 from '../src/data/levels/level8.json';

/**
 * Levels carry their lots inline, and an ADDRESS RECURS across levels with
 * different props — that is the whole point of the return visits.
 *
 * So there is no global lot table: merging them keys every level's content on
 * lot_id and lets a later level overwrite an earlier one, which had Level 2
 * being checked against Level 4's props. Each level is validated against its
 * own lots.
 */
const LEVELS = [level1, level2, level3, level4, level5, level6, level7, level8] as unknown as {
  level_id: number;
  active_rules: string[];
  cameos?: { lot_id: string; people?: string[]; dog?: string; animal?: string }[];
  ambient_animals?: string[];
  verdict_mode: string;
  event?: { lot_id: string; object: string };
  bounty?: { character?: string; animal?: string; eligible_lots?: string[] };
  lots: (LotSpec & { lot_id: string; address: string; expected_verdict: string; truth: {
    violations: { object: string; article: string; why: string }[];
    decoys: { object: string; why: string }[];
  } })[];
}[];


const DAYS = LEVELS;

const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

// --- Ground tiles ---------------------------------------------------------
// Grass is the background of every lot, so a seam in it is a seam in the whole
// game. Measured by comparing the wrap-around edge against a typical adjacent
// pair: if wrapping is much worse than neighboring, it does not tile.
/** `axes` says which directions this asset is actually repeated in. A strip
 *  that only tiles horizontally must not be reported for its vertical edges —
 *  a warning that is wrong trains you to ignore the ones that are not. */
function checkTile(path: string, name: string, axes: 'both' | 'x' = 'both'): void {
  if (!existsSync(path)) {
    warn(`${name}: ${path} missing — the scene falls back to a flat band.`);
    return;
  }
  const b = decodePng(readFileSync(path));
  const at = (x: number, y: number) => (y * b.w + x) << 2;
  const diff = (ia: number, ib: number) =>
    Math.abs(b.rgba[ia] - b.rgba[ib]) +
    Math.abs(b.rgba[ia + 1] - b.rgba[ib + 1]) +
    Math.abs(b.rgba[ia + 2] - b.rgba[ib + 2]);
  let seamX = 0, nbrX = 0, seamY = 0, nbrY = 0;
  const cx = (b.w / 3) | 0;
  const cy = (b.h / 3) | 0;
  for (let y = 0; y < b.h; y++) {
    seamX += diff(at(0, y), at(b.w - 1, y));
    nbrX += diff(at(cx, y), at(cx + 1, y));
  }
  for (let x = 0; x < b.w; x++) {
    seamY += diff(at(x, 0), at(x, b.h - 1));
    nbrY += diff(at(x, cy), at(x, cy + 1));
  }
  seamX /= b.h * 3; nbrX /= b.h * 3; seamY /= b.w * 3; nbrY /= b.w * 3;
  // A pure ratio breaks down on near-uniform art: paper-lined's neighboring
  // pixels differ by 0.0, so ANY edge difference is infinitely worse than
  // typical and the test screams about a seam nobody can see. Require the
  // difference to be visible in absolute terms too.
  const VISIBLE = 6;
  if (seamX > VISIBLE && seamX > nbrX * 2.2)
    warn(`${name}: horizontal seam (edge ${seamX.toFixed(1)} vs neighbor ${nbrX.toFixed(1)}). Repeats visibly across x.`);
  if (axes === 'both' && seamY > VISIBLE && seamY > nbrY * 2.2)
    warn(`${name}: vertical seam (edge ${seamY.toFixed(1)} vs neighbor ${nbrY.toFixed(1)}). Bands every ${b.h}px.`);
  // Ground tiles are opaque by nature; any translucency in one is a mistake.
  // Sprites are a different matter and are checked separately below.
  let soft = 0;
  for (let i = 0; i < b.rgba.length; i += 4) if (b.rgba[i + 3] > 0 && b.rgba[i + 3] < 255) soft++;
  if (soft > b.w * b.h * 0.01)
    warn(`${name}: ${soft} px partial alpha in a ground tile — tiles should be fully opaque.`);
}

checkTile('assets/grass.png', 'grass tile');
checkTile('assets/road.png', 'road tile');
checkTile('assets/sidewalk.png', 'sidewalk strip', 'x');

// --- Delivered art --------------------------------------------------------
// Load everything the lots can reference, so the click-target checks below
// measure the real thing rather than an empty scene.
const SPRITES = new Map<string, Bitmap>();
for (const name of ['grass','road','sidewalk','house1','house2','house3','house4','house5','house6','fence1','fence2','fence3','weed1','weed2','weed3','trash-green','trash-brown']) {
  // Houses are filed in their own folder; everything else sits at the top.
  const dir = name.startsWith('house') ? 'houses/' : '';
  for (const ext of ['png','jpg']) {
    const path = `assets/${dir}${name}.${ext}`;
    if (!existsSync(path)) continue;
    try {
      if (ext === 'jpg') {
        // No JPEG decoder here; macOS sips converts it for inspection only.
        execSync(`sips -s format png "${path}" --out /tmp/_v_${name}.png`, { stdio: 'ignore' });
        SPRITES.set(name, decodePng(readFileSync(`/tmp/_v_${name}.png`)));
      } else {
        SPRITES.set(name, decodePng(readFileSync(path)));
      }
    } catch { warn(`${name}: could not decode ${path}`); }
    break;
  }
}
for (const name of ['grass','road','sidewalk','house1'])
  if (!SPRITES.has(name)) fail(`required asset "${name}" is missing from assets/`);


// A house sprite with no alpha relies on its baked lawn matching the grass
// tile. Measure that rather than trusting it — a drift here shows as a
// rectangle of slightly-wrong green around every house in the game.
const g = SPRITES.get('grass');
const h1 = SPRITES.get('house1');
if (g && h1) {
  const px = (b: Bitmap, x: number, y: number) => { const i = (y * b.w + x) << 2; return [b.rgba[i], b.rgba[i+1], b.rgba[i+2]]; };
  const counts = new Map<string, number>();
  for (let y = 0; y < g.h; y += 3) for (let x = 0; x < g.w; x += 3) {
    const k = px(g, x, y).join(','); counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dom = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const corners = [[4,4],[h1.w-5,4],[4,h1.h-5],[h1.w-5,h1.h-5]];
  const worst = Math.max(...corners.map(([x,y]) => {
    const c = px(h1, x, y);
    return (Math.abs(c[0]-dom[0]) + Math.abs(c[1]-dom[1]) + Math.abs(c[2]-dom[2])) / 3;
  }));
  if (worst > 12)
    warn(`house1 lawn is ${worst.toFixed(0)}/255 off the grass tile at its corners — the join will show. Export the house with alpha instead.`);
}

// --- Anchors land on the right surface ------------------------------------
/**
 * Sample the house art under every anchor and check it against the surface the
 * anchor contract requires.
 *
 * This is what makes per-house overrides safe to author. Anchors are fractions
 * of the house rect, which survives scaling but NOT a different floor plan: move
 * the driveway to the left and DRIVEWAY_1 is suddenly a patch of lawn. Caught
 * two real cases on house1 the first time it ran — WALK_1 left on grass after
 * the walk was rerouted to meet the driveway, and YARD_6 sitting on the driveway
 * edge — neither of which was visible because no lot happened to use them yet.
 */
function anchorTableFor(houseId: string) {
  const raw = (housesData as any).houses?.[houseId]?.anchors ?? {};
  const clean: Record<string, { hx: number; hy: number }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>))
    if (v && typeof v.hx === 'number' && typeof v.hy === 'number') clean[k] = { hx: v.hx, hy: v.hy };
  return mergeAnchors(clean);
}

// Every lot on a street shares a house, so without this the same anchor is
// reported once per lot and the real count is lost in the repeats.
const surfaceChecked = new Set<string>();

function checkAnchorSurfaces(houseId: string, used: Set<string>): void {
  if (surfaceChecked.has(houseId)) return;
  surfaceChecked.add(houseId);
  // Anchors a lot USES are errors; the rest are warnings. A stale anchor no lot
  // references yet is not breaking anything today, but it is a trap primed for
  // whoever authors the next lot — which is exactly how WALK_1 ended up on grass
  // and went unnoticed.
  const art = SPRITES.get(houseId);
  if (!art) return;
  const table = anchorTableFor(houseId);
  const at = (hx: number, hy: number) => {
    const x = Math.min(art.w - 1, Math.max(0, Math.round(hx * art.w)));
    const y = Math.min(art.h - 1, Math.max(0, Math.round(hy * art.h)));
    const i = (y * art.w + x) << 2;
    return [art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]];
  };
  // Grass is strongly green-over-blue; paving is pale and near-neutral. On this
  // art grass reads ~100 on green-minus-blue and paving ~40, so 60 splits them
  // with room on both sides.
  const classify = (c: number[]) =>
    c[1] - c[2] > 60 ? 'grass' : c[0] > 150 && c[1] > 130 ? 'paving' : 'bed';

  for (const name of Object.keys(ANCHOR_SURFACE)) {
    const want = ANCHOR_SURFACE[name];
    const a = table[name];
    if (!want || !a) continue;
    const report = used.has(name) ? fail : warn;
    if (want === 'attach') {
      // Must sit against the right side of the house, not out in the yard.
      if (a.hx < 0.75 || a.hx > 0.99)
        report(`${houseId}: anchor ${name} at hx ${a.hx} is not against the house's right wall.`);
      continue;
    }
    if (want === 'road') {
      // Below the house sprite entirely — checked by position, not by pixel.
      if (a.hy <= 1.0)
        report(`${houseId}: anchor ${name} is meant to be in the road but sits at hy ${a.hy}, on the lot.`);
      continue;
    }
    if (a.hy > 1.0) {
      report(`${houseId}: anchor ${name} sits at hy ${a.hy}, below the house art — nothing to stand on.`);
      continue;
    }
    const got = classify(at(a.hx, a.hy));
    // A bed anchor may legitimately be on mulch or on grass.
    const ok = want === 'bed' ? got !== 'paving' : got === want;
    if (!ok)
      report(
        `${houseId}: anchor ${name} (hx ${a.hx}, hy ${a.hy}) must be on ${want} but the art has ${got} there. ` +
          `Override it in src/data/houses.json for this plan.`,
      );
  }
}

// Check EVERY house that has both art and an anchor table, not just the ones a
// lot happens to route to today. A table authored now and first used in ten
// days is exactly the one that will be wrong and unnoticed.
//
// Placed here, below the helpers: fail/warn and surfaceChecked are const, so
// calling this any earlier dies in the temporal dead zone before validating
// anything — which is how a validator ends up silently passing.
for (const hid of Object.keys((housesData as any).houses ?? {}))
  if (SPRITES.has(hid)) checkAnchorSurfaces(hid, new Set());

/**
 * PINNED CAST. A cameo names people and animals as strings, and both lookups
 * throw at draw time — which means a typo in a level file is a crash halfway
 * through a shift rather than an error here. Checked against the packed sheets,
 * not against the packers, so renaming a row and forgetting to re-pack is
 * caught too.
 */
for (const day of LEVELS) {
  const lots = new Set(day.lots.map((l) => l.lot_id));
  for (const c of day.cameos ?? []) {
    if (!lots.has(c.lot_id)) fail(`day ${day.level_id}: cameo on ${c.lot_id}, which is not a lot on this level`);
    for (const name of c.people ?? [])
      if (!residentsData.characters.includes(name))
        fail(`day ${day.level_id}: cameo person "${name}" is not in residents.json — re-run pack-residents?`);
    for (const id of [c.dog, c.animal].filter(Boolean) as string[])
      if (!animalsData.animals.includes(id))
        fail(`day ${day.level_id}: cameo animal "${id}" is not in animals.json — re-run pack-animals?`);
  }
}

/**
 * NAMED PETS DO NOT ROAM ALONE. Anything non-ambient is somebody's, so it is
 * only ever out with its owners (a cameo) or lost (a bounty). One that appears
 * in neither is an animal packed and then forgotten, which reads in game as a
 * dog that simply never exists.
 */
{
  const owned = animalsData.animals.filter((_, i) => !animalsData.ambient[i]);
  const placed = new Set(
    LEVELS.flatMap((d) => [
      ...(d.cameos ?? []).flatMap((c) => [c.dog, c.animal]),
      (d as { bounty?: { animal?: string } }).bounty?.animal,
    ]).filter(Boolean) as string[],
  );
  for (const id of owned)
    if (!placed.has(id)) warn(`animal "${id}" belongs to somebody but is on no cameo and no notice — it never appears.`);
}

/**
 * THE CAMPAIGN, PLAYED PERFECTLY, MUST MATCH WHAT THE LEVELS CLAIM.
 *
 * `expected_verdict` is no longer what the game reads — the verdict is computed
 * from the date and from the address's own history. That makes the field pure
 * documentation, and documentation nobody checks is a lie waiting to happen. So
 * it is checked: one save, all eight shifts in order, every real violation
 * cited, and the computed verdict compared against the authored one.
 *
 * This is the only place a mistimed grace period or a broken escalation chain
 * shows up. Authoring a lot as CITATION when the address was never warned for
 * that article is invisible in the file and obvious here.
 */
{
  const timing: Record<string, ArticleTiming> = Object.fromEntries(
    rulesData.articles.map((a) => [
      (a as { id: string }).id,
      {
        weekday_window: (a as { weekday_window?: string[] }).weekday_window,
        season_window: (a as { season_window?: { from: string; to: string } }).season_window,
        grace_days: (a as { grace_days?: number }).grace_days,
      },
    ]),
  );
  const save = emptySave();
  for (const day of LEVELS) {
    const today = dateForLevel(day.level_id);
    for (const lot of day.lots) {
      const rec = recordFor(save, lot.lot_id, lot.address);
      for (const p of lot.props ?? []) noteFirstSeen(rec, p.id, p.first_seen ?? today.iso);
      const flagged = new Set(lot.truth.violations.map((v) => v.object));
      const labels = new Map<string, string>();
      const o = adjudicate(lot, labels, labels, flagged, 'PASS', 0, {
        today: { iso: today.iso, weekday: today.weekday },
        timing,
        rec,
      });
      if (o.expected !== lot.expected_verdict)
        fail(`level ${day.level_id} ${lot.lot_id}: authored ${lot.expected_verdict}, `
          + `a diligent run gets ${o.expected} on ${today.weekday} ${today.label}`);
      if (o.falsePositives.length)
        fail(`level ${day.level_id} ${lot.lot_id}: cites ${o.falsePositives.map((f) => f.object).join(', ')} `
          + `which the date says ${o.falsePositives.map((f) => f.why).join(' / ')}`);
      rec.rulings.push({
        day_id: day.level_id,
        date: today.iso,
        verdict: o.expected,
        findings: [...flagged].map((object) => ({
          object,
          article: lot.truth.violations.find((v) => v.object === object)?.article ?? null,
        })),
        correct: true,
      });
    }
  }
}

// --- Days and lots --------------------------------------------------------
for (const day of DAYS) {
  const active = new Set(day.active_rules);
  const known = new Set(rulesData.articles.map((a) => a.id));
  for (const id of day.active_rules)
    if (!known.has(id)) fail(`day ${day.level_id}: active rule ${id} is not in rules.json`);

  const introduced = rulesData.articles.filter((a) => a.introduced_level === day.level_id);
  let anyDecoy = false;

  const lotsHere: Record<string, LotSpec> = Object.fromEntries(day.lots.map((l) => [l.lot_id, l]));
  for (const lotId of day.lots.map((l) => l.lot_id)) {
    const lot = lotsHere[lotId];
    if (!lot) {
      fail(`level ${day.level_id}: route references unknown lot "${lotId}"`);
      continue;
    }
    // The variant id counts: a house wearing lights or cracked glazing is a
    // clickable object that exists nowhere in `props`, because it IS the house.
    const objectIds = new Set(lot.props.map((p) => p.id));
    if (lot.house?.variantId) objectIds.add(lot.house.variantId);

    for (const p of lot.props)
      if (!(p.anchor in DEFAULT_ANCHORS)) fail(`${lotId}: unknown anchor "${p.anchor}"`);

    for (const v of lot.truth.violations) {
      if (!objectIds.has(v.object)) fail(`${lotId}: violation names missing object "${v.object}"`);
      if (!active.has(v.article))
        fail(`${lotId}: violation cites ${v.article}, not active on day ${day.level_id}`);
    }
    for (const d of lot.truth.decoys)
      if (!objectIds.has(d.object)) fail(`${lotId}: decoy names missing object "${d.object}"`);
    if (lot.truth.decoys.length) anyDecoy = true;

    const derived = lot.truth.violations.length > 0 ? 'FAIL' : 'PASS';
    if (day.verdict_mode === 'binary' && lot.expected_verdict !== derived)
      fail(`${lotId}: expected_verdict is ${lot.expected_verdict} but truth implies ${derived}`);

    // Every anchor this lot actually uses must land on the surface it claims.
    if (lot.house?.sprite)
      checkAnchorSurfaces(lot.house.sprite, new Set(lot.props.map((p) => p.anchor)));

    const { raster, objects } = renderLot(
      lot,
      { sprites: SPRITES, houseAnchors: { [lot.house?.sprite ?? '']: anchorTableFor(lot.house?.sprite ?? '') } },
      1060,
      860,
    );
    const counts = new Map<number, number>();
    for (let i = 0; i < raster.id.length; i++) {
      const k = raster.id[i];
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const o of objects) {
      const px = counts.get(o.key) ?? 0;
      if (px === 0) fail(`${lotId}: flaggable object "${o.id}" renders 0 px — it cannot be clicked`);
      else if (px < 500) warn(`${lotId}: "${o.id}" is only ${px} px. Verify it is not a pixel hunt.`);
    }
    for (const v of lot.truth.violations) {
      const o = objects.find((x) => x.id === v.object);
      const px = o ? (counts.get(o.key) ?? 0) : 0;
      if (px > 0 && px < 250)
        fail(`${lotId}: violation "${v.object}" is only ${px} px. That is a pixel hunt, not a puzzle.`);
    }
  }

  for (const a of introduced)
    if (!anyDecoy)
      fail(`day ${day.level_id}: rule ${a.id} is introduced with no decoy on the route. Every rule ships with a near-miss.`);
}

for (const w of warnings) console.log(`  warn   ${w}`);
for (const e of errors) console.log(`  FAIL   ${e}`);
console.log(`\n${errors.length ? '✗' : '✓'} validator: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
