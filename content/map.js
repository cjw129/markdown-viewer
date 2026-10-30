
// Renders ```geojson fenced code blocks as offline SVG maps.
// - basemap: country polygons bundled in /vendor/map-basemap.js (Natural Earth, public domain), no network requests
// - features: GeoJSON Point / LineString / Polygon (+ Multi*) with GitHub-style simplestyle properties:
//   title, description, marker-color, marker-size, marker-symbol, stroke, stroke-width, stroke-opacity,
//   stroke-dasharray (extension), fill, fill-opacity
var gmap = (() => {
  var W = 900

  var palette = {
    light: {sea: '#dbe8f3', land: '#f3efe6', border: '#b9b2a2', label: '#7b7568', text: '#2b2b2b', halo: '#ffffff', marker: '#e8590c'},
    dark: {sea: '#18222d', land: '#2a3240', border: '#4b5565', label: '#9aa5b5', text: '#e8edf3', halo: '#10161d', marker: '#ff922b'},
  }

  var dark = () =>
    state._themes[state.theme] === 'dark' ||
    (state._themes[state.theme] === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  var walk = (regex, string, result = [], match = regex.exec(string)) =>
    !match ? result : walk(regex, string, result.concat(match[1]))

  var unescape = (html) => {
    var area = document.createElement('textarea')
    area.innerHTML = html
    return area.value
  }

  var esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))

  // web mercator (unit: radians of longitude)
  var mx = (lng) => lng * Math.PI / 180
  var my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))

  var features = (json) => {
    if (json.type === 'FeatureCollection') return json.features || []
    if (json.type === 'Feature') return [json]
    if (json.type && json.coordinates) return [{type: 'Feature', geometry: json, properties: {}}]
    if (json.type === 'GeometryCollection') return (json.geometries || []).map((g) => ({type: 'Feature', geometry: g, properties: {}}))
    throw new Error('Unsupported GeoJSON type: ' + json.type)
  }

  var points = (geometry) => {
    var out = []
    var add = (c) => {
      if (typeof c[0] === 'number') out.push(c)
      else c.forEach(add)
    }
    if (geometry && geometry.coordinates) add(geometry.coordinates)
    return out
  }

  var bounds = (feats) => {
    var all = feats.flatMap((f) => points(f.geometry))
    if (!all.length) throw new Error('No coordinates found')
    var b = {w: 180, e: -180, s: 90, n: -90}
    all.forEach(([lng, lat]) => {
      b.w = Math.min(b.w, lng); b.e = Math.max(b.e, lng)
      b.s = Math.min(b.s, lat); b.n = Math.max(b.n, lat)
    })
    return b
  }

  var fit = (b) => {
    // keep some context around small extents, then pad
    var minLng = 5
    if (b.e - b.w < minLng) { var c = (b.e + b.w) / 2; b.w = c - minLng / 2; b.e = c + minLng / 2 }
    var minLat = 3
    if (b.n - b.s < minLat) { var d = (b.n + b.s) / 2; b.s = d - minLat / 2; b.n = d + minLat / 2 }
    var padX = (mx(b.e) - mx(b.w)) * 0.14
    var padY = (my(b.n) - my(b.s)) * 0.12
    var x0 = mx(b.w) - padX, x1 = mx(b.e) + padX
    var y0 = my(b.s) - padY, y1 = my(b.n) + padY
    var scale = W / (x1 - x0)
    var H = Math.round(Math.min(Math.max((y1 - y0) * scale, 320), 760))
    // center vertically when the height was clamped
    var yMid = (y0 + y1) / 2
    var hY = H / scale
    return {scale, W, H, x0, y1: yMid + hY / 2}
  }

  var project = (view) => ([lng, lat]) => [
    Math.round((mx(lng) - view.x0) * view.scale * 10) / 10,
    Math.round((view.y1 - my(lat)) * view.scale * 10) / 10,
  ]

  var path = (rings, proj, closed) =>
    rings.map((ring) => 'M' + ring.map(proj).map((p) => p.join(' ')).join('L') + (closed ? 'Z' : '')).join('')

  var radius = {small: 4.5, medium: 9, large: 13}

  var label = (box, placed, view) => {
    // greedy placement: right, left, above, below
    var spots = [
      {dx: box.r + 4, dy: 4, anchor: 'start'},
      {dx: -(box.r + 4), dy: 4, anchor: 'end'},
      {dx: 0, dy: -(box.r + 5), anchor: 'middle'},
      {dx: 0, dy: box.r + 15, anchor: 'middle'},
    ]
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i]
      var x = box.x + s.dx
      var left = s.anchor === 'start' ? x : s.anchor === 'end' ? x - box.w : x - box.w / 2
      var rect = {x: left, y: box.y + s.dy - 12, w: box.w, h: 15}
      var hit = placed.some((p) => rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y)
      var inside = rect.x >= 4 && rect.x + rect.w <= view.W - 4 && rect.y >= 2 && rect.y + rect.h <= view.H - 2
      if ((!hit && inside) || i === spots.length - 1) {
        placed.push(rect)
        return {x, y: box.y + s.dy, anchor: s.anchor}
      }
    }
  }

  var svg = (json) => {
    var colors = palette[dark() ? 'dark' : 'light']
    var feats = features(json)
    var view = fit(bounds(feats))
    var proj = project(view)
    var base = typeof MAP_BASE !== 'undefined' ? MAP_BASE : {countries: [], labels: []}

    var out = []
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.W} ${view.H}" class="gmap-svg" role="img">`)
    out.push(`<rect width="${view.W}" height="${view.H}" fill="${colors.sea}"/>`)

    base.countries.forEach((country) => {
      out.push(`<path d="${path(country.rings, proj, true)}" fill="${colors.land}" stroke="${colors.border}" stroke-width="1" stroke-linejoin="round"><title>${esc(country.name)}</title></path>`)
    })
    base.labels.forEach((l) => {
      var [x, y] = proj(l.at)
      if (x > 20 && x < view.W - 20 && y > 20 && y < view.H - 20) {
        out.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="15" fill="${colors.label}" opacity=".75" letter-spacing="2">${esc(l.name)}</text>`)
      }
    })

    var polys = [], lines = [], pins = []
    feats.forEach((f) => {
      var g = f.geometry
      if (!g) return
      if (/Polygon/.test(g.type)) polys.push(f)
      else if (/LineString/.test(g.type)) lines.push(f)
      else if (/Point/.test(g.type)) pins.push(f)
    })

    polys.forEach((f) => {
      var p = f.properties || {}
      var rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat()
      out.push(`<path d="${path(rings, proj, true)}" fill="${esc(p.fill || '#555555')}" fill-opacity="${p['fill-opacity'] || 0.3}" stroke="${esc(p.stroke || '#555555')}" stroke-width="${p['stroke-width'] || 2}" stroke-opacity="${p['stroke-opacity'] || 1}">${p.title ? `<title>${esc(p.title)}</title>` : ''}</path>`)
    })

    lines.forEach((f) => {
      var p = f.properties || {}
      var parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
      var tip = [p.title, p.description].filter(Boolean).map(esc).join(' - ')
      out.push(`<path d="${path(parts, proj, false)}" fill="none" stroke="${esc(p.stroke || '#555555')}" stroke-width="${p['stroke-width'] || 2}" stroke-opacity="${p['stroke-opacity'] || 1}"${p['stroke-dasharray'] ? ` stroke-dasharray="${esc(p['stroke-dasharray'])}"` : ''} stroke-linecap="round" stroke-linejoin="round">${tip ? `<title>${tip}</title>` : ''}</path>`)
      // wide invisible stroke makes thin lines easy to hover
      out.push(`<path d="${path(parts, proj, false)}" fill="none" stroke="transparent" stroke-width="12">${tip ? `<title>${tip}</title>` : ''}</path>`)
    })

    var placed = []
    // draw larger markers last so numbered stops stay on top of small ones
    pins.sort((a, b) => (radius[(a.properties || {})['marker-size']] || 9) - (radius[(b.properties || {})['marker-size']] || 9))
    var texts = []
    pins.forEach((f) => {
      var p = f.properties || {}
      var coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates
      coords.forEach((c) => {
        var [x, y] = proj(c)
        var r = radius[p['marker-size']] || 9
        var color = p['marker-color'] || colors.marker
        var symbol = p['marker-symbol'] !== undefined ? String(p['marker-symbol']) : ''
        var tip = [p.title, p.description].filter(Boolean).map(esc).join(' - ')
        out.push(`<g class="gmap-pin"><circle cx="${x}" cy="${y}" r="${r}" fill="${esc(color)}" stroke="#fff" stroke-width="${r > 6 ? 2 : 1.5}">${tip ? `<title>${tip}</title>` : ''}</circle>${symbol && r > 6 && symbol.length <= 2 ? `<text x="${x}" y="${y + 4.2}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" pointer-events="none">${esc(symbol)}</text>` : ''}</g>`)
        if (p.title) {
          var text = String(p.title)
          var small = r <= 6
          var size = small ? 11 : 13
          var w = [...text].reduce((n, ch) => n + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? size : size * 0.58), 0)
          texts.push({x, y, r, w, text, small, size})
        }
      })
    })
    // label the numbered stops first so small markers do not push them around
    texts.sort((a, b) => a.small - b.small).forEach((t) => {
      var spot = label({x: t.x, y: t.y, r: t.r, w: t.w}, placed, view)
      out.push(`<text x="${spot.x}" y="${spot.y}" text-anchor="${spot.anchor}" font-size="${t.size}" ${t.small ? '' : 'font-weight="600"'} fill="${colors.text}" stroke="${colors.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round" pointer-events="none">${esc(t.text)}</text>`)
    })

    out.push(`<text x="${view.W - 8}" y="${view.H - 8}" text-anchor="end" font-size="10" fill="${colors.label}" opacity=".8">${esc(base.attribution || '')}</text>`)
    out.push('</svg>')
    return out.join('')
  }

  return {
    render: () => {
      var definitions = walk(/<pre><code class="geojson">([\s\S]+?)<\/code><\/pre>/gi, state.html)

      Array.from(document.querySelectorAll('pre code.geojson')).forEach((block, index) => {
        var pre = block.parentElement
        pre.classList.add('geojson-map')
        var panzoomed = block._panzoom
        if (panzoomed) { panzoomed.destroy(); block._panzoom = null }
        try {
          block.innerHTML = '<div class="gmap-view">' + svg(JSON.parse(unescape(definitions[index]))) + '</div>' +
            '<div class="gmap-hint">Shift + wheel to zoom, drag to pan, double click to reset</div>'
        }
        catch (err) {
          block.innerHTML = '<div class="gmap-error">GeoJSON error: ' + esc(err.message) + '</div>' + '<pre>' + definitions[index] + '</pre>'
          return
        }
        var view = block.querySelector('.gmap-view')
        var map = view.querySelector('svg')
        var panzoom = Panzoom(map, {canvas: true, maxScale: 12})
        block._panzoom = panzoom
        view.addEventListener('wheel', (e) => {
          if (!e.shiftKey) return
          panzoom.zoomWithWheel(e)
        })
        view.addEventListener('dblclick', () => panzoom.reset())
      })
    }
  }
})()
