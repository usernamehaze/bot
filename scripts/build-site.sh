#!/usr/bin/env bash
# Builds the website into _site/ — only the files the site needs.
# Cloudflare Pages runs this on every push:
#   Build command:          bash scripts/build-site.sh
#   Build output directory: _site
# (Promo videos and sources stay out: Cloudflare refuses files over 25 MB.)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site && mkdir _site
# (a list, not *.js: a stray script in the folder never ships by accident)
cp index.html app.html start.html privacy.html terms.html bot.html style.css manifest.json _site/
cp app.js errors.js care.js board.js bot-page.js cards.js cassie-bot.js cassie-bot3d.js cassie-3d.js cite.js config.js export.js gradient.js listen.js memory.js \
   native.js sketch.js start.js study-room.js sw.js voice.js _site/
cp _headers _site/   # Cloudflare Pages response headers (security)
cp -r icons landing patterns explore labs vendor _site/
# notes for developers and an unused logo aren't needed to run the site (they stay in the repo)
rm -f _site/explore/body/README.md _site/icons/logo.svg
[ -d .well-known ] && cp -r .well-known _site/ || true   # Play Store app link (assetlinks.json)
mkdir -p _site/promo && cp promo/cassie-ad-60s.mp4 _site/promo/
# A new version on every deploy, so phones never keep yesterday's files: the ?v= on every script
# and stylesheet and the offline cache's name become this commit's id (no bumping by hand).
ver="${CF_PAGES_COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"; ver="${ver:0:10}"
find _site -name '*.html' -o -name '*.js' -not -path '_site/vendor/*' -not -path '_site/explore/three*' \
  | xargs sed -i -E "s/\?v=[0-9]+([^0-9.]|$)/?v=$ver\1/g"   # (not 3.52.0: that's the extension's version)
sed -i -E "s/cassie-v[0-9]+/cassie-$ver/" _site/sw.js
# the Chrome extension, ready to download from the site (a folder inside, for "Load unpacked")
tmp="$(mktemp -d)" && cp -r extension "$tmp/cassie-extension" && rm -f "$tmp"/cassie-extension/*.zip
cp board.js sketch.js care.js "$tmp/cassie-extension/"   # the board is the app's own (one copy of it to keep up)
python3 - "$tmp" "$PWD/_site/cassie-extension.zip" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
PY
rm -rf "$tmp"
# Always the newest extension: its download links and the "Version" under the button carry
# extension/manifest.json's version, and the extension checks extension-version.json for a newer one.
extver="$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')"
sed -i -E "s/cassie-extension\.zip\?v=[0-9a-z.]+/cassie-extension.zip?v=$extver/g; s/(data-ext-version>)Version [0-9.]+/\1Version $extver/" _site/index.html
printf '{ "version": "%s" }\n' "$extver" > _site/extension-version.json
echo "Built _site: $(du -sh _site | cut -f1), $(find _site -type f | wc -l) files"
find _site -type f -size +25M -print -exec false {} + || { echo "A file is over 25 MB — Cloudflare will refuse it"; exit 1; }
