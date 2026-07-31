/**
 * Measures each house's art and reports where its driveway, walk and side-yard
 * fence line actually are, as fractions of the house rect.
 *
 * Anchors are authored by hand but must not be GUESSED by hand — these numbers
 * come from the pixels, so an override is a transcription rather than an
 * estimate. Re-run after any house art changes.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { decodePng, type Bitmap } from '../src/core/png.js';

const HOUSES = ['house1','house2','house3','house4','house5','house6'];

function load(id: string): Bitmap {
  execSync(`sips -s format png "assets/houses/${id}.jpg" --out /tmp/${id}.png`, { stdio: 'ignore' });
  return decodePng(readFileSync(`/tmp/${id}.png`));
}
const at = (b: Bitmap, x: number, y: number) => {
  const i = (Math.min(b.h-1,Math.max(0,y)) * b.w + Math.min(b.w-1,Math.max(0,x))) << 2;
  return [b.rgba[i], b.rgba[i+1], b.rgba[i+2]];
};
const kind = (c: number[]): 'grass'|'paving'|'structure' =>
  c[1] - c[2] > 60 ? 'grass' : (c[0] > 150 && c[1] > 130 && c[2] > 95) ? 'paving' : 'structure';

function runs(b: Bitmap, y: number, want: string, min = 30): Array<[number,number]> {
  const out: Array<[number,number]> = [];
  let s = -1;
  for (let x = 0; x < b.w; x++) {
    if (kind(at(b,x,y)) === want) { if (s < 0) s = x; }
    else if (s >= 0) { if (x - s >= min) out.push([s,x]); s = -1; }
  }
  if (s >= 0 && b.w - s >= min) out.push([s, b.w]);
  return out;
}

type Row = { id:string; drive:[number,number]; walk:[number,number]|null; fenceX:number; fenceY:number; garageY:number };
const rows: Row[] = [];

for (const id of HOUSES) {
  const b = load(id);
  const F = (v: number) => v / b.w;

  // Driveway: widest paving run reaching the bottom edge.
  const bottom = runs(b, b.h - 4, 'paving', 60);
  const drive = bottom.reduce((a, c) => (c[1]-c[0] > a[1]-a[0] ? c : a), bottom[0] ?? [0,0]);

  // Walk: a narrower paving run beside the driveway, on EITHER side — house3's
  // garage is on the left, so its walk is to the right of its drive.
  let walk: [number,number]|null = null;
  for (const hy of [0.60,0.63,0.66,0.69,0.72]) {
    const cand = runs(b, Math.round(b.h*hy), 'paving', 25)
      .filter(r => r[1] <= drive[0] + 8 || r[0] >= drive[1] - 8)
      .filter(r => r[1]-r[0] < (drive[1]-drive[0]) * 0.8);
    if (cand.length) { walk = cand.sort((p,q)=>(q[1]-q[0])-(p[1]-p[0]))[0]; break; }
  }

  // Fence line. The fence butts the house's RIGHT WALL, not the roof overhang,
  // so find the lowest row whose rightmost structure still reaches far right —
  // below that the built mass has ended and the side yard begins.
  let fenceY = 0;
  for (let y = Math.round(b.h*0.30); y < Math.round(b.h*0.72); y++) {
    const r = runs(b, y, 'structure', 40);
    if (!r.length) continue;
    if (r[r.length-1][1] >= b.w * 0.84) fenceY = y;
  }
  // Rightmost structure ON THE FENCE ROW. Taking the widest point of the whole
  // built mass instead picks the roof overhang, which sits further right than
  // the wall beneath it and leaves the fence floating clear of the house.
  const fr = runs(b, fenceY, 'structure', 40);
  const fenceX = fr.length ? fr[fr.length-1][1] : Math.round(b.w*0.9);

  // Garage apron: where the driveway meets the building, i.e. the top of the
  // driveway run. Anchors for bins-at-the-garage hang off this.
  let garageY = Math.round(b.h*0.6);
  for (let y = Math.round(b.h*0.45); y < b.h; y++) {
    const mid = Math.round((drive[0]+drive[1])/2);
    if (kind(at(b, mid, y)) === 'paving') { garageY = y; break; }
  }

  rows.push({ id, drive:[F(drive[0]),F(drive[1])], walk: walk?[F(walk[0]),F(walk[1])]:null,
              fenceX: F(fenceX), fenceY: fenceY/b.h, garageY: garageY/b.h });
}

// --- Emit a verified anchor table ------------------------------------------
// Rather than transcribe measurements by hand and have the validator reject
// them, place every anchor and then CHECK it against the art, nudging any that
// missed to the nearest point of the right surface. Hand transcription of six
// houses times a dozen anchors is where the errors were coming from.
import { DEFAULT_ANCHORS, ANCHOR_SURFACE } from '../src/core/scene.js';
import { writeFileSync } from 'node:fs';

function surfaceAt(b: Bitmap, hx: number, hy: number) {
  return kind(at(b, Math.round(hx*b.w), Math.round(hy*b.h)));
}
function ok(want: string, got: string) {
  return want === 'bed' ? got === 'structure' : got === want;
}
/** Spiral out from a point for the nearest spot on the required surface. */
function settle(b: Bitmap, hx: number, hy: number, want: string) {
  if (ok(want, surfaceAt(b, hx, hy))) return { hx, hy };
  for (let rad = 0.01; rad <= 0.42; rad += 0.01) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[0.7,0.7],[-0.7,0.7],[0.7,-0.7],[-0.7,-0.7]]) {
      const nx = hx + dx*rad, ny = hy + dy*rad;
      if (nx < 0.04 || nx > 0.97 || ny < 0.50 || ny > 0.99) continue;
      if (ok(want, surfaceAt(b, nx, ny))) return { hx: +nx.toFixed(3), hy: +ny.toFixed(3) };
    }
  }
  return null;
}

const houses: Record<string, any> = {};
for (const r of rows) {
  const b = load(r.id);
  const dc = (r.drive[0]+r.drive[1])/2;
  const seed: Record<string, {hx:number;hy:number}> = {
    ...DEFAULT_ANCHORS,
    DRIVEWAY_1: { hx: dc, hy: 0.70 },
    DRIVEWAY_2: { hx: dc, hy: 0.82 },
    DRIVEWAY_3: { hx: dc, hy: 0.95 },
    APRON_1: { hx: r.drive[0] + (r.drive[1]-r.drive[0])*0.22, hy: r.garageY + 0.05 },
    APRON_2: { hx: r.drive[0] + (r.drive[1]-r.drive[0])*0.62, hy: r.garageY + 0.05 },
    WALK_1: { hx: r.walk ? (r.walk[0]+r.walk[1])/2 : 0.49, hy: 0.66 },
    FENCE_1: { hx: +(r.fenceX - 0.004).toFixed(3), hy: r.fenceY },
    /**
     * Behind that fence, derived from it so the two cannot drift apart.
     *
     * The fence is LEFT-ALIGNED on its anchor and 265px wide — 0.21 of the
     * house rect — so it runs to the RIGHT of FENCE_1. Offsetting left put the
     * bins beside the panel where nothing screened them. +0.05 sets them
     * inside its span, and clear of the building — which is what then makes
     * -0.03 safe, where before it stood them up the house wall.
     *
     * -0.03 rather than -0.01 on purpose. Tucked fully behind the panel the
     * bins are invisible, and a decoy nobody can see teaches nothing: the
     * player has to be able to tell there ARE bins here and that they are
     * screened. Their lids clear the fence by about twenty pixels.
     */
    BINS_SCREENED: { hx: +(r.fenceX + 0.05).toFixed(3), hy: +(r.fenceY - 0.03).toFixed(3) },
  };
  const table: Record<string, {hx:number;hy:number}> = {};
  const unresolved: string[] = [];
  for (const [name, a] of Object.entries(seed)) {
    const want = ANCHOR_SURFACE[name];
    if (!want || want === 'road') continue;            // curbside sits off the art
    if (want === 'attach') { table[name] = { hx: +a.hx.toFixed(3), hy: +a.hy.toFixed(3) }; continue; }
    const fixed = settle(b, a.hx, a.hy, want);
    if (!fixed) { unresolved.push(name); continue; }
    table[name] = { hx: +fixed.hx.toFixed(3), hy: +fixed.hy.toFixed(3) };
  }
  if (unresolved.length) console.log(`  !! ${r.id}: could not place ${unresolved.join(', ')}`);
  houses[r.id] = { _plan: '', anchors: table };
}

const PLANS: Record<string,string> = {
  house1: 'Garage right. Walk curves from the door to meet the driveway high, near the garage.',
  house2: 'Garage right, driveway slightly left of house1. Walk down the left side.',
  house3: 'MIRRORED PLAN — garage and driveway on the LEFT, entry on the right. Its walk is on the opposite side from every other house, and the default yard anchors land on its driveway.',
  house4: 'Garage right, narrow single-width driveway.',
  house5: 'Garage right.',
  house6: 'Three-car garage — the widest driveway of the set. Walk is far left.',
};
for (const id of Object.keys(houses)) houses[id]._plan = PLANS[id] ?? '';

writeFileSync('src/data/houses.json', JSON.stringify({
  _note: 'Per-house anchor overrides. Anything omitted falls back to DEFAULT_ANCHORS in core/scene.ts.',
  _source: 'GENERATED by tools/map-houses.ts — measured from the art, then every anchor checked against the required surface and nudged to the nearest valid point. Re-run after any house art changes; do not hand-edit.',
  _check: 'core/scene.ts declares the surface each anchor must sit on; the validator re-samples the art and fails when one misses.',
  _screened: 'BINS_SCREENED sits just up-screen of FENCE_1 so props sorted by anchor y put the fence in front of the bins. R-104 treats screened containers as compliant on any day, whatever state the fence is in.',
  _fence: 'FENCE_1 is left-aligned (PropSpec.align) so the panel end post meets the house wall rather than straddling it. Clean right side on every plan, per the reference.',
  houses,
}, null, 2) + '\n');
console.log(`\nwrote src/data/houses.json for ${Object.keys(houses).length} houses`);

const p3 = (v:number)=>v.toFixed(3);
console.log('fractions of the house rect\n');
console.log('id       driveway            center  walk                center  fence x  fence base  garage top');
for (const r of rows) {
  console.log(
    `${r.id}  ${p3(r.drive[0])}..${p3(r.drive[1])}       ${p3((r.drive[0]+r.drive[1])/2)}   ` +
    `${r.walk ? p3(r.walk[0])+'..'+p3(r.walk[1]) : '   (none)     '}       ` +
    `${r.walk ? p3((r.walk[0]+r.walk[1])/2) : '  -  '}   ` +
    `${p3(r.fenceX)}    ${p3(r.fenceY)}       ${p3(r.garageY)}`
  );
}
console.log('\nsuggested anchors:\n');
for (const r of rows) {
  const dc = (r.drive[0]+r.drive[1])/2;
  const wc = r.walk ? (r.walk[0]+r.walk[1])/2 : 0.49;
  // Bins at the garage sit just below the apron, inset from the drive edges.
  const a1 = r.drive[0] + (r.drive[1]-r.drive[0]) * 0.22;
  const a2 = r.drive[0] + (r.drive[1]-r.drive[0]) * 0.62;
  console.log(`  "${r.id}": DRIVEWAY ${p3(dc)}  APRON ${p3(a1)}/${p3(a2)} @hy ${p3(r.garageY+0.04)}  WALK ${p3(wc)}  FENCE ${p3(r.fenceX)} @hy ${p3(r.fenceY)}`);
}
