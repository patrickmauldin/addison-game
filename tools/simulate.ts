/**
 * Headless playthrough of every level under three player behaviours.
 *
 * Verifies the mechanics without a browser: adjudication, the asymmetry
 * between false positives and false negatives, and whether the decoys actually
 * punish the player who pattern-matches on "thing in the yard that looks off".
 *
 * The route, the real violations and the temptations are all DERIVED from each
 * level's own truth block. They used to be hand-listed here, which meant the
 * simulation could quietly go on testing content that no longer existed.
 */

import { adjudicate, type Verdict } from '../src/game/state.js';
import { renderLot, type LotSpec } from '../src/scene-compositor.js';
import level1 from '../src/data/levels/level1.json';
import level2 from '../src/data/levels/level2.json';

type Truth = { violations?: { object: string }[]; decoys?: { object: string }[] };
type Lot = LotSpec & { lot_id: string; truth?: Truth };
type Level = { level_id: number; quota: number; pay_per_inspection: number; lots: Lot[] };

const LEVELS = [level1, level2] as unknown as Level[];

type Play = { lot: string; flag: string[]; stamp: Verdict };

function scenariosFor(level: Level) {
  const real = (l: Lot) => (l.truth?.violations ?? []).map((v) => v.object);
  const bait = (l: Lot) => (l.truth?.decoys ?? []).map((d) => d.object);
  return [
    {
      name: 'Diligent',
      note: 'Reads the binder, cites every real finding, leaves the decoys alone.',
      plays: level.lots.map((l) => ({
        lot: l.lot_id,
        flag: real(l),
        stamp: (real(l).length ? 'FAIL' : 'PASS') as Verdict,
      })),
    },
    {
      name: 'Cites what looks wrong',
      note: 'Never opens the binder. Flags anything that looks off, decoys included.',
      plays: level.lots.map((l) => {
        const flag = [...real(l), ...bait(l)];
        return { lot: l.lot_id, flag, stamp: (flag.length ? 'FAIL' : 'PASS') as Verdict };
      }),
    },
    {
      name: 'Rubber stamp',
      note: 'Passes everything without looking. The fastest way to hit quota.',
      plays: level.lots.map((l) => ({ lot: l.lot_id, flag: [], stamp: 'PASS' as Verdict })),
    },
  ];
}

for (const level of LEVELS) {
const LOTS: Record<string, Lot> = Object.fromEntries(level.lots.map((l) => [l.lot_id, l]));
console.log(`\n######## LEVEL ${level.level_id} ########`);
for (const s of scenariosFor(level)) {
  console.log(`\n=== ${s.name} ===`);
  console.log(`    ${s.note}`);
  let strikes = 0;
  let right = 0;
  for (const p of s.plays) {
    const lot = LOTS[p.lot];
    const { objects } = renderLot(lot, { sprites: new Map() }, 1060, 860);
    const labels = new Map(objects.map((o) => [o.id, o.label]));
    const o = adjudicate(lot, labels, new Set(p.flag), p.stamp, level.pay_per_inspection);
    if (o.strike) strikes++;
    if (o.verdictRight && !o.falsePositives.length) right++;
    console.log(`  ${o.address}  stamped ${o.stamped}, correct ${o.expected}`);
    for (const h of o.hits) console.log(`     upheld        ${h.label}`);
    for (const m of o.missed) console.log(`     AUDIT FINDING ${m.label} — missed ${m.article}`);
    for (const f of o.falsePositives) console.log(`     APPEAL WON    ${f.label} — association pays costs`);
    if (o.strike) console.log(`     >> STRIKE`);
  }
  const pay = s.plays.length * level.pay_per_inspection;
  console.log(
    `  --> $${pay} · ${strikes} strike(s) · ${right}/${s.plays.length} clean ` +
      `· quota ${s.plays.length}/${level.quota}`,
  );
}
}
console.log('');
