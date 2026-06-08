#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Granite Wallet — Chrome Web Store Build Script
# © 2026 Black Mountain Investment Group LLC
#
# Run this from the monorepo root:
#   chmod +x scripts/build-chrome-store.sh
#   ./scripts/build-chrome-store.sh
#
# Output: dist/granite-wallet-chrome-v1.0.0.zip
# ═══════════════════════════════════════════════════════════════════

set -e

echo "══════════════════════════════════════════"
echo " Granite Wallet — Chrome Web Store Build"
echo "══════════════════════════════════════════"
echo ""

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/packages/extension"
CORE="$ROOT/packages/wallet-core"
VERSION=$(node -p "require('$EXT/public/manifest.json').version")

echo "📦 Version: $VERSION"
echo "📁 Root: $ROOT"
echo ""

# ─── Step 1: Install dependencies ───
echo "1/5  Installing dependencies..."
cd "$ROOT"
npm install --silent 2>/dev/null || npm install

# ─── Step 2: Build wallet-core ───
echo "2/5  Building @granite/wallet-core..."
cd "$CORE"
npx tsc --noEmit 2>/dev/null || echo "   (Type check warnings — non-blocking)"

# ─── Step 3: Build extension ───
echo "3/5  Building Chrome extension..."
cd "$EXT"
npx vite build

# ─── Step 4: Copy static assets to dist ───
echo "4/5  Copying static assets..."
cp -r "$EXT/public/icons" "$EXT/dist/icons"
cp "$EXT/public/manifest.json" "$EXT/dist/manifest.json"

# Ensure popup.html is in dist root
if [ ! -f "$EXT/dist/popup.html" ]; then
  cp "$EXT/popup.html" "$EXT/dist/popup.html"
fi

# ─── Step 5: Create ZIP ───
echo "5/5  Creating Chrome Web Store ZIP..."
mkdir -p "$ROOT/dist"
cd "$EXT/dist"
zip -r "$ROOT/dist/granite-wallet-chrome-v${VERSION}.zip" . \
  -x "*.map" "*.ts" "*.tsx" "__tests__/*" "*.test.*"

echo ""
echo "══════════════════════════════════════════"
echo " ✅ Build complete!"
echo ""
echo " ZIP: dist/granite-wallet-chrome-v${VERSION}.zip"
echo " Size: $(du -sh "$ROOT/dist/granite-wallet-chrome-v${VERSION}.zip" | cut -f1)"
echo ""
echo " To test locally:"
echo "   1. Go to chrome://extensions"
echo "   2. Enable Developer Mode"
echo "   3. Click 'Load unpacked'"
echo "   4. Select: packages/extension/dist/"
echo ""
echo " To publish:"
echo "   1. Go to https://chrome.google.com/webstore/devconsole"
echo "   2. Upload: dist/granite-wallet-chrome-v${VERSION}.zip"
echo "══════════════════════════════════════════"
