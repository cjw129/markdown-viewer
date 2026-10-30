// Renderer for the PlantUML option, runs inside the extension page that
// content/plantuml.js embeds in an iframe. The browser specific entry
// point (renderer.chrome.js, renderer.firefox.js) passes in the engine.
//
// Protocol (derived from the plantuml-for-github extension):
//   parent -> PLANTUML_RENDER {requestId, source, options: {dark}}
//   iframe -> PLANTUML_RESULT {requestId, height} | PLANTUML_ERROR {requestId, error, height}

/* exported pumlInit */
function pumlInit (render) {
  var output = document.getElementById('plantuml-output')
  var queue = Promise.resolve()
  var current = null

  var height = () => Math.ceil(document.body.offsetHeight)

  var reply = (message) => {
    // the parent can be a file:// page, whose origin can't be targeted
    window.parent.postMessage(message, '*')
  }

  var error = (message) => {
    output.innerHTML = ''
    var div = document.createElement('div')
    div.className = 'error'
    div.textContent = 'PlantUML error: ' + message
    output.appendChild(div)
  }

  // the engine inserts the svg asynchronously and keeps adding to it, wait
  // for the DOM to settle before reading the size
  var draw = (source, dark) => new Promise((resolve, reject) => {
    var settle = null
    var observer = new MutationObserver(() => {
      if (!output.querySelector('svg')) {
        return
      }
      clearTimeout(settle)
      settle = setTimeout(finish, 80)
    })
    var timeout = setTimeout(() => {
      stop()
      reject(new Error('Rendering timed out after 15s'))
    }, 15000)

    var stop = () => {
      observer.disconnect()
      clearTimeout(settle)
      clearTimeout(timeout)
    }
    var finish = () => {
      stop()
      resolve()
    }

    output.innerHTML = ''
    observer.observe(output, {childList: true, subtree: true, attributes: true})
    try {
      render(source.split(/\r\n|\r|\n/), 'plantuml-output', {dark})
    }
    catch (err) {
      stop()
      reject(err)
    }
  })

  window.addEventListener('message', (e) => {
    var data = e.data
    if (e.source !== window.parent || !data || data.type !== 'PLANTUML_RENDER' ||
        typeof data.source !== 'string' || typeof data.requestId !== 'string') {
      return
    }
    var dark = !!(data.options && data.options.dark)
    current = data.requestId
    document.documentElement.classList.toggle('dark', dark)

    // one diagram at a time, the engine renders into a single element
    queue = queue
      .then(() => draw(data.source, dark))
      .then(() => reply({type: 'PLANTUML_RESULT', requestId: data.requestId, height: height()}))
      .catch((err) => {
        error(err && err.message ? err.message : String(err))
        reply({
          type: 'PLANTUML_ERROR',
          requestId: data.requestId,
          error: String(err && err.message ? err.message : err),
          height: height(),
        })
      })
  })

  // the svg scales with the width of the page
  var last = 0
  new ResizeObserver(() => {
    var now = height()
    if (last && now !== last && current && output.querySelector('svg')) {
      reply({type: 'PLANTUML_HEIGHT', requestId: current, height: now})
    }
    last = now
  }).observe(output)
}
