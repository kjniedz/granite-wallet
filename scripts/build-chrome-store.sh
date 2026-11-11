#!/bin/bash
# Build the extension from a clean install and zip it for the Chrome Web
# Store or for sideloading. Run from the repository root:
#   npm run package
# Output: release/granite-wallet-chrome-v<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/packages/extension"
VERSION=$(node -p "require('$EXT/public/manifest.json').version")

cd "$ROOT"
echo "Granite Wallet v$VERSION"
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build

mkdir -p "$ROOT/release"
OUT="$ROOT/release/granite-wallet-chrome-v${VERSION}.zip"
rm -f "$OUT"
(cd "$EXT/dist" && zip -qr "$OUT" . -x "*.map")
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Load unpacked from packages/extension/dist, or upload the zip to the Chrome Web Store."
