# Addison — Lawn & Order

Vertical slice: **Day 1, Bonerville.** Two lots, one rule (R-101), binary PASS/FAIL.

Everything inside the lot viewport is generated from data — there are no image
assets in the render path. The only bitmap in the project is the title logo,
which is UI chrome and never enters the compositor.

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

## The logo

The title screen loads `assets/addison-logo.png`. If that file is missing the
title falls back to a type-set treatment, so a missing logo never breaks the
build — see `assets/README.md`.

## Streets

The nine streets live in `src/data/streets.json`. Character drives the
difficulty ramp and Act III's flood geography, so every street carries one:

| Street | Was | Character |
|---|---|---|
| Bonerville | Bonerville | Outer loop, original phase. **Backs onto the creek — Act III flood street.** |
| Llama Alta | Llama Alta | Smallest homes, tightest lots. Most friction. |
| Dimelest | Dimelest | Interior. Baseline. |
| Eyezeta | Eyezetta | Interior, south of Dimelest. Baseline; pairs with Dimelest on Day 3. |
| Karaoke | Karaoke | North-south spine. Through-traffic, board members watch it. |
| Bananalise | Bananalise | Southern arterial. Runs the full width and exits east. |
| Zingersoll | Zingersoll | Newest phase, east side. **Top of the block also reaches the creek.** |
| Goodish | Goodish | Newest phase, east side. |
| Whistling Sparrow | Whistling Sparrow | **Unassigned** — not on the map extract on hand. |

Characters are read off the real Addison street map, not inherited from the
gameplan's section 7 list (which omits Bananalise and Whistling Sparrow). Two
consequences: Bananalise is an arterial rather than an interior street, and the
creek frontage belongs to Bonerville and Zingersoll, so Act III needs no
separate greenbelt street.

**Open:** Whistling Sparrow has no character yet — Whistling Sparrow is not on the
map extract on hand, so its phase and position are unset rather than invented.

## Layout

```
src/core/       Tier 0 — palette (locked), projection, rasteriser, iso solids
src/gen/        Tiers 1-6 — terrain, house kit, materials, site, vegetation, props
src/compositor  Layer stack, anchors, generator dispatch, object-id registry
src/game/       Persistence + adjudication
src/data/       Day file, rules, streets, lot instances. All content lives here.
assets/         Hand-authored art (logo). Exempt from the palette lock.
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
