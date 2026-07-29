/**
 * Headless playthrough of Day 1 under three player behaviours.
 *
 * Verifies the mechanics without a browser: adjudication, the asymmetry
 * between false positives and false negatives, and whether the decoy actually
 * punishes the player who pattern-matches on "green thing in the yard".
 */

import { adjudicate, type Verdict } from '../src/game/state.js';
import { renderLot, type LotSpec } from '../src/scene-compositor.js';
import lot01 from '../src/data/lots/bonerville_01.json';
import lot02 from '../src/data/lots/bonerville_02.json';
import lot03 from '../src/data/lots/bonerville_03.json';
import lot04 from '../src/data/lots/bonerville_04.json';
import lot05 from '../src/data/lots/bonerville_05.json';
import lot06 from '../src/data/lots/bonerville_06.json';
import day01 from '../src/data/day01.json';

const LOTS: Record<string, LotSpec> = {
  bonerville_01: lot01 as unknown as LotSpec,
  bonerville_02: lot02 as unknown as LotSpec,
  bonerville_03: lot03 as unknown as LotSpec,
  bonerville_04: lot04 as unknown as LotSpec,
  bonerville_05: lot05 as unknown as LotSpec,
  bonerville_06: lot06 as unknown as LotSpec,
};

type Play = { lot: string; flag: string[]; stamp: Verdict };

const ROUTE = ['bonerville_01','bonerville_02','bonerville_03','bonerville_04','bonerville_05','bonerville_06'];
const VIOLATIONS: Record<string, string[]> = {
  bonerville_01: ['weeds_1', 'weeds_2'],
  bonerville_03: ['weeds_1'],
  bonerville_05: ['weeds_1', 'weeds_2', 'weeds_3'],
};
/** Everything that looks citable today but is not in the binder. */
const TEMPTATIONS: Record<string, string[]> = {
  bonerville_02: ['bin_green'],
  bonerville_03: ['fence'],
  bonerville_04: ['fence'],
  bonerville_06: ['bin_green'],
};

const SCENARIOS: Array<{ name: string; note: string; plays: Play[] }> = [
  {
    name: 'Diligent',
    note: 'Reads the binder, cites every weed, leaves the bins and fences alone.',
    plays: ROUTE.map((lot) => ({
      lot,
      flag: VIOLATIONS[lot] ?? [],
      stamp: (VIOLATIONS[lot] ? 'FAIL' : 'PASS') as Verdict,
    })),
  },
  {
    name: 'Cites what looks wrong',
    note: 'Never opens the binder. Flags anything visibly bad — including the broken fences and the curbside bins, neither of which is a live rule on Day 1.',
    plays: ROUTE.map((lot) => {
      const flag = [...(VIOLATIONS[lot] ?? []), ...(TEMPTATIONS[lot] ?? [])];
      return { lot, flag, stamp: (flag.length ? 'FAIL' : 'PASS') as Verdict };
    }),
  },
  {
    name: 'Rubber stamp',
    note: 'Passes everything without looking. The fastest way to hit quota.',
    plays: ROUTE.map((lot) => ({ lot, flag: [], stamp: 'PASS' as Verdict })),
  },
];


for (const s of SCENARIOS) {
  console.log(`\n=== ${s.name} ===`);
  console.log(`    ${s.note}`);
  let strikes = 0;
  let right = 0;
  for (const p of s.plays) {
    const lot = LOTS[p.lot];
    const { objects } = renderLot(lot, { sprites: new Map() }, 1060, 860);
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
