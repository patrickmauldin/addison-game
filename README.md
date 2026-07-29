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
| `npm run simulate` | Headless Day 1 under three player behaviours. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run ingest` | Check `assets/houses/raw/*.png` is exportable, publish index. |

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

## Three-quarter scene

The camera looks down at the lot from the street. There is **no skew**: screen x
is world x, depth runs up the screen foreshortened, facades are face-on and
roofs are seen from above. Draw order is simply screen y.

Canvas is **440x640**, holding the reference image's 1254:1818 aspect so art
drops in unreframed, at 1:1 beside the 380px desk.

```
 y=0    grass — a background pattern, not a bounded lot
 HOUSE  sprite, centred, base on the house band (hatched placeholder until art lands)
        front yard · driveway · walk
 WALK   sidewalk band
 ROAD   road tile, bottom of frame
```

Anchors (`core/scene.ts`) are plain screen points. Drop art in
`assets/houses/raw/`, run `npm run ingest`, reload.

**Colour is no longer locked.** The 44-ramp palette was enforced per-pixel while
every layer was generated and had to agree with every other. Hand-authored art
carries its own colour — `grass.png` alone has 4,775 — so the lock was retired.
`core/palette.ts` survives as the vocabulary for the few things still generated
(the R-101 weed/bed pair, ground fallbacks) and for UI chrome.

**Consequence worth knowing:** R-308 (exterior paint vs the swatch card, Day 11)
used to be free — every pixel belonged to a known ramp, so repainting was a
lookup. That no longer works on multi-thousand-colour art. When Day 11 arrives
it needs either a paint variant per approved colour, or a 1-bit siding mask
beside each house sprite so a hue shift can be confined to it.

## Layout## Layout

```
src/core/       scene (bands + anchors), palette, rasteriser, PNG codec
src/gen/        ground — tiled grass, road band
src/scene-compositor  Draw order, generator dispatch, object-id registry
src/game/       Persistence + adjudication
src/data/       Day file, rules, streets, lot instances. All content lives here.
assets/         Logo (UI chrome, exempt) and house sprites (palette-enforced).
tools/          Headless render, validate, compare, simulate
```

## Contracts worth not breaking

**Code contains zero content.** Adding a house means adding JSON. Adding a
generator means one row in `GENERATORS` and nothing else.

**Every violation ships with a decoy.** If it has no near-miss it is a chore,
not a puzzle. `weed_patch` (4.8) and `native_bed` (4.9) are built and tuned as a
matched pair and must never be separated.

**Feedback is withheld.** You learn you were wrong at the end-of-day audit,
never at the moment you stamp.

## Known deviations from the manifest

- **The isometric projection is gone.** The manifest specifies 2:1 isometric
  throughout; the game is three-quarter with no skew. Tier 2's 14 house
  generators, the material shaders and the iso terrain kit were deleted with it.
- **The campaign is 2025, not 2026.** Every weekday in the gameplan's 20-day
  schedule (Mon Mar 3, Wed Mar 5, Fri Mar 7, Wed Mar 19 …) resolves to 2025. The
  2026 in the manifest's example day file does not match its own weekdays.
- **Houses are art, not generators.** A shell carries no gameplay state that
  varies at runtime and the camera never moves, so it is a backdrop.
- **Grass is summer green, but the campaign is March-April.** The manifest built
  a violation/decoy pair on dormant Bermuda being tan (dormant is even, dead is
  patchy) and assumed weeds read green against tan. Against green grass that
  read is weaker; R-101 may need a different tell, or a dormant tile variant.
- **UI is DOM, not Tier 8 generators.** Rendered binder pages and stamp ink
  impressions are deferred; this is enough to judge the flow.
