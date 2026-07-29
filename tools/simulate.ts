/**
 * Headless playthrough of Day 1 under three player behaviours.
 *
 * Verifies the mechanics without a browser: adjudication, the asymmetry
 * between false positives and false negatives, and whether the decoy actually
 * punishes the player who pattern-matches on "green thing in the yard".
 */

import { adjudicate, type Verdict } from '../src/game/state.js';
import { renderLot, type LotSpec } from '../src/scene-compositor.js';
import lot04 from '../src/data/lots/bonerville_04.json';
import lot07 from '../src/data/lots/bonerville_07.json';
import day01 from '../src/data/day01.json';

const LOTS: Record<string, LotSpec> = {
  bonerville_04: lot04 as unknown as LotSpec,
  bonerville_07: lot07 as unknown as LotSpec,
};

type Play = { lot: string; flag: string[]; stamp: Verdict };

const SCENARIOS: Array<{ name: string; note: string; plays: Play[] }> = [
  {
    name: 'Diligent',
    note: 'Reads the binder, cites both weeds, leaves the xeriscape bed alone.',
    plays: [
      { lot: 'bonerville_04', flag: ['r101_yard'], stamp: 'FAIL' },
      { lot: 'bonerville_07', flag: [], stamp: 'PASS' },
    ],
  },
  {
    name: 'Pattern-matcher',
    note: 'Flags anything green and low. This is the behaviour the decoy exists to catch.',
    plays: [
      { lot: 'bonerville_04', flag: ['r101_yard'], stamp: 'FAIL' },
      { lot: 'bonerville_07', flag: ['r101_yard'], stamp: 'FAIL' },
    ],
  },
  {
    name: 'Rubber stamp',
    note: 'Passes everything without looking. The fastest way to hit quota.',
    plays: [
      { lot: 'bonerville_04', flag: [], stamp: 'PASS' },
      { lot: 'bonerville_07', flag: [], stamp: 'PASS' },
    ],
  },
];

for (const s of SCENARIOS) {
  console.log(`\n=== ${s.name} ===`);
  console.log(`    ${s.note}`);
  let strikes = 0;
  let right = 0;
  for (const p of s.plays) {
    const lot = LOTS[p.lot];
    const { objects } = renderLot(lot, { tiles: {} });
    const labels = new Map(objects.map((o) => [o.id, o.label]));
    const o = adjudicate(lot, labels, new Set(p.flag), p.stamp, day01.pay_per_inspection);
    if (o.strike) strikes++;
    if (o.verdictRight && !o.falsePositives.length) right++;
    console.log(`  ${o.address}  stamped ${o.stamped}, correct ${o.expected}`);
    for (const h of o.hits) console.log(`     upheld        ${h.label}`);
    for (const m of o.missed) console.log(`     AUDIT FINDING ${m.label} — missed ${m.article}`);
    for (const f of o.falsePositives) console.log(`     APPEAL WON    ${f.label} — association pays costs`);
    if (o.strike) console.log(`     >> STRIKE`);
  }
  const pay = s.plays.length * day01.pay_per_inspection;
  console.log(
    `  --> $${pay} · ${strikes} strike(s) · ${right}/${s.plays.length} clean ` +
      `· quota ${s.plays.length}/${day01.quota}`,
  );
}
console.log('');
