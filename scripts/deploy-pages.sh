#!/usr/bin/env bash
# Publish public/ (with the engine copied in) to the gh-pages branch for GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run -s sync-engine
SHA=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
cp -r public/. "$TMP/" && touch "$TMP/.nojekyll"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="${GIT_AUTHOR_NAME:-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-noreply@example.com}" commit -q -m "Publish site from main $SHA"
git -C "$TMP" push -f "$(git remote get-url origin)" gh-pages
rm -rf "$TMP"
echo "Pushed gh-pages ($SHA). Live in ~1 minute at https://lord1diotoir.github.io/JETSKI/"
