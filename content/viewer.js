
// Full screen viewer for images and diagrams (mermaid, plantuml, map) with zoom and pan.
// A single button follows the mouse over the supported blocks, the viewer itself is
// an overlay appended to <html> so the content rendered by mithril is never touched.
var viewer = (() => {
  var icons = {
    open: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    in: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    exit: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  }

  var ready = false
  var button = null
  var current = null
  var opened = null

  var dark = () => document.body.classList.contains('_color-dark')

  // supported blocks, the element is the thing the button is placed over
  var find = (node) => {
    if (!node || !node.closest || !node.closest('#_html') || node.closest('#_viewer')) {
      return null
    }
    var img = node.closest('img')
    if (img && !img.classList.contains('emojione')) {
      var rect = img.getBoundingClientRect()
      // skip badges and icons
      return rect.width >= 64 && rect.height >= 48 ? {kind: 'image', element: img} : null
    }
    var pre = node.closest('pre')
    if (pre) {
      if (pre.classList.contains('plantuml-diagram')) {
        var iframe = pre.querySelector('iframe')
        return iframe ? {kind: 'plantuml', element: pre, iframe} : null
      }
      if (pre.querySelector('code.mermaid svg')) {
        return {kind: 'mermaid', element: pre, svg: pre.querySelector('code.mermaid svg')}
      }
      if (pre.classList.contains('geojson-map') && pre.querySelector('svg.gmap-svg')) {
        return {kind: 'map', element: pre, svg: pre.querySelector('svg.gmap-svg')}
      }
    }
    return null
  }

  var place = () => {
    if (!current || !current.element.isConnected) {
      button.style.display = 'none'
      return
    }
    var rect = current.element.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      button.style.display = 'none'
      return
    }
    button.style.display = 'block'
    button.style.top = Math.max(rect.top, 0) + 8 + 'px'
    button.style.left = Math.min(rect.right, window.innerWidth) - 40 + 'px'
  }

  // size of a svg element, the viewBox is the most reliable source
  var size = (svg) => {
    var box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat)
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
      return {w: box[2], h: box[3]}
    }
    var w = parseFloat(svg.getAttribute('width'))
    var h = parseFloat(svg.getAttribute('height'))
    if (w > 0 && h > 0) {
      return {w, h}
    }
    var rect = svg.getBoundingClientRect()
    return {w: rect.width || 300, h: rect.height || 150}
  }

  var fromSvg = (source) => {
    var svg = source.cloneNode(true)
    var {w, h} = size(svg)
    // drop the layout and the panzoom transform of the inline version
    svg.removeAttribute('style')
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
    return Promise.resolve({node: svg, w, h})
  }

  var fromImage = (src, w, h) => new Promise((resolve, reject) => {
    var img = new Image()
    img.alt = ''
    img.draggable = false
    img.onload = () => resolve({
      node: img,
      w: w || img.naturalWidth || 300,
      h: h || img.naturalHeight || 150,
    })
    img.onerror = () => reject(new Error('Failed to load the image'))
    img.src = src
  })

  var content = (target) => {
    if (target.kind === 'image') {
      var img = target.element
      var rect = img.getBoundingClientRect()
      return fromImage(img.currentSrc || img.src, img.naturalWidth || rect.width, img.naturalHeight || rect.height)
    }
    if (target.kind === 'plantuml') {
      // the diagram lives in a sandboxed iframe, it is shown as an image (no markup is injected)
      return puml.svg(target.iframe).then((svg) =>
        fromImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)))
    }
    return fromSvg(target.svg)
  }

  var close = () => {
    if (!opened) {
      return
    }
    var {overlay, panzoom, onkey, onresize, overflow} = opened
    opened = null
    document.documentElement.style.overflow = overflow
    document.removeEventListener('keydown', onkey, true)
    window.removeEventListener('resize', onresize)
    if (document.fullscreenElement === overlay) {
      document.exitFullscreen().catch(() => {})
    }
    panzoom.destroy()
    overlay.remove()
  }

  var show = (target) => {
    if (opened) {
      return
    }
    var overlay = document.createElement('div')
    overlay.id = '_viewer'
    overlay.className = dark() ? '_viewer-dark' : '_viewer-light'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.innerHTML =
      '<div id="_viewer-stage"></div>' +
      '<div id="_viewer-bar">' +
        '<span id="_viewer-zoom">100%</span>' +
        `<button type="button" data-action="out" title="Zoom out (-)" aria-label="Zoom out">${icons.out}</button>` +
        `<button type="button" data-action="in" title="Zoom in (+)" aria-label="Zoom in">${icons.in}</button>` +
        `<button type="button" data-action="fit" title="Fit to screen (0, double click)" aria-label="Fit to screen">${icons.fit}</button>` +
        (document.documentElement.requestFullscreen
          ? `<button type="button" data-action="screen" title="Toggle full screen" aria-label="Toggle full screen">${icons.screen}</button>`
          : '') +
        `<button type="button" data-action="close" title="Close (Esc)" aria-label="Close">${icons.close}</button>` +
      '</div>' +
      '<div id="_viewer-message"></div>'
    document.documentElement.appendChild(overlay)
    var overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    var stage = overlay.querySelector('#_viewer-stage')
    var message = overlay.querySelector('#_viewer-message')
    var label = overlay.querySelector('#_viewer-zoom')
    var panel = null
    var panzoom = null
    var natural = null

    // scale the content down or up to the window, the zoom starts from that fit
    var fit = () => {
      var pad = 16
      var scale = Math.min(
        (stage.clientWidth - 64) / (natural.w + pad * 2),
        (stage.clientHeight - 112) / (natural.h + pad * 2)
      )
      scale = Math.max(Math.min(scale, 8), 0.05)
      panel.style.width = (natural.w * scale + pad * 2) + 'px'
      panel.style.height = (natural.h * scale + pad * 2) + 'px'
      natural.node.style.width = (natural.w * scale) + 'px'
      natural.node.style.height = (natural.h * scale) + 'px'
      panzoom.reset({animate: false})
    }

    var actions = {
      in: () => panzoom && panzoom.zoomIn(),
      out: () => panzoom && panzoom.zoomOut(),
      fit: () => panzoom && panzoom.reset(),
      close,
      screen: () => {
        if (document.fullscreenElement === overlay) {
          document.exitFullscreen().catch(() => {})
        }
        else {
          overlay.requestFullscreen().catch(() => {})
        }
      },
    }

    overlay.querySelector('#_viewer-bar').addEventListener('click', (e) => {
      var action = e.target.closest('button') && e.target.closest('button').dataset.action
      if (action) {
        actions[action]()
      }
    })

    var onkey = (e) => {
      var key = e.key
      if (key === 'Escape') {
        // in full screen the first Escape belongs to the browser
        close()
      }
      else if (key === '+' || key === '=') {
        actions.in()
      }
      else if (key === '-' || key === '_') {
        actions.out()
      }
      else if (key === '0') {
        actions.fit()
      }
      else if (panzoom && /^Arrow(?:Left|Right|Up|Down)$/.test(key)) {
        var step = 60
        panzoom.pan(
          key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0,
          key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0,
          {relative: true}
        )
      }
      else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    var onresize = () => natural && fit()
    document.addEventListener('keydown', onkey, true)
    window.addEventListener('resize', onresize)

    opened = {overlay, onkey, onresize, overflow, panzoom: {destroy: () => panzoom && panzoom.destroy()}}

    message.textContent = 'Loading…'
    content(target).then((result) => {
      if (!opened || opened.overlay !== overlay) {
        return
      }
      natural = result
      message.textContent = ''
      panel = document.createElement('div')
      panel.id = '_viewer-panel'
      panel.appendChild(natural.node)
      stage.appendChild(panel)

      panzoom = Panzoom(panel, {canvas: true, maxScale: 40, minScale: 0.2, step: 0.4})
      panel.addEventListener('panzoomchange', (e) => {
        label.textContent = Math.round(e.detail.scale * 100) + '%'
      })
      stage.addEventListener('wheel', (e) => {
        e.preventDefault()
        panzoom.zoomWithWheel(e)
      }, {passive: false})
      stage.addEventListener('dblclick', () => panzoom.reset())

      // a click on the backdrop closes the viewer, a drag only pans
      var down = null
      stage.addEventListener('pointerdown', (e) => { down = {x: e.clientX, y: e.clientY} })
      stage.addEventListener('pointerup', (e) => {
        if (down && e.target === stage && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
          close()
        }
        down = null
      })
      fit()
    }).catch((err) => {
      message.textContent = err.message
    })
  }

  var init = () => {
    if (ready) {
      return
    }
    ready = true
    button = document.createElement('button')
    button.id = '_viewer-open'
    button.type = 'button'
    button.title = 'View full screen'
    button.setAttribute('aria-label', 'View full screen')
    button.innerHTML = icons.open
    button.style.display = 'none'
    button.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (current) {
        show(current)
      }
    })
    document.documentElement.appendChild(button)

    document.addEventListener('mouseover', (e) => {
      if (opened || e.target === button || button.contains(e.target)) {
        return
      }
      var target = find(e.target)
      // the mouse entering the iframe of a diagram is still the same block
      if ((target && current && target.element === current.element) || target === current) {
        return
      }
      current = target
      place()
    })
    var move = () => { if (current && !opened) place() }
    window.addEventListener('scroll', move, true)
    window.addEventListener('resize', move)
  }

  return {init}
})()
