# Markdown Viewer

## Build

Build with **Node 20** (tested with v20.20.2), not with the host Node (v24 produced a broken build).
Run the build in a `node:20` Docker container, the host has no `zip` either.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" node:20 bash -c '
set -e
apt-get update -qq && apt-get install -y -qq zip >/dev/null
mkdir /work && cd /src && tar cf - --exclude=./.git --exclude=./vendor --exclude=./themes . | tar xf - -C /work
cd /work && find . -name "*.sh" -exec sed -i "s/\r$//" {} +
sh build/package.sh chrome
cp -r themes vendor manifest.json markdown-viewer.zip /src/
'
```

- the build runs on a copy inside the container, only `themes/`, `vendor/`, `manifest.json` and `markdown-viewer.zip` are copied back
- the shell scripts may have CRLF line endings on Windows, they are converted on the copy only
- use `firefox` instead of `chrome` for the Firefox build, `manifest.json` is overwritten with the Firefox one, so build `chrome` again before loading the directory in Chrome
- `build/map/tmp/` caches the Natural Earth data downloaded during the build (needs network, ignored by git)
- after a build reload the extension in `chrome://extensions`
