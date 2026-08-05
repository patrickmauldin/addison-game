# Addison — Lawn & Order

A pixel-art game about the Addison neighborhood: you are its HOA compliance
inspector, and the job is deciding what counts.

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
| `npm run simulate` | Headless Day 1 under three player behaviors. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run ingest` | Check `assets/houses/raw/*.png` is exportable, publish index. |
| `npm run map-houses` | Measure each house's art, regenerate `src/data/houses.json`. |
| `npm run pack-residents` | Composite `assets/char-pack/` layers into `assets/residents.png` + `src/data/residents.json`. |

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
HOUSE ......... centerd, its baked lawn blending into the tile
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
the ground*: sprites are bottom-centerd on them.

### Asset notes

| Asset | Native | Note |
|---|---|---|
| `grass.png` | 722×614 | Tiles horizontally; **vertical seam**, bands every 614px |
| `road.png` | 151×152 | Tiles both axes cleanly |
| `sidewalk.png` | 1150×108 | Strip, tiles x only; **horizontal seam** |
| `house1.jpg` | 1254×1254 | No alpha — relies on its baked lawn matching `grass.png`. It does, to within 1–2 channel values, so it blits opaque |
| `weed1-3.png` | ~160×100 | RGBA |
| `trash-green/brown.png` | 114×139 | RGBA |
| `residents.png` | 40×42 frames | Generated from `char-pack`. 10 characters × (4 move + 3 tools × 3 facings) = 130 rows. **4×** |

`npm run validate` measures tile seams and the house-lawn color match on every
run, so these do not have to be remembered.

### People

Lots with somebody out front draw one of ten residents, seeded from the lot id
so a given address always has the same person doing the same thing.

`assets/char-pack/` is a paper-doll set: base, hair, top, bottom and feet on
identical 384×1584 sheets (8×33 frames of 48×48). `npm run pack-residents`
composites ten outfits from it and packs the two animations we use. The cast is
an explicit table in `tools/pack-residents.ts`, not random draws — a street
should look deliberately populated, and an explicit list is reviewable when one
of them reads badly. Five skins, twenty hairs, twenty-eight tops and
twenty-eight bottoms recombine into far more than ten if more are wanted.

Frames run as one flat stream across the pack's grid. Verified against the
premade sheets rather than read off `guide.png` — the check that settles it is
that `walk_down[1]` and `idle_down[0]` hash identically, as do `walk_up[1]` and
`idle_up[0]`; they are the same neutral standing pose, which only holds if the
offsets are right:

    idle  0..7   — down 0-1, left 2-3, right 4-5, up 6-7
    walk  16..31 — down 16-19, left 20-23, right 24-27, up 28-31

Direction order there is down/left/right/up, which is already `Walker`'s own
`Dir` enum, so the sheet reuses its facing rather than re-deriving one. `Walker`
itself is steering only — it knows nothing about sheets, which is what let the
art be swapped out twice without touching how anybody moves.

**`RESIDENT_UPSCALE` is stated as a factor, not a target height.** The factor is
what governs how the art reads: at a whole number the sprite's pixel grid stays
square and aligned rather than some rows landing a pixel taller than others. 4×
on a 28px figure is 112 scene pixels, roughly 9% of the 1254px house.

Measuring the houses argues for ~157 (the art runs ~27px per foot; house1's
garage door is ~188px for a seven-foot opening), but that reads too large for
art this coarse. The height moved three times before settling, and the lesson is
that the right value depends on how dense the character art is and not only on
the houses: every extra pixel of height is more upscale, and more upscale is
what makes a character look blockier than the world it stands in.

### Yard tools

Some residents are out working. Rather than wandering they stand on the lawn
and use a tool, which is both what someone hoeing a bed actually does and why no
carry-walk was needed.

**They work in stretches, not continuously.** 5-11 seconds of work, then a 3-7
second breather standing idle, then back to it — and facing a different way when
they resume, never the same way twice running. Somebody who swings a hoe without
stopping from the moment you arrive reads as a looping sprite rather than a
person, and one unchanging facing gives the same away.

Facings are south, west and east. **Not north**: with their back turned the tool
spends most of the swing hidden behind them, so that block is not even packed.
The break shows the idle frames in the direction they were *already* facing, so a
pause reads as a pause and not as somebody else turning up.

Whether somebody is working, and with what, is decided by the **lot**, not the
character — being out with a watering can is a fact about this afternoon, not
about who you are. So every character is packed holding every tool, and rows run
at a fixed stride: `character * rowsPerCharacter + (direction | 4 + toolIndex)`.

**The pack has no shovel.** It ships a hoe, an axe, a pickaxe and a watering can.
`shovel` here is the **axe** animation — its head is a broad blade in line with
the shaft, unlike the pickaxe's two points, and the swing is a digging motion.
At 4× the head is a handful of pixels and reads as a spade. Swapping in real
shovel art is one entry in `TOOLS`.

Workers are kept **off the driveway**, using the same generated `DRIVEWAY_*`
anchor the compositor draws from (mirrored the same way), so they cannot drift
apart. Wanderers are left alone — crossing your own driveway is ordinary.

The frame had to grow from 16×28 to 40×42 to fit a swung hoe, which reaches
above the head and — once side facings were added — well out to either side. That is why the packer measures the
**person's** box separately from the full box and exports `centerX` and
`ground`: centring on the frame would shove everyone sideways to leave room for
a tool most of them are not carrying, and the watering can's puddle spreads
below the feet on purpose.

**Rebuild the resident on resize.** Their patch of lawn is derived from the
house rect, so a layout change invalidates it — and a walker left alone keeps
walking to coordinates from the old layout, which after a shrink is somewhere up
the roof.

### Passers-by

**Nobody on a lot looks like anybody else on it.** `pickCharacter` excludes
anyone already placed — the resident first, then each passer-by in turn. Two
identical strangers passing each other on the same pavement reads as a rendering
fault, not a coincidence.

**Skins 3, 4 and 5 carry the street.** Skins 1 and 2 are on two of the ten
characters and weighted down to **15% of appearances** between them
(`RARE_SKINS` / `RARE_SHARE` in the packer). It is a selection weight rather
than a cast cut for two reasons: dropping them would cost two characters' worth
of variety, and with ten characters the composition alone can only express
tenths — one is 10%, two is 20%, and neither is 15%. Measured over 200,000
draws: 14.93%.

That means the pick is **not uniform**, and anything sampling the cast directly
would quietly undo it. Go through `pickCharacter`.


Separate from the resident: 0-2 people on the **sidewalk**, drawn from the same
ten characters and the same walk rows, holding nothing. Tools belong to someone
working their own yard.

They cross one way and leave, and do **not** come back. A figure that turns
round at the frame edge reads as a bug even when it is deliberate, so the street
quietly empties while you inspect — which is also what a street does. Direction
follows from where they spawn (left half walks right, right half walks left) so
everybody crosses most of the frame instead of spawning a step from the edge
they were heading for and vanishing unseen.

Two consequences worth keeping:

- **The animation loop must run for traffic alone.** A lot can have an empty
  yard and still have somebody walking past it — `bonerville_06` is exactly
  that case. The loop also stops itself once the last one leaves and the yard is
  empty, rather than asking for frames forever.
- **On resize they are remapped, not respawned.** Rebuilding from the seed would
  march people who had already left back onto the screen. The resident *is*
  rebuilt, because their patch of lawn is derived from the house rect.

They draw after the resident and nearest-last among themselves: the sidewalk is
closer to the camera than the lawn, so anyone on it passes in front of whoever
is up in the yard.

### Barks

Residents and passers-by think out loud in a word bubble. `src/data/barks.json`
holds 210 authored lines; `game/barks.ts` picks and schedules, `game/bubble.ts`
draws. A thought holds 6s, then there is an 8-14s gap, and only ~55% of gaps
produce anything — silence is most of what the system outputs, which is what
keeps it from grating. Two thirds of residents and 60% of passers-by talk at all.

**The two speakers are reliable in opposite directions**, and that is the point:

- A **homeowner** leaks *truth* by accident. Lines tagged `tell` — "it's dormant,
  not dead", "the pod's leaving Thursday, it's been leaving Thursday for a
  month" — flag a decoy or a blown permit window, and are weighted ×2. Reading
  bubbles is a real edge on grace-period cases.
- A **passer-by** states *opinion* confidently and is sometimes flatly wrong.
  Lines tagged `wrong` are deliberately ungated, so "that needs mowing" fires on
  compliant lawns. A player who cites on social pressure instead of measuring
  takes the strike, which is the lesson the game is about.

`who` is `owner` / `passer` / `any`, and the exclusions are load-bearing: a
stranger cannot refer to their own fence or a citation against them, and a
homeowner standing in their own yard cannot be walking past it.

Gating facts come from real state — props on the lot (`weeds`, `bins`, `fence`,
`junk`, `vehicle`, `violation`), citation history from the save (`cited`,
`passed`), and the calendar (`hot`, `trashday`). Lines needing `shutters`,
`gnome`, `repainted` and friends are authored but **dormant**: that feature data
does not exist yet, and the source doc is explicit that cosmetic critique of a
feature that is not there reads as a bug.

No line repeats within a day — the used set is module-level, so hearing the same
joke from two people on one street cannot happen either.

**The bubble is drawn, not blitted.** `assets/word bubble.png` is 130×75 with
over 250 distinct colors — the outline reads as `1,1,1` and `0,1,0` and `2,4,6`
rather than one black, with semi-transparent gray along the edges. It was
resampled from something smaller and is not on a pixel grid, so nine-slicing it
would tile that mush into every bubble. `bubble.ts` reproduces its design in
three colors instead, which also handles what an image cannot: text length is
arbitrary so width *and* height vary, and the tail has to point at somebody who
could be standing anywhere. Sized in **screen** pixels, not scene pixels — same
reasoning as `x.png`, since text has a legibility floor a house does not.

Type is Pixelify Sans, vendored into `assets/fonts/` rather than linked from
Google so there is no runtime third-party dependency. It is also the UI heading
face; the fine print underneath stays monospace, because the display face breaks
up below about 13px.

### Parked cars

0-1 per house, seeded from the lot id, ~60% of driveways occupied. Injected in
`withParkedCar` as a **copy** of the lot spec rather than a mutation, so the
authored lot is what the case file, first-seen tracking and adjudication keep
seeing — the car is scenery and should not appear in any of them.

Anchored at `DRIVEWAY_2`, not `_1` or `_3`. An anchor marks where a prop meets
the ground and the sprite hangs UP the screen from it, so at `_1` (hy 0.70) even
the shortest car reaches the garage door and the longest parks inside the
garage. `_2` is the one every car in the set clears.

**`car1redbad` is deliberately excluded.** A rusted-out car with its rear window
gone is a violation under R-204, and a violation that appears at random cannot
be adjudicated — the lot's truth data does not know about it, so the player
would be marked wrong either way. It wants authoring into a lot the way weeds
and bins are. The barks are already waiting for it: `def-01`, `def-06` and
`def-10` gate on `vehicle` and are tagged as tells.

Mirroring is free — the driveway anchor reflects with the house plan, and the
car does not flip, which is correct for a loose object carrying a baked shadow.

### Props draw with people, not under them

The scene is composited once into an image for speed, so anything drawn
afterwards lands on top of it regardless of depth — which had residents strolling
over the tops of the bins. `renderLot` now returns `props: PlacedProp[]`, and
`drawWalker` merges people and props into one queue sorted by ground line.

A prop is restored by re-blitting its rect **from the finished scene canvas**,
which is idempotent for the background because that is the same image already on
screen. Verified lossless: 47,672 bytes across two bin rects, zero mismatches.
The rect is tight to the sprite's solid pixels — the full canvas rect would carry
the transparent padding with it and rub out anyone standing in it.

**Seat people by their ground line, not their frame bottom.** For this sheet the
two agree, because the crop was derived from the content — but the packer
reports the line anyway and `drawWalker` reads it, so the draw stays correct if
the crop ever gains padding underfoot.

The sheet carries no baked drop shadow — unlike the props, whose ~30%-alpha
shadows the compositor goes out of its way to preserve — so `drawWalker` paints
a 30% black ellipse at the contact point before the sprite. It is sized off
drawn height rather than frame width, since height is the dimension that means
"how tall this person is" whatever the frame pads around them.
(`char-pack/shadow.png` exists but is built for 16px tiles.)

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
