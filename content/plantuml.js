
var puml = (() => {
  // renderer.html is built into /vendor/plantuml/ by build/plantuml/build.sh
  var url = chrome.runtime.getURL('/vendor/plantuml/renderer.html')
  var origin = new URL(url).origin
  // chrome: the engine is an ES module, the iframe is sandboxed (opaque origin)
  // firefox: sandboxed iframes can't load moz-extension:// modules, see firefox.md
  var firefox = /Firefox/.test(navigator.userAgent)

  var diagrams = []
  var started = false
  var counter = 0

  var dark = () =>
    state._themes[state.theme] === 'dark' ||
    (state._themes[state.theme] === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // fenced blocks usually contain the whole @startuml ... @enduml pair, but
  // the delimiters are optional here: a bare body is wrapped in @startuml
  var source = (text) => {
    var match = /@start\w+[\s\S]*?@end\w+/.exec(text)
    return match ? match[0] : '@startuml\n' + text.trim() + '\n@enduml'
  }

  var post = (diagram) => {
    diagram.dark = dark()
    diagram.done = false
    diagram.iframe.contentWindow.postMessage({
      type: 'PLANTUML_RENDER',
      requestId: diagram.id,
      source: diagram.source,
      options: {dark: diagram.dark},
    }, firefox ? origin : '*')
  }

  // the renderer posts back the height of the diagram, never any markup
  window.addEventListener('message', (e) => {
    var data = e.data
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string') {
      return
    }
    var diagram = diagrams.find((diagram) =>
      diagram.id === data.requestId && diagram.iframe.contentWindow === e.source)
    if (!diagram) {
      return
    }
    if (data.type === 'PLANTUML_RESULT' || data.type === 'PLANTUML_ERROR') {
      diagram.done = true
    }
    if (typeof data.height === 'number' && data.height > 0) {
      diagram.iframe.style.height = Math.ceil(data.height) + 'px'
    }
  })

  return {
    render: () => {
      started = true
      // drop diagrams that are gone, the content was replaced
      diagrams = diagrams.filter((diagram) => diagram.iframe.isConnected)

      Array.from(document.querySelectorAll('pre > code.plantuml')).forEach((code) => {
        var pre = code.parentElement
        if (pre.classList.contains('plantuml-diagram')) {
          return
        }
        var iframe = document.createElement('iframe')
        iframe.src = url
        iframe.title = 'PlantUML diagram'
        if (!firefox) {
          iframe.sandbox = 'allow-scripts'
        }
        var diagram = {
          id: 'puml-' + (++counter),
          iframe,
          source: source(code.textContent),
          dark: null,
          done: false,
        }
        diagrams.push(diagram)
        iframe.addEventListener('load', () => post(diagram), {once: true})

        // the diagram lives inside the code block itself, siblings of
        // the trusted html are left alone so that mithril can replace it
        code.style.display = 'none'
        pre.classList.add('plantuml-diagram')
        pre.appendChild(iframe)
      })

      // theme change
      diagrams.forEach((diagram) => {
        if (diagram.done && diagram.dark !== dark()) {
          post(diagram)
        }
      })
    },
    done: (count) =>
      started && diagrams.filter((diagram) => diagram.done).length >= count,
  }
})()
