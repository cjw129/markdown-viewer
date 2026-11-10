#!/bin/bash

# exit if any of the intermediate steps fail
set -e

# set current working directory to directory of the shell script
cd "$(dirname "$0")"

# before: download Natural Earth admin-0 countries (public domain), cached in ./tmp
mkdir -p tmp
if [ ! -f tmp/ne_10m_admin_0_countries.geojson ]; then
  curl -sSL -o tmp/ne_10m_admin_0_countries.geojson \
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
fi

if [ ! -f tmp/ne_110m_admin_0_countries.geojson ]; then
  curl -sSL -o tmp/ne_110m_admin_0_countries.geojson     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
fi

for name in populated_places roads railroads; do
  if [ ! -f tmp/ne_10m_$name.geojson ]; then
    curl -sSL -o tmp/ne_10m_$name.geojson       https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_$name.geojson
  fi
done

# build: clip + simplify to a small offline basemap -> vendor/map-basemap.js
node basemap.js tmp/ne_10m_admin_0_countries.geojson ../../vendor/map-basemap.js \
  tmp/ne_10m_populated_places.geojson tmp/ne_10m_roads.geojson tmp/ne_10m_railroads.geojson \
  tmp/ne_110m_admin_0_countries.geojson
