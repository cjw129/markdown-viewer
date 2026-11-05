
// Renders ```geojson fenced code blocks as offline SVG maps.
// - basemap: countries, main roads, railroads and cities bundled in /vendor/map-basemap.js (Natural Earth, public domain), no network requests
// - tiles: optional online raster tiles (Esri World Street Map, World Dark Gray for the dark themes), see state.maps.source: offline | online | both
//   (both: the offline basemap, tiles take over when zoomed in)
// - features: GeoJSON Point / LineString / Polygon (+ Multi*) with GitHub-style simplestyle properties:
//   title, description, marker-color, marker-size, marker-symbol, stroke, stroke-width, stroke-opacity,
//   stroke-dasharray (extension), fill, fill-opacity
var gmap = (() => {
  var W = 900
  var clips = 0

  var palette = {
    light: {sea: '#dbe8f3', land: '#f3efe6', border: '#b9b2a2', label: '#7b7568', text: '#2b2b2b', halo: '#ffffff', marker: '#e8590c', road: '#e0a458', rail: '#8d8778', city: '#5c564a'},
    dark: {sea: '#18222d', land: '#2a3240', border: '#4b5565', label: '#9aa5b5', text: '#e8edf3', halo: '#10161d', marker: '#ff922b', road: '#a4793a', rail: '#7b8596', city: '#c5cdd8'},
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
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.W} ${view.H}" class="gmap-svg" role="img" data-w="${view.W}" data-h="${view.H}" data-x0="${view.x0}" data-y1="${view.y1}" data-scale="${view.scale}" data-dark="${dark() ? 1 : 0}" data-attribution="${esc(base.attribution || '')}">`)
    out.push(`<rect width="${view.W}" height="${view.H}" fill="${colors.sea}"/>`)

    // low resolution world below the detailed area, the bbox is cut out so the borders do not double
    if ((base.world || []).length) {
      var box = base.bbox ? [proj([base.bbox[0], base.bbox[3]]), proj([base.bbox[2], base.bbox[1]])] : null
      var cid = 'gmap-world-' + (clips++)
      var cut = box ? `M${box[0][0]} ${box[0][1]}H${box[1][0]}V${box[1][1]}H${box[0][0]}Z` : ''
      out.push(`<clipPath id="${cid}"><path clip-rule="evenodd" d="M-1e6 -1e6H1e6V1e6H-1e6Z${cut}"/></clipPath><g clip-path="url(#${cid})">`)
      base.world.forEach((country) => {
        out.push(`<path class="gmap-stroke" data-sw="0.8" d="${path(country.rings, proj, true)}" fill="${colors.land}" stroke="${colors.border}" stroke-width="0.8" stroke-linejoin="round"><title>${esc(country.name)}</title></path>`)
      })
      out.push('</g>')
    }
    base.countries.forEach((country) => {
      out.push(`<path class="gmap-stroke" data-sw="1" d="${path(country.rings, proj, true)}" fill="${colors.land}" stroke="${colors.border}" stroke-width="1" stroke-linejoin="round"><title>${esc(country.name)}</title></path>`)
    })
    var strokes = (list, color, width, dash) => list.forEach((line) => {
      out.push(`<path class="gmap-stroke" data-sw="${width}" d="${path([line], proj, false)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`)
    })
    strokes(base.rails || [], colors.rail, 0.8, '4 3')
    strokes(base.roads || [], colors.road, 1.1)
    base.labels.forEach((l) => {
      var [x, y] = proj(l.at)
      if (x > 20 && x < view.W - 20 && y > 20 && y < view.H - 20) {
        out.push(`<text class="gmap-fixed" data-ax="${x}" data-ay="${y}" x="${x}" y="${y}" text-anchor="middle" font-size="15" fill="${colors.label}" opacity=".75" letter-spacing="2">${esc(l.name)}</text>`)
      }
    })

    // cities are shown or hidden depending on the zoom, see adapt()
    ;(base.places || []).forEach((c) => {
      var [x, y] = proj(c.at)
      if (x < 4 || x > view.W - 4 || y < 4 || y > view.H - 4) return
      var w = [...c.n].reduce((n, ch) => n + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? 11 : 6.4), 0)
      out.push(`<g class="gmap-city gmap-fixed" data-ax="${x}" data-ay="${y}" data-w="${Math.ceil(w) + 8}"><circle cx="${x}" cy="${y}" r="${c.c ? 3.2 : 2.4}" fill="${colors.city}" stroke="${colors.halo}" stroke-width="1"/><text x="${x + 5}" y="${y + 4}" font-size="${c.c ? 12 : 11}" ${c.c ? 'font-weight="600"' : ''} fill="${colors.text}" stroke="${colors.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round" pointer-events="none">${esc(c.n)}</text></g>`)
    })
    // online tiles go here, below the features
    out.push('<g class="gmap-tiles" pointer-events="none"></g>')

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
      out.push(`<path class="gmap-stroke" data-sw="${p['stroke-width'] || 2}" d="${path(rings, proj, true)}" fill="${esc(p.fill || '#555555')}" fill-opacity="${p['fill-opacity'] || 0.3}" stroke="${esc(p.stroke || '#555555')}" stroke-width="${p['stroke-width'] || 2}" stroke-opacity="${p['stroke-opacity'] || 1}">${p.title ? `<title>${esc(p.title)}</title>` : ''}</path>`)
    })

    lines.forEach((f) => {
      var p = f.properties || {}
      var parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
      var tip = [p.title, p.description].filter(Boolean).map(esc).join(' - ')
      out.push(`<path class="gmap-stroke" data-sw="${p['stroke-width'] || 2}" d="${path(parts, proj, false)}" fill="none" stroke="${esc(p.stroke || '#555555')}" stroke-width="${p['stroke-width'] || 2}" stroke-opacity="${p['stroke-opacity'] || 1}"${p['stroke-dasharray'] ? ` stroke-dasharray="${esc(p['stroke-dasharray'])}"` : ''} stroke-linecap="round" stroke-linejoin="round">${tip ? `<title>${tip}</title>` : ''}</path>`)
      // wide invisible stroke makes thin lines easy to hover
      out.push(`<path class="gmap-stroke" data-sw="12" d="${path(parts, proj, false)}" fill="none" stroke="transparent" stroke-width="12">${tip ? `<title>${tip}</title>` : ''}</path>`)
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
        out.push(`<g class="gmap-pin gmap-fixed" data-ax="${x}" data-ay="${y}"><circle cx="${x}" cy="${y}" r="${r}" fill="${esc(color)}" stroke="#fff" stroke-width="${r > 6 ? 2 : 1.5}">${tip ? `<title>${tip}</title>` : ''}</circle>${symbol && r > 6 && symbol.length <= 2 ? `<text x="${x}" y="${y + 4.2}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" pointer-events="none">${esc(symbol)}</text>` : ''}</g>`)
        if (p.title) {
          var text = String(p.title)
          var small = r <= 6
          var size = small ? 11 : 13
          var w = [...text].reduce((n, ch) => n + (/[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? size : size * 0.58), 0)
          texts.push({x, y, r, w, text, small, size, ax: x, ay: y})
        }
      })
    })
    // label the numbered stops first so small markers do not push them around
    texts.sort((a, b) => a.small - b.small).forEach((t) => {
      var spot = label({x: t.x, y: t.y, r: t.r, w: t.w}, placed, view)
      out.push(`<text class="gmap-fixed" data-ax="${t.ax}" data-ay="${t.ay}" x="${spot.x}" y="${spot.y}" text-anchor="${spot.anchor}" font-size="${t.size}" ${t.small ? '' : 'font-weight="600"'} fill="${colors.text}" stroke="${colors.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round" pointer-events="none">${esc(t.text)}</text>`)
    })

    out.push('</svg>')
    return out.join('')
  }

  // markers and labels keep their screen size while the map is zoomed, so places
  // that are close to each other (hotel, station) separate instead of growing together
  var fixed = (svg, scale) => {
    var k = scale > 0 ? 1 / scale : 1
    svg.querySelectorAll('.gmap-stroke').forEach((el) => el.setAttribute('stroke-width', el.dataset.sw * k))
    svg.querySelectorAll('.gmap-fixed').forEach((el) => {
      var x = el.dataset.ax, y = el.dataset.ay
      if (k === 1) el.removeAttribute('transform')
      else el.setAttribute('transform', `translate(${x} ${y}) scale(${k}) translate(${-x} ${-y})`)
    })
  }

  var source = () => (typeof state !== 'undefined' && state.maps && state.maps.source) || 'both'

  var SVGNS = 'http://www.w3.org/2000/svg'
  var TILE_ATTRIBUTION = 'Tiles © Esri, data © OpenStreetMap contributors and others'
  var TILES_FROM = 8 // tile zoom level where the tiles take over in the `both` mode
  var MAX_TILES = 64

  // Esri tiles work without a Referer (pages opened from file://), the OpenStreetMap servers block those requests
  var tileUrl = (z, x, y, isDark) => isDark
    ? `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`

  // geometry of the svg on the screen, in svg user units
  var geometry = (svg, container) => {
    var sr = svg.getBoundingClientRect()
    var cr = container.getBoundingClientRect()
    var W = +svg.dataset.w, H = +svg.dataset.h
    var eff = sr.width / W // screen px per user unit
    if (!(eff > 0)) return null
    return {
      sr, cr, W, H, eff,
      x0: Math.max((cr.left - sr.left) / eff, 0), x1: Math.min((cr.right - sr.left) / eff, W),
      y0: Math.max((cr.top - sr.top) / eff, 0), y1: Math.min((cr.bottom - sr.top) / eff, H),
    }
  }

  var cities = (svg, geo) => {
    var placed = []
    var hit = (r) => placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)
    // the markers go first so the names do not hide them
    svg.querySelectorAll('.gmap-pin').forEach((pin) => {
      placed.push({x: geo.sr.left + pin.dataset.ax * geo.eff - 11, y: geo.sr.top + pin.dataset.ay * geo.eff - 11, w: 22, h: 22})
    })
    svg.querySelectorAll('.gmap-city').forEach((city) => {
      var x = geo.sr.left + city.dataset.ax * geo.eff
      var y = geo.sr.top + city.dataset.ay * geo.eff
      var rect = {x: x - 4, y: y - 9, w: +city.dataset.w, h: 15}
      var visible = x > geo.cr.left && x < geo.cr.right && y > geo.cr.top && y < geo.cr.bottom && !hit(rect)
      if (visible) placed.push(rect)
      city.style.display = visible ? '' : 'none'
    })
  }

  var tiles = (svg, geo, mode) => {
    var group = svg.querySelector('.gmap-tiles')
    var scale = +svg.dataset.scale
    var x0 = +svg.dataset.x0, y1 = +svg.dataset.y1
    // tile zoom level where one tile is 256 css pixels
    var zf = Math.log2(geo.eff * scale * 2 * Math.PI / 256)
    var on = mode === 'online' || (mode === 'both' && zf >= TILES_FROM)
    svg.classList.toggle('gmap-tiled', on)
    if (!on) {
      if (group.firstChild) group.textContent = ''
      return false
    }
    // one level deeper on high density screens, the tiles are 256 px only
    var isDark = svg.dataset.dark === '1'
    var n, range, z = Math.max(0, Math.min(isDark ? 16 : 19, Math.round(zf) + (window.devicePixelRatio > 1 ? 1 : 0)))
    do {
      n = Math.pow(2, z)
      var tx = (u) => Math.floor(((u / scale + x0) + Math.PI) / (2 * Math.PI) * n)
      var ty = (v) => Math.floor((Math.PI - (y1 - v / scale)) / (2 * Math.PI) * n)
      range = {
        x0: Math.max(tx(geo.x0) - 1, 0), x1: Math.min(tx(geo.x1) + 1, n - 1),
        y0: Math.max(ty(geo.y0) - 1, 0), y1: Math.min(ty(geo.y1) + 1, n - 1),
      }
    } while ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) > MAX_TILES && z-- > 0)

    var existing = {}
    Array.from(group.children).forEach((img) => { existing[img.dataset.key] = img })
    var wanted = {}
    group.dataset.z = z
    // the previous zoom level is only dropped when the current one is loaded
    var settle = (tile) => {
      delete tile.dataset.loading
      var current = group.dataset.z
      if (!group.querySelector(`image[data-z="${current}"][data-loading]`)) {
        Array.from(group.children).forEach((img) => { if (img.dataset.z !== current) img.remove() })
      }
    }
    var size = 2 * Math.PI / n * scale
    var overlap = 0.5 / geo.eff
    for (var x = range.x0; x <= range.x1; x++) {
      for (var y = range.y0; y <= range.y1; y++) {
        var key = z + '/' + x + '/' + y
        wanted[key] = true
        if (existing[key]) continue
        let img = document.createElementNS(SVGNS, 'image')
        img.dataset.key = key
        img.dataset.z = z
        img.setAttribute('x', ((x / n * 2 * Math.PI - Math.PI) - x0) * scale)
        img.setAttribute('y', (y1 - (Math.PI - y / n * 2 * Math.PI)) * scale)
        img.setAttribute('width', size + overlap)
        img.setAttribute('height', size + overlap)
        img.setAttribute('preserveAspectRatio', 'none')
        img.dataset.loading = 1
        img.addEventListener('load', () => settle(img))
        // a missing tile leaves the offline basemap visible
        img.addEventListener('error', () => { img.remove(); settle(img) })
        img.setAttribute('href', tileUrl(z, x, y, isDark))
        group.appendChild(img)
      }
    }
    // tiles far from the view of the current zoom level are not needed anymore
    Array.from(group.children).forEach((img) => {
      if (+img.dataset.z === z && !wanted[img.dataset.key]) img.remove()
    })
    return true
  }

  // markers, labels and lines keep their size while zooming, then the layers that depend
  // on the zoom level (cities, tiles) are updated. container: the element the map is clipped by.
  var adapt = (svg, container, scale, attribution) => {
    fixed(svg, scale)
    cancelAnimationFrame(svg._frame)
    svg._frame = requestAnimationFrame(() => {
      var geo = svg.isConnected && geometry(svg, container)
      if (!geo) return
      var tiled = tiles(svg, geo, source())
      if (!tiled) cities(svg, geo)
      var text = tiled ? TILE_ATTRIBUTION : svg.dataset.attribution
      if (attribution) attribution.textContent = text
    })
  }

  return {
    fixed,
    adapt,
    render: () => {
      var definitions = walk(/<pre><code class="geojson">([\s\S]+?)<\/code><\/pre>/gi, state.html)

      Array.from(document.querySelectorAll('pre code.geojson')).forEach((block, index) => {
        var pre = block.parentElement
        pre.classList.add('geojson-map')
        var panzoomed = block._panzoom
        if (panzoomed) { panzoomed.destroy(); block._panzoom = null }
        try {
          block.innerHTML = '<div class="gmap-view">' + svg(JSON.parse(unescape(definitions[index]))) + '</div>' +
            '<div class="gmap-hint"><span class="gmap-attribution"></span> Wheel to zoom, drag to pan, double click to reset</div>'
        }
        catch (err) {
          block.innerHTML = '<div class="gmap-error">GeoJSON error: ' + esc(err.message) + '</div>' + '<pre>' + definitions[index] + '</pre>'
          return
        }
        var view = block.querySelector('.gmap-view')
        var map = view.querySelector('svg')
        var panzoom = Panzoom(map, {canvas: true, maxScale: 200, minScale: 1, step: 0.5})
        block._panzoom = panzoom
        var attribution = block.querySelector('.gmap-attribution')
        map.addEventListener('panzoomchange', (e) => adapt(map, view, e.detail.scale, attribution))
        view.addEventListener('wheel', (e) => {
          e.preventDefault()
          panzoom.zoomWithWheel(e)
        }, {passive: false})
        view.addEventListener('dblclick', () => panzoom.reset())
        adapt(map, view, 1, attribution)
      })
    }
  }
})()
