#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR_OVERRIDE:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE_DIR="${SOURCE_DIR_OVERRIDE:-$ROOT_DIR/.output/chrome-mv3}"
ICLOUD_ROOT="${ICLOUD_ROOT_OVERRIDE:-$HOME/Library/Mobile Documents/com~apple~CloudDocs}"
DEST_DIR_NAME="${DEST_DIR_NAME:-lexio-chrome-mv3}"
DEST_DIR="$ICLOUD_ROOT/$DEST_DIR_NAME"

echo "Building Chrome MV3 output..."
if [ -n "${BUILD_SCRIPT:-}" ]; then
  ROOT_DIR="$ROOT_DIR" ROOT_DIR_OVERRIDE="$ROOT_DIR" "$BUILD_SCRIPT"
else
  (
    cd "$ROOT_DIR"
    pnpm build
  )
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$ICLOUD_ROOT"
rm -rf "$DEST_DIR"
ditto "$SOURCE_DIR" "$DEST_DIR"

echo "Copied Chrome MV3 output to:"
echo "$DEST_DIR"
