# ADDISON — Compliance Inspector

Vertical slice: **Day 1, Bonerville.** Two lots, one rule (R-101), binary PASS/FAIL.

Everything on screen is generated from data. There are no image assets in this repo.

## Run it

```bash
npm run build && npm run serve
```

Then open <http://localhost:8123>. `npm run watch` rebuilds on change.

## Tools

| Command | What it does |
|---|---|
| `npm run validate` | Content validator (gameplan §11). Non-zero exit on failure. |
| `npm run render` | Writes `out/<lot>.png` and `@2x`, plus a click-target report. |
| `npm run compare` | Writes `out/r101-pair.png` — the weed patch and the decoy side by side. |
| `npm run simulate` | Headless Day 1 under three player behaviours. |
| `npm run typecheck` | `tsc --noEmit`. |

## Layout

```
src/core/       Tier 0 — palette (locked), projection, rasteriser, iso solids
src/gen/        Tiers 1-6 — terrain, house kit, materials, site, vegetation, props
src/compositor  Layer stack, anchors, generator dispatch, object-id registry
src/game/       Persistence + adjudication
src/data/       Day file, rules, lot instances. All content lives here.
tools/          Headless render, validate, compare, simulate
```

## Contracts worth not breaking

**Tier 0 is a contract, not assets.** `UNIT` = 2.5 ft; `UW/UH/UZ` = 20/10/16 px;
2:1 isometric; sun fixed upper-left at 45°. Nothing renders a colour outside
`PALETTE`. The validator enforces the colour rule per-pixel — including shadows,
which step down a ramp rather than multiplying (see `palette.darken`).

**Code contains zero content.** Adding a house means adding JSON. Adding a
generator means one row in `GENERATORS` and nothing else.

**Every violation ships with a decoy.** If it has no near-miss it is a chore,
not a puzzle. `weed_patch` (4.8) and `native_bed` (4.9) are built and tuned as a
matched pair and must never be separated.

**Feedback is withheld.** You learn you were wrong at the end-of-day audit,
never at the moment you stamp.

## Known deviations from the manifest

- **Lot depth is 28 units, not 26.** The manifest header says 26 but its own
  band table sums to 28. The band table wins; it also makes the lot diamond
  exactly fill the 480px canvas width.
- **The campaign is 2025, not 2026.** Every weekday in the gameplan's 20-day
  schedule (Mon Mar 3, Wed Mar 5, Fri Mar 7, Wed Mar 19 …) resolves to 2025. The
  2026 in the manifest's example day file does not match its own weekdays.
- **Deferred from Tier 2**: hip roofs (2.5), roof intersections (2.6), dormers
  (2.7), the portico arch (2.8), chimneys (2.13). Per the manifest's build
  order, stop and evaluate after massing/walls/band/gable.
- **`rear_treeline` is not in the manifest.** Added for the same reason as 1.9
  neighbour slabs: an unbroken lawn running to the top of the frame reads as a
  golf course rather than a subdivision.
- **UI is DOM, not Tier 8 generators.** Rendered binder pages and stamp ink
  impressions are deferred; this is enough to judge the flow.
