#!/bin/bash
# Publish the Fox Hop Firefox extension to addons.mozilla.org (AMO).
#
# The FIRST submission of a new add-on is always manual (listing details + review
# on the Developer Hub), so this builds the package, opens the Hub, and reveals the
# artifact to upload. For LATER version updates of an add-on that already exists on
# AMO, set WEB_EXT_API_KEY / WEB_EXT_API_SECRET and run `npm run sign` to do it
# non-interactively.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Building the extension package…"
npm run build

ARTIFACT_DIR="$(pwd)/web-ext-artifacts"
echo "→ Opening the AMO Developer Hub."
echo "  Upload the package from: $ARTIFACT_DIR"
open "https://addons.mozilla.org/developers/"
open "$ARTIFACT_DIR" 2>/dev/null || true
