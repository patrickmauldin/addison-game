/**
 * Vertical slice driver — Day 1, Bonerville.
 *
 * Deliberately withholds feedback. You find out you were wrong when the audit
 * lands at the end of the day, never at the moment you stamp. Immediate red-X
 * removes all tension and turns the game into a quiz (gameplan section 5).
 */


import { renderLot, type LotSpec, type RenderedLot, type SceneAssets } from './scene-compositor.js';

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

import day01 from './data/day01.json';
import rulesData from './data/rules.json';
import housesData from './data/houses.json';
import lot01 from './data/lots/bonerville_01.json';
import lot02 from './data/lots/bonerville_02.json';
import lot03 from './data/lots/bonerville_03.json';
import lot04 from './data/lots/bonerville_04.json';
import lot05 from './data/lots/bonerville_05.json';
import lot06 from './data/lots/bonerville_06.json';

const LOTS: Record<string, LotSpec> = {
  bonerville_01: lot01 as unknown as LotSpec,
  bonerville_02: lot02 as unknown as LotSpec,
  bonerville_03: lot03 as unknown as LotSpec,
  bonerville_04: lot04 as unknown as LotSpec,
  bonerville_05: lot05 as unknown as LotSpec,
  bonerville_06: lot06 as unknown as LotSpec,
};

const day = day01;
const ARTICLES = rulesData.articles;

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

const ASSET_FILES = [
  'grass', 'road', 'sidewalk',
  'house1', 'house2', 'house3', 'house4', 'house5', 'house6',
  'fence1', 'fence2', 'fence3',
  'weed1', 'weed2', 'weed3', 'trash-green', 'trash-brown',
];

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
let sliding = false;
let saveFile: SaveFile = load();
let routeIndex = 0;
let current: LotSpec;
let rendered: RenderedLot;
let flagged = new Set<string>();
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
  const rl = renderLot(lot, assets, w, h, worldX);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')!.putImageData(rl.raster.toImageData(), 0, 0);
  return { rl, cv };
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

  // Flag markers, drawn over the finished scene. Half native size (104x117 ->
  // 52x59), an exact halving so the pixel grid survives the downscale.
  const MW = 52;
  const MH = 59;
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

/** Re-render on resize: the layout, not just the canvas, depends on the size. */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!current) return;
    const built = renderToCanvas(current, routeIndex * stageSize().w);
    rendered = built.rl;
    currentCanvas = built.cv;
    centroidCache.clear();
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
  current = LOTS[day.route[index]];
  const sz = stageSize();
  const built = renderToCanvas(current, index * sz.w);
  rendered = built.rl;
  currentCanvas = built.cv;
  flagged = new Set();
  centroidCache.clear();
  stamping = false;

  // Record what we saw today. This is the note that grace periods read from
  // on later days — the player's own observation, not an oracle.
  const rec = recordFor(saveFile, current.lot_id, current.address);
  for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? day.date);
  save(saveFile);

  renderCaseFile(rec);
  paint();
  syncDesk();
}

/**
 * The case file names the address now. It used to be captioned over the
 * viewport as well, which said the same thing twice and pushed the lot off
 * centre — and the address belongs with the record, since that is the tool the
 * player is meant to reach for.
 */
function renderCaseFile(rec: { address: string; lot_id: string; rulings: Ruling[] }): void {
  // A new address means a fresh sheet — the previous verdict's ink goes with it.
  stampMark.classList.remove('on');
  $('cf-addr').textContent = rec.address;
  $('cf-lot').textContent = `${rec.lot_id} · ${current.street}`;
  const el = $('casefile');
  if (!rec.rulings.length) {
    el.className = 'muted';
    el.textContent = 'No prior rulings. First inspection at this address.';
  } else {
    el.className = '';
    el.innerHTML = rec.rulings
      .map((r) => `<div>${r.date} — stamped <b>${r.verdict}</b>, ${r.findings.length} finding(s)</div>`)
      .join('');
  }
}

function syncDesk(): void {
  // Day and weekday on one line. The calendar date is deliberately absent —
  // the weekday is what rules key off (trash day, decor windows) and the ISO
  // date was noise. The Calendar tool carries the full date when it unlocks.
  $('c-day').textContent = `${day.day_id} · ${day.weekday}`;
  $('c-prog').textContent = `${routeIndex + 1} of ${day.route.length}`;
  $('c-quota').textContent = String(day.quota);
  $('c-strikes').textContent = `${saveFile.inspector.strikes_today} / 3`;
  $('c-pay').textContent = `$${saveFile.inspector.pay}`;
  $('m-day').textContent = `Day ${day.day_id}`;
  $('m-pay').textContent = `$${saveFile.inspector.pay}`;

  // Only articles active today are in the book. One scannable line each,
  // formal text and enforcement limits behind a click — this list has to stay
  // legible when a dozen articles are live in Act III.
  const active = ARTICLES.filter((a) => day.active_rules.includes(a.id));
  $('binder-body').innerHTML = active
    .map(
      (a) => `
      <details class="rule">
        <summary>
          <span class="code">${a.id}</span>
          <span class="tab">${a.tab}</span>
          <span class="one">${a.short}</span>
        </summary>
        <div class="body">
          <div class="muted" style="font-size:11px">${a.title} · ${a.section}</div>
          <p class="formal">${a.text}</p>
          <div class="decoy"><b>Enforcement limits.</b> ${a.decoy_note}</div>
        </div>
      </details>`,
    )
    .join('');

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
  $<HTMLButtonElement>('btn-fail').disabled = done;
}

// --- Interaction ----------------------------------------------------------

frame.addEventListener('click', (ev) => {
  if (stamping || sliding) return;
  const p = toLotPixel(ev as MouseEvent);
  const key = rendered.raster.idAt(p.x, p.y);
  if (!key) return;
  const obj = rendered.byKey.get(key);
  if (!obj?.flaggable) return;
  if (flagged.has(obj.id)) flagged.delete(obj.id);
  else flagged.add(obj.id);
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
$('btn-fail').onclick = () => stamp('FAIL');
// --- Menu bar -------------------------------------------------------------
// Most items are inert on purpose and say when they unlock. A greyed row that
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

$('mi-reset').onclick = () => {
  reset();
  location.reload();
};
$('mi-howto').onclick = () => briefing();

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
    day_id: day.day_id,
    date: day.date,
    verdict: v,
    findings: [...flagged].map((object) => ({ object, article: 'R-101' })),
    correct: null,
  });
  saveFile.inspector.pay += day.pay_per_inspection;
  save(saveFile);

  // The verdict lands as ink on the case file. Still no feedback on whether it
  // was RIGHT — that waits for the audit; this is only the physical act of
  // stamping, which is what the player just did.
  stampMark.src = v === 'PASS' ? 'assets/stamp-pass.png' : 'assets/stamp-fail.png';
  stampMark.classList.remove('on');
  // Force a reflow so re-stamping restarts the animation rather than skipping it.
  void stampMark.offsetWidth;
  stampMark.classList.add('on');

  // Long enough to read the impression land, short enough that it does not
  // become a wait. The drive that follows is the longer beat.
  setTimeout(() => {
    if (routeIndex + 1 < day.route.length) slideToLot(routeIndex + 1);
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
  const next = renderToCanvas(LOTS[day.route[index]], index * sz.w);

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
    current = LOTS[day.route[index]];
    rendered = next.rl;
    currentCanvas = next.cv;
    flagged = new Set();
    centroidCache.clear();
    stamping = false;
    const rec = recordFor(saveFile, current.lot_id, current.address);
    for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? day.date);
    save(saveFile);
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

// --- End of day: the audit ------------------------------------------------

function endDay(): void {
  let strikes = 0;
  for (const o of outcomes) {
    if (o.strike) strikes++;
    bumpAccuracy(saveFile, 'R-101', o.verdictRight && o.falsePositives.length === 0);
    const rec = saveFile.addresses[o.lot_id];
    const last = rec.rulings[rec.rulings.length - 1];
    if (last) last.correct = o.verdictRight && o.falsePositives.length === 0;
    rec.state = o.missed.length ? 'UNCAUGHT' : o.hits.length ? 'FLAGGED' : 'CLEAN';
    if (o.falsePositives.length) rec.disposition -= 1;
  }
  saveFile.inspector.strikes_today = strikes;
  save(saveFile);

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
      const ok = o.verdictRight && !o.falsePositives.length;
      return `<div class="verdict-row ${ok ? 'good' : 'bad'}">
        <b>${o.address}</b> — you stamped ${o.stamped}; correct verdict was ${o.expected}.
        ${bits.join('') || '<div>No exceptions taken.</div>'}
      </div>`;
    })
    .join('');

  sheet.innerHTML = `
    <h1>END OF DAY ${day.day_id}</h1>
    <div class="muted">${day.weekday} ${day.date} · ${current.street}</div>

    <h3>Board Audit</h3>
    <p class="muted">Findings are reviewed the following morning. You were not told at the time.</p>
    ${rows}

    <h3>Pay Stub</h3>
    <p>${outcomes.length} inspections × $${day.pay_per_inspection} = <b>$${pay}</b>
       ${shortfall > 0 ? `<br><span class="muted">Quota was ${day.quota}. Short ${shortfall}. In the full campaign this docks the stub.</span>` : ''}</p>
    <p>Strikes today: <b>${strikes}</b> / 3 &nbsp;·&nbsp; Cumulative accuracy: <b>${acc}%</b>
       ${acc < 70 ? '<br><span class="muted">Below 70%. In the full campaign this triggers probation at the bi-weekly review.</span>' : ''}</p>

    <h3>What this slice was testing</h3>
    <p>1. Does a weed patch read as a violation at 100% zoom without frustration?<br>
       2. Does the xeriscape bed at 4418 read as <i>intentional</i> — i.e. did you leave it alone?<br>
       3. Did you open the binder's "enforcement limits" note before stamping?</p>
    <p class="muted">Question 2 is the one that matters. Both beds sit at the same anchor and use the
       same green family; only containment and spacing differ. If you flagged the bed at 4418,
       the 4.8/4.9 pair needs retuning before any further content is authored.</p>

    <p style="margin-top:18px"><button class="btn" onclick="location.reload()">Run the day again</button></p>
  `;
  overlay.classList.add('on');
}

// --- Boot -----------------------------------------------------------------

function briefing(): void {
  sheet.innerHTML = `
    <h1>ADDISON MASTER COMMUNITY ASSOCIATION</h1>
    <div class="muted">Compliance Inspector · Day ${day.day_id} · ${day.weekday} ${day.date}</div>
    <h3>Morning Briefing</h3>
    <p>${day.briefing}</p>
    <h3>Today's Route</h3>
    <p>${day.route.length} inspections on Bonerville. Paid $${day.pay_per_inspection} each.</p>
    <h3>How this works</h3>
    <p>Click anything on the lot to mark it as a finding. Click it again to unmark.
       Read the binder before you stamp — the article has an enforcement-limits note
       folded underneath it, and it is load-bearing.</p>
    <p>Stamp <b>PASS</b> or <b>FAIL</b>. You will not be told whether you were right.
       The board reviews your calls overnight.</p>
    <p style="margin-top:18px"><button class="btn" id="btn-start">Begin route</button></p>
  `;
  overlay.classList.add('on');
  $('btn-start').onclick = () => {
    overlay.classList.remove('on');
    loadLot(0);
  };
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
    title.classList.remove('on');
    briefing();
  };
}

async function boot(): Promise<void> {
  try {
    saveFile.inspector.strikes_today = 0;
    // Loaded before the title screen, so the first lot never renders a
    // placeholder that then pops to real art a frame later.
    assets = await loadAssets();
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
