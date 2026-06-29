#!/bin/bash
# Publish the Fox Hop Firefox extension to the LISTED channel on AMO — the public
# page (addons.mozilla.org/firefox/addon/foxhop) that users install from.
#
# Why listed: signing via the unlisted/Self channel produces a self-hosted .xpi
# that never appears on the public AMO page. Only listed uploads move the version
# shown there. Use `npm run sign:self` if you ever need a self-hosted build instead.
#
# web-ext authenticates with WEB_EXT_API_KEY / WEB_EXT_API_SECRET; we map them
# from the canonical MOZILLA_ADDONS_JWT_* credentials in the shell environment.
# Get or rotate the key+secret at:
#   https://addons.mozilla.org/en-US/developers/addon/api/key/
set -euo pipefail
cd "$(dirname "$0")"

: "${MOZILLA_ADDONS_JWT_ISSUER:?set MOZILLA_ADDONS_JWT_ISSUER (AMO JWT issuer)}"
: "${MOZILLA_ADDONS_JWT_SECRET:?set MOZILLA_ADDONS_JWT_SECRET (AMO JWT secret)}"
export WEB_EXT_API_KEY="$MOZILLA_ADDONS_JWT_ISSUER"
export WEB_EXT_API_SECRET="$MOZILLA_ADDONS_JWT_SECRET"

VERSION=$(node -p "require('./manifest.json').version")
echo "→ Submitting Fox Hop v${VERSION} to the AMO listed channel…"
npm run sign:listed
echo "✓ Submitted v${VERSION} to the listed channel — it goes live once Mozilla approves it."
