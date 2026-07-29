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

The camera looks down at the lot from the street. No skew: screen x is world x,
depth runs up the screen. **Full bleed** — the scene fills the stage, grass runs
to every edge, there is no frame. The canvas is sized to the window at runtime
and re-lays out on resize.

```
grass ......... to all four edges
HOUSE ......... centred, its baked lawn blending into the tile
grass ......... front yard, props anchored here
SIDEWALK ...... horizontal band
ROAD .......... horizontal band, bottom of frame
```

**Everything on screen is delivered art.** The only thing still generated is the
layout: where the bands fall and how far the house scales.

**One lawn, one scale.** `house1` carries its own lawn baked in, and the house is
scaled to fit the window — so the ground tiles draw at that same scale. Tiling
grass at 1:1 under a house drawn at 0.5 makes the tuft sizes disagree and the
house reads as a patch pasted onto a different lawn.

**House scale is snapped**, not continuous (1, ¾, ⅔, ½, ⅓, ¼). Arbitrary
fractional scaling of pixel art degrades it differently at every window size — a
tuft that survives at 0.62 turns to mush at 0.61, and the artist can never tell
what they are looking at. Fixed steps degrade the same way every time.

**Anchors are fractions of the house rect** (`core/scene.ts`), so props hold
their position relative to the house as it scales. They mark where a prop *meets
the ground*: sprites are bottom-centred on them.

### Asset notes

| Asset | Native | Note |
|---|---|---|
| `grass.png` | 722×614 | Tiles horizontally; **vertical seam**, bands every 614px |
| `road.png` | 151×152 | Tiles both axes cleanly |
| `sidewalk.png` | 1150×108 | Strip, tiles x only; **horizontal seam** |
| `house1.jpg` | 1254×1254 | No alpha — relies on its baked lawn matching `grass.png`. It does, to within 1–2 channel values, so it blits opaque |
| `weed1-3.png` | ~160×100 | RGBA |
| `trash-green/brown.png` | 114×139 | RGBA |

`npm run validate` measures tile seams and the house-lawn colour match on every
run, so these do not have to be remembered.

## Layout## Layout## Layout

```
src/core/       scene (bands + anchors), palette, rasteriser, PNG codec
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
