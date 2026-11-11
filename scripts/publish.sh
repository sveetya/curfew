#!/usr/bin/env bash
# Publish the repo: push main, set the signing-key secret, tag the release.
# Requires an empty repo to exist already (a fine-grained PAT cannot create one).
set -euo pipefail
REPO="${1:-sveetya/curfew}"
cd "$(dirname "$0")/.."

TOKEN=$(grep -m1 '^GITHUB_TOKEN=' /opt/data/.env | cut -d= -f2- | tr -d '"'"'"' \r')
export GH_TOKEN="$TOKEN"

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO does not exist. Create it first: https://github.com/new?name=curfew&owner=sveetya&visibility=public" >&2
  exit 1
fi

git remote get-url origin >/dev/null 2>&1 \
  && git remote set-url origin "https://github.com/${REPO}.git" \
  || git remote add origin "https://github.com/${REPO}.git"

git push -u origin HEAD

gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < /opt/data/secrets/curfew.key
# No password secret: the key was generated passwordless, so the workflow's
# empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD is correct.

git tag -f v0.1.0
git push -f origin v0.1.0

echo "Pushed. Watch the build:"
echo "  gh run list --repo $REPO --limit 3"
