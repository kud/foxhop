#!/usr/bin/env zsh

# foxhop extension release — version bump for the Firefox extension surface.
#
# Mirrors bin/release.sh (the CLI line). npm is the version authority: we bump
# webext/package.json via `npm version -w webext`, then sync that version
# into webext/manifest.json (the value AMO actually reads). We commit, tag
# `webext-v<ver>` at the repo root, and push — which fires
# .github/workflows/release-webext.yml to sign + upload the listed AMO version.
#
# The CLI releases on its own line (`cli-v*`) via bin/release.sh; this script only
# touches the extension.
#
# Usage: bin/release-webext.sh <patch|minor|major>

set -euo pipefail

BUMP="${1:-}"
case "$BUMP" in
  patch | minor | major) ;;
  *)
    echo "usage: bin/release-webext.sh <patch|minor|major>" >&2
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

# Commit any pending work before the version bump.
if [[ -n $(git status --porcelain) ]]; then
  git add -A
  git aicommit
fi

# Bump the extension workspace, then mirror the version into the manifest. The
# perl edit targets only the top-level "version" line (not "manifest_version"),
# preserving the file's formatting.
npm version "$BUMP" --no-git-tag-version -w webext >/dev/null
VERSION=$(node -p "require('./webext/package.json').version")
perl -i -pe 's/^(\s*"version":\s*")[^"]+(")/${1}'"$VERSION"'${2}/' webext/manifest.json
TAG="webext-v${VERSION}"

git add webext/package.json webext/manifest.json package-lock.json
git commit -m "🏷️ release(webext): v${VERSION}"
git tag -a "$TAG" -m "$TAG"

# Fail loud if the tag did not materialise — never report a release that the
# workflow will never see.
if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "✗ tag ${TAG} was not created — aborting before push" >&2
  exit 1
fi

git push origin main
git push origin "$TAG"

echo "✓ released ${TAG} — release-webext.yml will sign & upload the listed AMO version ${VERSION}"
