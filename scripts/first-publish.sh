#!/usr/bin/env bash
#
# First publish, run from your own machine.
#
# npm's trusted publishing is configured on a package's settings page, and a
# package that has never been published does not have one — `npm trust` says
# the same ("the package must already exist on the npm registry"). So the first
# release cannot use OIDC, and the alternative npm offers is a token with
# "bypass two-factor authentication", which is the thing npm itself warns
# against for CI.
#
# This is the third option: publish once interactively, with your real 2FA, and
# create no token at all. Afterwards every package exists, `npm trust` can wire
# up OIDC, and CI does every later release with no secret in the repository.
#
# Usage:
#   npm login
#   ./scripts/first-publish.sh            # publish
#   ./scripts/first-publish.sh --dry-run  # rehearse, change nothing

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "Rehearsing — nothing will be published."
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged in to npm. Run: npm login" >&2
  exit 1
fi
echo "Publishing as $(npm whoami)"

REPO="termio-sh/browser"
WORKFLOW="publish.yml"

echo "==> Building platform binaries"
bun scripts/build-binaries.ts

# Platform packages first. They are optional dependencies of the main package,
# so publishing that one ahead of them leaves a window in which installing it
# resolves nothing to run.
echo "==> Publishing platform packages"
for directory in dist-npm/*/; do
  npm publish "$directory" --access public $DRY_RUN
done

echo "==> Publishing @termio/browser"
npm publish packages/browser --access public $DRY_RUN

if [[ -n "$DRY_RUN" ]]; then
  echo "Rehearsal finished. Nothing was published."
  exit 0
fi

# Now that the packages exist, hand later releases to CI. From here the
# workflow publishes over OIDC and the repository holds no npm credential.
echo "==> Configuring trusted publishing"
for package in \
  "@termio/browser" \
  "@termio/browser-darwin-arm64" \
  "@termio/browser-darwin-x64" \
  "@termio/browser-linux-x64" \
  "@termio/browser-linux-arm64" \
  "@termio/browser-win32-x64"
do
  echo "--> $package"
  npm trust github "$package" --file "$WORKFLOW" --repo "$REPO" --allow-publish --yes
done

echo
echo "Done. Later releases run from Actions with no token:"
echo "  gh workflow run $WORKFLOW --repo $REPO"
