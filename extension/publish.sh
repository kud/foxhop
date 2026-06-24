#!/bin/bash
# Publish the Fox Hop Firefox extension to addons.mozilla.org (AMO).
#
# First-time LISTED submissions must be finished on the AMO Developer Hub
# (listing details + review), so this script builds the package and opens the Hub.
# Once the add-on exists, set WEB_EXT_API_KEY / WEB_EXT_API_SECRET and this script
# will sign + submit new versions non-interactively instead.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Building the extension package…"
npm run build

ARTIFACT_DIR="$(pwd)/web-ext-artifacts"

if [[ -n "${WEB_EXT_API_KEY:-}" && -n "${WEB_EXT_API_SECRET:-}" ]]; then
  echo "→ AMO credentials found — signing + submitting a listed version…"
  npx web-ext sign --channel=listed --upload-source-code
else
  echo "→ No AMO API credentials (WEB_EXT_API_KEY / WEB_EXT_API_SECRET) set."
  echo "  Opening the AMO Developer Hub — upload the package from:"
  echo "  $ARTIFACT_DIR"
  open "https://addons.mozilla.org/developers/"
  open "$ARTIFACT_DIR" 2>/dev/null || true
fi
