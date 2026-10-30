#!/bin/bash

# exit if any of the intermediate steps fail
set -e

browser=$1

if [ "$browser" != "chrome" ] && [ "$browser" != "firefox" ]; then
  echo "Specify target browser"
  echo "chrome, firefox"
  exit 1
fi

# set current working directory to directory of the shell script
cd "$(dirname "$0")"

# The TeaVM compiled PlantUML engine and the standard library bundles are
# taken from the plantuml-for-github extension, pinned to a commit.
# Chrome ships the engine as a single file and all the standard libraries,
# Firefox ships it in 4 chunks and only the bundles under the 5 MB per-file
# limit of AMO.
repo=${PLANTUML_REPO:-https://github.com/cjw129/plantuml-for-github.git}
ref=${PLANTUML_REF:-535d6e3dc0583d8c520a42fee7e6bc0e492ee3ac}

if [ "$browser" = "chrome" ]; then
  source=Chrome
else
  source=Firefox
fi

# before
rm -rf tmp
mkdir -p tmp
(
  cd tmp
  git init -q .
  git remote add origin "$repo"
  git fetch -q --depth 1 origin "$ref"
  git checkout -q FETCH_HEAD
)

# copy
target=../../vendor/plantuml
rm -rf $target
mkdir -p $target/vendor

# engine, Firefox also has the unsplit plantuml.js that is over the 5 MB limit
if [ "$browser" = "chrome" ]; then
  cp tmp/$source/vendor/plantuml.js $target/vendor/
else
  cp tmp/$source/vendor/plantuml.[0-3].js $target/vendor/
fi
# standard libraries and the files the engine loads next to renderer.html
cp tmp/$source/*.min.js $target/
cp tmp/$source/emoji.js tmp/$source/themes.js tmp/$source/openiconic.js $target/
# renderer
cp common.js $target/common.js
cp renderer.$browser.html $target/renderer.html
cp renderer.$browser.js $target/renderer.js

# after
rm -rf tmp/
