# Markdown Viewer

## Build

Build with a supported Node: the current LTS or the latest release (verified on Linux with v22, v24 and v26, `.nvmrc` selects the LTS). Node 20 is end of life.
Run the build in a `node:lts` Docker container, the host has no `zip` either.

- Node 24 on the Windows host used to produce a broken build. The likely cause is `node-sass` (a native module that has to be compiled for every Node release), replaced by `sass`, and the sub build scripts did not stop when `npm install` failed, they now use `set -e`. This was not re-verified on Windows: if a host build still misbehaves, use the container below
- `npm install` failing is now a build failure, previously `npx` could silently download an unpinned latest tool and bundle its output

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" node:lts bash -c '
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
