// Builds a small offline basemap (country polygons around Iberia) from Natural Earth data.
// usage: node basemap.js <ne_10m_admin_0_countries.geojson> <out.js> [places.geojson roads.geojson railroads.geojson]
var fs = require('fs')

var BBOX = [-12, 33.5, 8.5, 47] // west, south, east, north
var TOLERANCE = 0.006           // degrees, Douglas-Peucker
var LINE_TOLERANCE = 0.012      // degrees, roads and railroads
var ROADS = ['Major Highway', 'Secondary Highway']
var COUNTRIES = {
  ESP: ['ES', '스페인'],
  PRT: ['PT', '포르투갈'],
  FRA: ['FR', '프랑스'],
  MAR: ['MA', '모로코'],
  DZA: ['DZ', '알제리'],
  AND: ['AD', '안도라'],
}
// label position [lng, lat] for country names
var LABELS = {ES: [-3.6, 40.1], PT: [-7.9, 39.9], FR: [2.6, 45.6], MA: [-5.2, 34.2], DZ: [3.5, 34.4]}

// Sutherland-Hodgman clip of a ring against the bbox rectangle
function clip (ring) {
  var edges = [
    (p) => p[0] >= BBOX[0], (p) => p[0] <= BBOX[2],
    (p) => p[1] >= BBOX[1], (p) => p[1] <= BBOX[3],
  ]
  var inter = [
    (a, b) => [BBOX[0], a[1] + (b[1] - a[1]) * (BBOX[0] - a[0]) / (b[0] - a[0])],
    (a, b) => [BBOX[2], a[1] + (b[1] - a[1]) * (BBOX[2] - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (BBOX[1] - a[1]) / (b[1] - a[1]), BBOX[1]],
    (a, b) => [a[0] + (b[0] - a[0]) * (BBOX[3] - a[1]) / (b[1] - a[1]), BBOX[3]],
  ]
  var out = ring
  for (var i = 0; i < 4 && out.length; i++) {
    var input = out
    out = []
    for (var j = 0; j < input.length; j++) {
      var cur = input[j], prev = input[(j + input.length - 1) % input.length]
      if (edges[i](cur)) {
        if (!edges[i](prev)) out.push(inter[i](prev, cur))
        out.push(cur)
      }
      else if (edges[i](prev)) out.push(inter[i](prev, cur))
    }
  }
  return out
}

function simplify (pts, tol) {
  if (pts.length < 3) return pts
  var sq = tol * tol
  var keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  var stack = [[0, pts.length - 1]]
  while (stack.length) {
    var [a, b] = stack.pop()
    var max = 0, idx = -1
    for (var i = a + 1; i < b; i++) {
      var d = segDist2(pts[i], pts[a], pts[b])
      if (d > max) { max = d; idx = i }
    }
    if (max > sq) { keep[idx] = true; stack.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

function segDist2 (p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1]
  var t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0
  t = Math.max(0, Math.min(1, t))
  var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]
  return x * x + y * y
}

var geo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
var countries = []
geo.features.forEach((f) => {
  var code = f.properties.ADM0_A3 || f.properties.ISO_A3
  if (!COUNTRIES[code]) return
  var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  var rings = []
  polys.forEach((poly) => {
    // outer ring only: islands and lakes are not needed at this scale
    var ring = clip(poly[0].map((p) => [p[0], p[1]]))
    if (ring.length < 4) return
    ring = simplify(ring, TOLERANCE)
    if (ring.length < 4) return
    rings.push(ring.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]))
  })
  if (rings.length) countries.push({id: COUNTRIES[code][0], name: COUNTRIES[code][1], rings})
})

var round = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]
var inside = (p) => p[0] >= BBOX[0] && p[0] <= BBOX[2] && p[1] >= BBOX[1] && p[1] <= BBOX[3]

// keep the runs of a line that are inside the bbox
function lines (geometry) {
  var parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
  var out = []
  parts.forEach((part) => {
    var run = []
    var flush = () => {
      if (run.length > 1) {
        var simple = simplify(run, LINE_TOLERANCE)
        if (simple.length > 1) out.push(simple.map(round))
      }
      run = []
    }
    part.forEach((p) => inside(p) ? run.push([p[0], p[1]]) : flush())
    flush()
  })
  return out
}

function read (file, filter) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')).features.filter(filter) : []
}

var places = read(process.argv[4], (f) => inside(f.geometry.coordinates))
  .sort((a, b) => b.properties.POP_MAX - a.properties.POP_MAX)
  .map((f) => ({
    n: f.properties.NAME_KO || f.properties.NAME,
    at: round(f.geometry.coordinates),
    p: f.properties.POP_MAX,
    c: f.properties.ADM0CAP ? 1 : 0,
  }))
var roads = read(process.argv[5], (f) => ROADS.includes(f.properties.type))
  .flatMap((f) => lines(f.geometry))
var rails = read(process.argv[6], () => true)
  .flatMap((f) => lines(f.geometry))

var data = {
  attribution: 'Map data: Natural Earth (public domain)',
  bbox: BBOX,
  labels: Object.keys(LABELS).map((id) => ({
    id, name: COUNTRIES[Object.keys(COUNTRIES).find((c) => COUNTRIES[c][0] === id)][1], at: LABELS[id]
  })),
  countries,
  places,
  roads,
  rails,
}
fs.writeFileSync(process.argv[3], 'var MAP_BASE = ' + JSON.stringify(data) + '\n')
console.log('places', places.length, 'roads', roads.length, 'rails', rails.length)
console.log('map-basemap.js', fs.statSync(process.argv[3]).size, 'bytes,',
  countries.map((c) => c.id + ':' + c.rings.reduce((n, r) => n + r.length, 0)).join(' '))
