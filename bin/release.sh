#!/usr/bin/env zsh

# foxhop release — monorepo-aware version bump for the CLI package.
#
# Why this exists: the npm package lives in cli/, not the repo root, so the
# generic `git lzv` / `git tag-version` flow bumps cli/package.json but fails to
# create the tag (npm version only tags from the git root with a clean tree).
# This script owns foxhop's release policy: bump cli/, commit, tag `cli-v<ver>`
# at the repo root, and push — which fires .github/workflows/release.yml.
#
# The Firefox extension releases on its own line (`ext-v*`); this script only
# touches the CLI.
#
# Usage: bin/release.sh <patch|minor|major>

set -euo pipefail

BUMP="${1:-}"
case "$BUMP" in
  patch | minor | major) ;;
  *)
    echo "usage: bin/release.sh <patch|minor|major>" >&2
    exit 1
    ;;
esac

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "✗ releases must be cut from main (on '$branch')" >&2
  exit 1
fi

# Commit any pending work (e.g. the CHANGELOG entry) before the version bump.
if [[ -n $(git status --porcelain) ]]; then
  git add -A
  git aicommit
fi

# Bump the CLI package only — no git tag here; we tag at the repo root below.
npm version "$BUMP" --no-git-tag-version --prefix cli >/dev/null
VERSION=$(node -p "require('./cli/package.json').version")
TAG="cli-v${VERSION}"

# Promote the changelog's top "## Unreleased" heading to this version, so each
# release closes its own entry. Without this, stale "Unreleased" headings stack
# up and the next changelog run prepends a second one. Only the first heading is
# touched; older released entries are left untouched.
if [[ -f CHANGELOG.md ]] && grep -q '^## Unreleased' CHANGELOG.md; then
  VER="$VERSION" RELEASE_DATE="$(date +%F)" perl -i -pe '
    if (!$done && /^## Unreleased/) { $_ = "## [$ENV{VER}] — $ENV{RELEASE_DATE}\n"; $done = 1 }
  ' CHANGELOG.md
  git add CHANGELOG.md
fi

git add cli/package.json cli/package-lock.json
git commit -m "🏷️ release(cli): v${VERSION}"
git tag -a "$TAG" -m "$TAG"

# Fail loud if the tag did not materialise — never report a release that the
# workflow will never see.
if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "✗ tag ${TAG} was not created — aborting before push" >&2
  exit 1
fi

git push origin main
git push origin "$TAG"

echo "✓ released ${TAG} — release.yml will publish @kud/foxhop-cli@${VERSION}"
