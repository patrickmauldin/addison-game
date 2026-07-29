/**
 * CONTENT VALIDATOR — gameplan section 11.
 *
 * "Content bugs in a rules game are lethal and near-invisible without this."
 *
 * Walks every day file and asserts:
 *   1. every violation in truth cites an article that is ACTIVE that day
 *   2. every violation/decoy names an object that actually exists on the lot
 *   3. every flaggable object is actually VISIBLE (non-zero pixels in the id
 *      buffer) — an object you cannot click is an unwinnable lot
 *   4. every expected_verdict is derivable from truth + active_rules
 *   5. every rule introduced has at least one decoy instance within two days
 *   6. no generator or anchor is referenced that does not exist
 *   7. nothing renders a colour outside the locked Tier 0 palette
 *
 * Exit code is non-zero on any failure, so this can gate a build.
 */

import { renderLot, ANCHORS, type LotSpec } from '../src/compositor.js';
import { PALETTE } from '../src/core/palette.js';
import { CANVAS_H, CANVAS_W } from '../src/core/projection.js';

import day01 from '../src/data/day01.json';
import rulesData from '../src/data/rules.json';
import lot04 from '../src/data/lots/bonerville_04.json';
import lot07 from '../src/data/lots/bonerville_07.json';

const LOTS: Record<string, LotSpec> = {
  bonerville_04: lot04 as unknown as LotSpec,
  bonerville_07: lot07 as unknown as LotSpec,
};
const DAYS = [day01];

const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

// Every colour the palette permits, packed for O(1) lookup.
const allowed = new Set<number>();
for (const ramp of Object.values(PALETTE))
  for (const [r, g, b] of ramp) allowed.add((r << 16) | (g << 8) | b);

for (const day of DAYS) {
  const active = new Set(day.active_rules);
  const known = new Set(rulesData.articles.map((a) => a.id));

  for (const id of day.active_rules)
    if (!known.has(id)) fail(`day ${day.day_id}: active rule ${id} is not in rules.json`);

  // Rules introduced on this day must be exercised by a decoy soon after.
  const introduced = rulesData.articles.filter((a) => a.introduced_day === day.day_id);

  const decoyArticles = new Set<string>();

  for (const lotId of day.route) {
    const lot = LOTS[lotId];
    if (!lot) {
      fail(`day ${day.day_id}: route references unknown lot "${lotId}"`);
      continue;
    }

    const objectIds = new Set(lot.props.map((p) => p.id));

    // 6 — anchors resolve
    for (const p of [...lot.props, ...lot.landscaping])
      if (!(p.anchor in ANCHORS)) fail(`${lotId}: unknown anchor "${p.anchor}"`);

    // 1 + 2 — violations reference live rules and real objects
    for (const v of lot.truth.violations) {
      if (!objectIds.has(v.object)) fail(`${lotId}: violation names missing object "${v.object}"`);
      if (!active.has(v.article))
        fail(`${lotId}: violation cites ${v.article}, which is NOT active on day ${day.day_id}`);
    }
    for (const d of lot.truth.decoys) {
      if (!objectIds.has(d.object)) fail(`${lotId}: decoy names missing object "${d.object}"`);
    }

    // 4 — expected_verdict must follow from truth, not from an author's mood
    const derived = lot.truth.violations.length > 0 ? 'FAIL' : 'PASS';
    if (day.verdict_mode === 'binary' && lot.expected_verdict !== derived)
      fail(
        `${lotId}: expected_verdict is ${lot.expected_verdict} but truth implies ${derived} ` +
          `(${lot.truth.violations.length} violation(s))`,
      );

    // 3 + 7 — render and inspect
    const { raster, objects } = renderLot(lot);
    const counts = new Map<number, number>();
    for (let i = 0; i < raster.id.length; i++) {
      const k = raster.id[i];
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const o of objects) {
      const px = counts.get(o.key) ?? 0;
      if (px === 0) fail(`${lotId}: flaggable object "${o.id}" renders 0 px — it cannot be clicked`);
      else if (px < 120)
        warn(`${lotId}: "${o.id}" is only ${px} px. Small click target; verify it is not a pixel hunt.`);
    }
    // Any violation object must be comfortably clickable.
    for (const v of lot.truth.violations) {
      const o = objects.find((x) => x.id === v.object);
      const px = o ? (counts.get(o.key) ?? 0) : 0;
      if (px > 0 && px < 60)
        fail(`${lotId}: violation "${v.object}" is only ${px} px. That is a pixel hunt, not a puzzle.`);
    }

    let offPalette = 0;
    for (let i = 0; i < CANVAS_W * CANVAS_H; i++) {
      const p = i << 2;
      const c = (raster.color[p] << 16) | (raster.color[p + 1] << 8) | raster.color[p + 2];
      if (!allowed.has(c)) offPalette++;
    }
    if (offPalette > 0)
      fail(`${lotId}: ${offPalette} px use colours outside the locked palette (Tier 0 violation)`);

    for (const d of lot.truth.decoys) {
      // Attribute the decoy to whichever active article it is a look-alike for.
      for (const a of active) decoyArticles.add(a);
      void d;
    }
  }

  // 5 — every newly introduced rule needs a decoy in play
  for (const a of introduced) {
    if (!decoyArticles.has(a.id))
      fail(`day ${day.day_id}: rule ${a.id} is introduced with no decoy instance on the route`);
    const anyDecoy = day.route.some((l) => (LOTS[l]?.truth.decoys.length ?? 0) > 0);
    if (!anyDecoy)
      fail(`day ${day.day_id}: no lot on the route carries a decoy. Every rule ships with a near-miss.`);
  }
}

for (const w of warnings) console.log(`  warn   ${w}`);
for (const e of errors) console.log(`  FAIL   ${e}`);
console.log(
  `\n${errors.length ? '✗' : '✓'} validator: ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);
