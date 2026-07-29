#!/bin/sh
# Bundle to dist/bundle.js. No dev server needed — index.html loads it directly.
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/bundle.js --loader:.json=json "$@"
