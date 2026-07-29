/**
 * Vertical slice driver — Day 1, Bonerville.
 *
 * Deliberately withholds feedback. You find out you were wrong when the audit
 * lands at the end of the day, never at the moment you stamp. Immediate red-X
 * removes all tension and turns the game into a quiz (gameplan section 5).
 */

import { CANVAS_H, CANVAS_W } from './core/projection.js';
import { renderLot, type LotSpec, type RenderedLot } from './compositor.js';
import { makeSprite, type HouseManifest, type SpriteRegistry } from './gen/sprite.js';
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
  type SaveFile,
  type Verdict,
} from './game/state.js';

import day01 from './data/day01.json';
import rulesData from './data/rules.json';
import lot04 from './data/lots/bonerville_04.json';
import lot07 from './data/lots/bonerville_07.json';

const LOTS: Record<string, LotSpec> = {
  bonerville_04: lot04 as unknown as LotSpec,
  bonerville_07: lot07 as unknown as LotSpec,
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
const filedBadge = $('filed');

// Offscreen buffer holding the native-resolution lot.
const off = document.createElement('canvas');
off.width = CANVAS_W;
off.height = CANVAS_H;
const offCtx = off.getContext('2d')!;

// --- Sprite loading -------------------------------------------------------

/**
 * Loads ingested house sprites. Image + canvas IS a PNG decoder, so the browser
 * needs none of core/png.
 *
 * Every failure path here is non-fatal by design: a missing index, a missing
 * file, a broken manifest all just leave that shell out of the registry, and
 * the compositor falls back to the generator. Art arriving is an enhancement,
 * never a dependency — which is what lets content be authored ahead of it.
 */
async function loadSprites(): Promise<SpriteRegistry> {
  const reg: SpriteRegistry = new Map();
  try {
    const index = (await (await fetch('assets/houses/index.json')).json()) as { sprites: string[] };
    await Promise.all(
      index.sprites.map(async (id) => {
        try {
          const manifest = (await (await fetch(`assets/houses/${id}.json`)).json()) as HouseManifest;
          const img = await new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = `assets/houses/${id}.png`;
          });
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const cx = c.getContext('2d')!;
          cx.imageSmoothingEnabled = false;
          cx.drawImage(img, 0, 0);
          const data = cx.getImageData(0, 0, c.width, c.height);
          reg.set(id, makeSprite(manifest, c.width, c.height, data.data));
        } catch {
          /* this shell falls back to the generator */
        }
      }),
    );
  } catch {
    /* no sprites ingested yet; every shell falls back to the generator */
  }
  return reg;
}

// --- Session state --------------------------------------------------------
let sprites: SpriteRegistry = new Map();
let saveFile: SaveFile = load();
let routeIndex = 0;
let current: LotSpec;
let rendered: RenderedLot;
let flagged = new Set<string>();
let outcomes: LotOutcome[] = [];
let scale = 1;
let panX = 0;
let panY = 0;
let stamping = false;

// --- Rendering ------------------------------------------------------------

function paint(): void {
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.imageSmoothingEnabled = false;

  offCtx.putImageData(rendered.raster.toImageData(), 0, 0);

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(
    off,
    panX, panY, CANVAS_W / scale, CANVAS_H / scale,
    0, 0, CANVAS_W, CANVAS_H,
  );

  // Flag markers. Drawn in screen space over the scaled image so they stay
  // legible at 1x — the marker is UI, not art, and should not pixel-double.
  for (const id of flagged) {
    const obj = rendered.objects.find((o) => o.id === id);
    if (!obj) continue;
    const c = centroid(obj.key);
    if (!c) continue;
    const x = (c.x - panX) * scale;
    const y = (c.y - panY) * scale;
    ctx.strokeStyle = '#e8452f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }
}

/** Average position of an object's pixels in the id buffer. */
const centroidCache = new Map<number, { x: number; y: number } | null>();
function centroid(key: number): { x: number; y: number } | null {
  if (centroidCache.has(key)) return centroidCache.get(key)!;
  const { id } = rendered.raster;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < id.length; i++) {
    if (id[i] !== key) continue;
    sx += i % CANVAS_W;
    sy += (i / CANVAS_W) | 0;
    n++;
  }
  const res = n ? { x: sx / n, y: sy / n } : null;
  centroidCache.set(key, res);
  return res;
}

function toLotPixel(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor((ev.clientX - r.left) / scale + panX),
    y: Math.floor((ev.clientY - r.top) / scale + panY),
  };
}

// --- Lot lifecycle --------------------------------------------------------

function loadLot(index: number): void {
  routeIndex = index;
  current = LOTS[day.route[index]];
  rendered = renderLot(current, sprites);
  flagged = new Set();
  centroidCache.clear();
  scale = 1;
  panX = 0;
  panY = 0;
  stamping = false;

  // Record what we saw today. This is the note that grace periods read from
  // on later days — the player's own observation, not an oracle.
  const rec = recordFor(saveFile, current.lot_id, current.address);
  for (const p of current.props) noteFirstSeen(rec, p.id, p.first_seen ?? day.date);
  save(saveFile);

  $('addr-l').textContent = current.address;
  $('addr-r').textContent = current.lot_id;
  renderCaseFile(rec.rulings.length);
  paint();
  syncDesk();
}

function renderCaseFile(priorCount: number): void {
  const el = $('casefile');
  if (!priorCount) {
    el.className = 'muted';
    el.textContent = 'No prior rulings at this address. First inspection.';
  } else {
    el.className = '';
    el.textContent = `${priorCount} prior ruling(s) on file.`;
  }
}

function syncDesk(): void {
  $('c-day').textContent = String(day.day_id);
  $('c-date').textContent = `${day.weekday} ${day.date}`;
  $('c-street').textContent = current.street;
  $('c-prog').textContent = `${routeIndex + 1} of ${day.route.length}`;
  $('c-quota').textContent = `${day.route.length} / ${day.quota} specced`;
  $('c-strikes').textContent = String(saveFile.inspector.strikes_today);
  $('c-pay').textContent = `$${saveFile.inspector.pay}`;

  // Binder: only articles active today are physically in the binder.
  const active = ARTICLES.filter((a) => day.active_rules.includes(a.id));
  $('binder-body').innerHTML = active
    .map(
      (a) => `
      <div class="art">${a.id} — ${a.title}</div>
      <div class="muted" style="font-size:11px">${a.section}</div>
      <p style="margin:6px 0">${a.text}</p>
      <details>
        <summary>See also — enforcement limits</summary>
        <div class="decoy">${a.decoy_note}</div>
      </details>`,
    )
    .join('<hr style="border:0;border-top:1px solid var(--rule);margin:10px 0">');

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
  if (stamping) return;
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
  const p = toLotPixel(ev as MouseEvent);
  const obj = rendered.byKey.get(rendered.raster.idAt(p.x, p.y));
  // The loupe is an INFORMATION tool, not a magnifier: label and first-seen
  // date, never more pixels (manifest section 10, "Resolution & zoom").
  $('hover').textContent = obj?.flaggable
    ? `${obj.label}${obj.first_seen ? ` · first observed ${obj.first_seen}` : ''}`
    : '';
});

$('btn-zoom').onclick = () => {
  scale = scale === 1 ? 2 : 1;
  panX = scale === 2 ? CANVAS_W / 4 : 0;
  panY = scale === 2 ? CANVAS_H / 4 : 0;
  $('btn-zoom').innerHTML = `ZOOM ${scale}&times;`;
  paint();
};

// Drag to pan when zoomed.
let dragging = false;
let lastX = 0;
let lastY = 0;
frame.addEventListener('mousedown', (e) => {
  if (scale === 1) return;
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('mouseup', () => (dragging = false));
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  panX = clamp(panX - (e.clientX - lastX) / scale, 0, CANVAS_W - CANVAS_W / scale);
  panY = clamp(panY - (e.clientY - lastY) / scale, 0, CANVAS_H - CANVAS_H / scale);
  lastX = e.clientX;
  lastY = e.clientY;
  paint();
});
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

$('btn-pass').onclick = () => stamp('PASS');
$('btn-fail').onclick = () => stamp('FAIL');
$('btn-reset').onclick = () => {
  reset();
  location.reload();
};

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

  // No feedback. Just the stamp landing and the next car pulling up.
  filedBadge.classList.add('on');
  setTimeout(() => {
    filedBadge.classList.remove('on');
    if (routeIndex + 1 < day.route.length) loadLot(routeIndex + 1);
    else endDay();
  }, 850);
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
    sprites = await loadSprites();
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
