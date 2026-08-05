#!/bin/sh
# Assemble the deployable site into _site/.
#
# The repo carries both the GAME and the material it was built from — 40MB of
# paper-doll layers that pack-residents.ts already baked into residents.png, a
# folder of per-frame animal exports that pack-animals.ts baked into
# animals.png, layered reference art, and a couple of things kept for later.
# None of it is fetched at runtime, and all of it would be downloaded by anyone
# who opened the site.
#
# So the deploy is assembled rather than served from the working tree. What goes
# in is decided here, in one place, and the exclusions are listed with the
# reason each one is safe.
#
#   sh tools/site.sh            -> _site/
#   sh tools/site.sh some/dir   -> some/dir/
set -eu

OUT="${1:-_site}"
cd "$(dirname "$0")/.."

rm -rf "$OUT"
mkdir -p "$OUT/dist"

echo "building the bundle"
./build.sh --minify

cp index.html "$OUT/"
cp dist/bundle.js "$OUT/dist/"

# GitHub Pages runs Jekyll over a site unless told not to, and Jekyll SKIPS
# files and folders beginning with an underscore. Nothing here starts with one
# today, but the failure mode is a silent 404 on one asset rather than an error,
# which is not a thing to leave to chance.
: > "$OUT/.nojekyll"

echo "copying assets"
rsync -a --exclude-from=tools/site-exclude.txt assets/ "$OUT/assets/"

# assets/animals/ is excluded wholesale above — it is ~1400 per-frame exports
# that pack-animals.ts has already flattened into animals.png. But THREE frames
# out of it are fetched directly: a notice shows the photograph of what it is
# looking for, and those come out of the delivered folders rather than being
# copied to the top level (see ASSET_FILES and the bounty `sprite` fields).
#
# Read out of the source rather than listed, so a fourth notice cannot ship with
# a blank where the photograph goes.
KEEP=$(grep -rhoE "animals/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/rotations/[a-z-]+" src/ | sort -u)
for f in $KEEP; do
  [ -f "assets/$f.png" ] || { echo "site: assets/$f.png is referenced and missing" >&2; exit 1; }
  ( cd assets && rsync -aR "./$f.png" "../$OUT/assets/" )
done

# EVERY STATIC PATH THE CODE NAMES HAS TO BE IN THE BUILD.
#
# An over-broad exclude does not fail — it produces a site that loads and is
# quietly missing one thing, which is how a bare `addison-letterhead1.png`
# pattern took the seal off the waiver while the game carried on working. So
# the exclusions are checked against the references rather than trusted, and a
# deploy that has dropped something the code asks for stops here.
echo "checking every referenced asset is present"
MISSING=0
for ref in $(grep -rhoE "assets/[A-Za-z0-9_/.-]+\.(png|jpg|svg|mp3|wav|ttf)" src/ index.html | sort -u); do
  [ -f "$ref" ] || continue          # only in a comment; not a real reference
  [ -f "$OUT/$ref" ] || { echo "  MISSING  $ref" >&2; MISSING=$((MISSING + 1)); }
done
[ "$MISSING" -eq 0 ] || { echo "site: $MISSING referenced asset(s) excluded from the build" >&2; exit 1; }

echo
echo "  $OUT/  $(du -sh "$OUT" | cut -f1)  ·  $(find "$OUT" -type f | wc -l | tr -d ' ') files"
echo "  serve it with:  sh tools/site.sh && (cd $OUT && python3 -m http.server 8124)"
