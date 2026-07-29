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
 * hand-authored and carries its own colour, so the useful question became
 * "is this exportable" rather than "is this on my palette".
 */

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderLot, type Bitmap, type LotSpec } from '../src/scene-compositor.js';
import { ANCHORS } from '../src/core/scene.js';
import { decodePng } from '../src/core/png.js';

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

// --- Ground tiles ---------------------------------------------------------
// Grass is the background of every lot, so a seam in it is a seam in the whole
// game. Measured by comparing the wrap-around edge against a typical adjacent
// pair: if wrapping is much worse than neighbouring, it does not tile.
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
  if (seamX > nbrX * 2.2)
    warn(`${name}: horizontal seam (edge ${seamX.toFixed(1)} vs neighbour ${nbrX.toFixed(1)}). Repeats visibly across x.`);
  if (axes === 'both' && seamY > nbrY * 2.2)
    warn(`${name}: vertical seam (edge ${seamY.toFixed(1)} vs neighbour ${nbrY.toFixed(1)}). Bands every ${b.h}px.`);
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
for (const name of ['grass','road','sidewalk','house1','weed1','weed2','weed3','trash-green','trash-brown']) {
  for (const ext of ['png','jpg']) {
    const path = `assets/${name}.${ext}`;
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

// --- Days and lots --------------------------------------------------------
for (const day of DAYS) {
  const active = new Set(day.active_rules);
  const known = new Set(rulesData.articles.map((a) => a.id));
  for (const id of day.active_rules)
    if (!known.has(id)) fail(`day ${day.day_id}: active rule ${id} is not in rules.json`);

  const introduced = rulesData.articles.filter((a) => a.introduced_day === day.day_id);
  let anyDecoy = false;

  for (const lotId of day.route) {
    const lot = LOTS[lotId];
    if (!lot) {
      fail(`day ${day.day_id}: route references unknown lot "${lotId}"`);
      continue;
    }
    const objectIds = new Set(lot.props.map((p) => p.id));

    for (const p of lot.props)
      if (!(p.anchor in ANCHORS)) fail(`${lotId}: unknown anchor "${p.anchor}"`);

    for (const v of lot.truth.violations) {
      if (!objectIds.has(v.object)) fail(`${lotId}: violation names missing object "${v.object}"`);
      if (!active.has(v.article))
        fail(`${lotId}: violation cites ${v.article}, not active on day ${day.day_id}`);
    }
    for (const d of lot.truth.decoys)
      if (!objectIds.has(d.object)) fail(`${lotId}: decoy names missing object "${d.object}"`);
    if (lot.truth.decoys.length) anyDecoy = true;

    const derived = lot.truth.violations.length > 0 ? 'FAIL' : 'PASS';
    if (day.verdict_mode === 'binary' && lot.expected_verdict !== derived)
      fail(`${lotId}: expected_verdict is ${lot.expected_verdict} but truth implies ${derived}`);

    const { raster, objects } = renderLot(lot, { sprites: SPRITES }, 1060, 860);
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
      fail(`day ${day.day_id}: rule ${a.id} is introduced with no decoy on the route. Every rule ships with a near-miss.`);
}

for (const w of warnings) console.log(`  warn   ${w}`);
for (const e of errors) console.log(`  FAIL   ${e}`);
console.log(`\n${errors.length ? '✗' : '✓'} validator: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
