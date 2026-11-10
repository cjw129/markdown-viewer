#!/bin/bash

# exit if any of the intermediate steps fail
set -e

# set current working directory to directory of the shell script
cd "$(dirname "$0")"

# before
npm ci 2> /dev/null || npm i
mkdir -p tmp

# mdc.min.js
npx rollup --config rollup.mjs --input mdc.mjs --file tmp/mdc.js
npx terser --compress --mangle -- tmp/mdc.js > tmp/mdc.min.js

# mdc.min.css
# Dart Sass (pure JavaScript), node-sass compiles libsass for every new Node
# release and is no longer supported. MDC 0.37 is written with @import, which
# Sass deprecates: silenced here, the pinned version keeps it working.
npx sass --load-path=node_modules --no-source-map --quiet-deps --silence-deprecation=import mdc.scss tmp/mdc.css
npx csso --input tmp/mdc.css --output tmp/mdc.min.css

# copy
cp tmp/mdc.min.* ../../vendor/

# after
rm -rf node_modules/ tmp/
