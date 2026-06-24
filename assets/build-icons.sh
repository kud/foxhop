#!/bin/bash
# Regenerate every icon asset from the single source: assets/icon.svg
#   - extension/src/icons/icon.svg   kept in sync with the master
#   - assets/icon.png                512×512, for the AMO listing / README
#   - cli/src/icon.ts                128×128 PNG embedded as base64
#                                    (foxhop sync writes it next to generated scripts)
# Requires librsvg:  brew install librsvg
set -euo pipefail
cd "$(dirname "$0")" # assets/

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found — run: brew install librsvg" >&2
  exit 1
}

echo "→ extension/src/icons/icon.svg (sync from master)"
cp icon.svg ../extension/src/icons/icon.svg

echo "→ assets/icon.png (512×512)"
rsvg-convert -w 512 -h 512 icon.svg -o icon.png

echo "→ cli/src/icon.ts (128×128 base64)"
b64=$(rsvg-convert -w 128 -h 128 icon.svg | base64 | tr -d '\n')
printf '// Generated from assets/icon.svg by assets/build-icons.sh — do not edit by hand.\nexport const ICON_PNG_BASE64 =\n  "%s"\n' "$b64" >../cli/src/icon.ts

echo "✓ icons regenerated from assets/icon.svg"
