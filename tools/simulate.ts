/**
 * Headless playthrough of the whole campaign under three player behaviors.
 *
 * Verifies the mechanics without a browser: adjudication, the asymmetry between
 * false positives and false negatives, and whether the decoys actually punish
 * the player who pattern-matches on "thing in the yard that looks off".
 *
 * RUNS THE LEVELS IN SEQUENCE, carrying one save across all of them. That is
 * the whole point of it now. A fine is only correct where the player themselves
 * issued a warning last time, and a grace period only expires relative to the
 * date they first wrote the thing down — neither can be checked one level at a
 * time, and the only place the campaign is played end to end is here.
 *
 * The route, the real violations and the temptations are all DERIVED from each
 * level's own truth block, so the simulation cannot go on testing content that
 * no longer exists.
 */

import {
  adjudicate,
  emptySave,
  noteFirstSeen,
  recordFor,
  type ArticleTiming,
  type SaveFile,
  type Verdict,
} from '../src/game/state.js';
import { dateForLevel } from '../src/game/calendar.js';
import { renderLot, type LotSpec } from '../src/scene-compositor.js';
import rulesData from '../src/data/rules.json';
import level1 from '../src/data/levels/level1.json';
import level2 from '../src/data/levels/level2.json';
import level3 from '../src/data/levels/level3.json';
import level4 from '../src/data/levels/level4.json';
import level5 from '../src/data/levels/level5.json';
import level6 from '../src/data/levels/level6.json';
import level7 from '../src/data/levels/level7.json';
import level8 from '../src/data/levels/level8.json';

type Truth = { violations?: { object: string; article: string }[]; decoys?: { object: string }[] };
type Lot = LotSpec & { lot_id: string; address: string; truth: Required<Truth>; props?: { id: string; first_seen?: string }[] };
type Level = { level_id: number; quota: number; pay_per_inspection: number; verdict_mode: string; lots: Lot[] };

const LEVELS = [level1, level2, level3, level4, level5, level6, level7, level8] as unknown as Level[];

const TIMING: Record<string, ArticleTiming> = Object.fromEntries(
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

/** How the player decides what to mark. The verdict follows from the marks. */
type Behavior = { name: string; note: string; flag: (l: Lot) => string[]; stamp: 'correct' | 'PASS' };

const BEHAVIORS: Behavior[] = [
  {
    name: 'Diligent',
    note: 'Reads the binder, cites every real finding, leaves the decoys alone, stamps the right severity.',
    flag: (l) => (l.truth.violations ?? []).map((v) => v.object),
    stamp: 'correct',
  },
  {
    name: 'Cites what looks wrong',
    note: 'Never opens the binder. Flags anything that looks off, decoys included.',
    flag: (l) => [...(l.truth.violations ?? []).map((v) => v.object), ...(l.truth.decoys ?? []).map((d) => d.object)],
    stamp: 'correct',
  },
  {
    name: 'Guesses the verdict',
    note: 'Marks NOTHING, but stamps the right severity every time. The exploit: the verdict is computed from what is wrong with the lot, not from what was written up, so this used to score a perfect day without opening the binder. A missed violation is a strike now, and this should fail every lot that has one.',
    flag: () => [],
    stamp: 'correct',
  },
  {
    name: 'Rubber stamp',
    note: 'Passes everything without looking. The fastest way to hit quota.',
    flag: () => [],
    stamp: 'PASS',
  },
];

for (const b of BEHAVIORS) {
  console.log(`\n\n######## ${b.name.toUpperCase()} ########`);
  console.log(`  ${b.note}`);
  const save: SaveFile = emptySave();
  let strikes = 0;
  let clean = 0;
  let lots = 0;

  for (const level of LEVELS) {
    const today = dateForLevel(level.level_id);
    console.log(`\n=== SHIFT ${level.level_id} · ${today.weekday} ${today.label} · ${level.verdict_mode} ===`);
    for (const lot of level.lots) {
      const { objects } = renderLot(lot, { sprites: new Map() }, 1060, 860);
      const labels = new Map(objects.map((o) => [o.id, o.label]));
      const kinds = new Map(objects.map((o) => [o.id, o.group ?? o.label]));

      // Visiting the lot is what starts a grace clock, exactly as in play.
      const rec = recordFor(save, lot.lot_id, lot.address);
      for (const p of lot.props ?? []) noteFirstSeen(rec, p.id, p.first_seen ?? today.iso);

      const flagged = new Set(b.flag(lot));
      const ctx = { today: { iso: today.iso, weekday: today.weekday }, timing: TIMING, rec };
      // Probe for the correct verdict rather than restating the escalation rule
      // here — a simulator that computes its own answer is checking itself.
      const probe = adjudicate(lot, labels, kinds, flagged, 'PASS', 0, ctx);
      const stamp: Verdict = b.stamp === 'PASS' ? 'PASS' : probe.expected;
      const o = adjudicate(lot, labels, kinds, flagged, stamp, level.pay_per_inspection, ctx);

      rec.rulings.push({
        day_id: level.level_id,
        date: today.iso,
        verdict: stamp,
        findings: [...flagged].map((object) => ({
          object,
          article: lot.truth.violations.find((v) => v.object === object)?.article ?? null,
        })),
        correct: o.verdictRight,
      });

      lots++;
      if (o.strike) strikes++;
      if (o.verdictRight && !o.falsePositives.length && !o.missed.length) clean++;
      const mark = o.stamped === o.expected ? ' ' : '!';
      console.log(`  ${mark} ${o.address}  stamped ${o.stamped}, correct ${o.expected}`);
      for (const h of o.hits) console.log(`       upheld        ${h.label} (${h.article})`);
      for (const m of o.missed) console.log(`       AUDIT FINDING ${m.label} — missed ${m.article}`);
      for (const f of o.falsePositives) console.log(`       APPEAL WON    ${f.label} — ${f.why}`);
      if (o.strike) console.log(`       >> STRIKE`);
    }
  }
  console.log(`\n  --> ${lots} inspections · ${strikes} strike(s) · ${clean}/${lots} clean`);
}
console.log('');
