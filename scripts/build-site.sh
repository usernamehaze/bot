#!/usr/bin/env bash
# Builds the website into _site/ — only the files the site needs.
# Cloudflare Pages runs this on every push:
#   Build command:          bash scripts/build-site.sh
#   Build output directory: _site
# (Promo videos and sources stay out: Cloudflare refuses files over 25 MB.)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site && mkdir _site
cp index.html app.html start.html privacy.html terms.html bot.html ./*.js style.css manifest.json _site/
cp -r icons landing mascot3d patterns explore _site/
[ -d .well-known ] && cp -r .well-known _site/ || true   # Play Store app link (assetlinks.json)
mkdir -p _site/promo && cp promo/cassie-ad-60s.mp4 _site/promo/
# the Chrome extension, ready to download from the site (a folder inside, for "Load unpacked")
tmp="$(mktemp -d)" && cp -r extension "$tmp/cassie-extension" && rm -f "$tmp"/cassie-extension/*.zip
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
echo "Built _site: $(du -sh _site | cut -f1), $(find _site -type f | wc -l) files"
find _site -type f -size +25M -print -exec false {} + || { echo "A file is over 25 MB — Cloudflare will refuse it"; exit 1; }
