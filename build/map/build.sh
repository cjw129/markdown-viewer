#!/bin/bash

# set current working directory to directory of the shell script
cd "$(dirname "$0")"

# before: download Natural Earth admin-0 countries (public domain), cached in ./tmp
mkdir -p tmp
if [ ! -f tmp/ne_10m_admin_0_countries.geojson ]; then
  curl -sSL -o tmp/ne_10m_admin_0_countries.geojson \
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
fi

# build: clip + simplify to a small offline basemap -> vendor/map-basemap.js
node basemap.js tmp/ne_10m_admin_0_countries.geojson ../../vendor/map-basemap.js
