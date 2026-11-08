#!/usr/bin/env bash
# Fill in what the owner sends for the Quest apps, in one command: the two App IDs, the signing key's
# SHA-256 and the public support address (none of them is secret). It runs scripts/twa-config.mjs on
# the build server (node never runs on this Mac), brings the generated files back and puts them in
# place: twa/store/ and twa/competition/twa-manifest.json, public/.well-known/assetlinks.json and the
# support link on public/privacy.html.
# Usage: scripts/twa-fill.sh [--store-app-id <n>] [--competition-app-id <n>] [--sha256 '<fingerprint>']
#                            [--support-email <address>] [--store-package <id>] [--competition-package <id>]
#                            [--store-host <host>] [--competition-host <host>]
#                            [--store-version <n>] [--competition-version <n>]
#   e.g. scripts/twa-fill.sh --store-app-id 1234567890123456 --competition-app-id 2345678901234567 \
#          --sha256 'SHA256: AB:CD:...:EF' --support-email <address>
# Any subset works; what is not given stays as it is. --store-version / --competition-version raise an
# app's version for its next APK. Then review `git diff`, commit, redeploy both hosts (the asset links)
# and run the strict check for the app before its APK build (scripts/twa-build.sh runs it too):
#   scripts/remote.sh <lane> -- node scripts/twa-config.mjs check --app store
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
OUT=test-results/twa-fill
FILES=(twa/store/twa-manifest.json twa/competition/twa-manifest.json public/.well-known/assetlinks.json public/privacy.html)

if [ $# -eq 0 ] || [ "$1" = -h ] || [ "$1" = --help ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi
ARG_RE='^[A-Za-z0-9@._:+ -]+$'
for a in "$@"; do
  [[ $a =~ $ARG_RE ]] || { echo "refused: unexpected characters in an argument" >&2; exit 2; }
done

# On the server: generate into test-results/twa-fill/ (the runner pulls test-results back).
"$ROOT/scripts/remote.sh" "$LANE" --pull test-results -- \
  bash -c 'rm -rf "$1" && node scripts/twa-config.mjs fill --out "$1" "${@:2}"' twa-fill "$OUT" "$@"

n=0
for f in "${FILES[@]}"; do
  if [ -f "$ROOT/$OUT/$f" ]; then
    mkdir -p "$(dirname "$ROOT/$f")"
    cp "$ROOT/$OUT/$f" "$ROOT/$f"
    n=$((n + 1))
  fi
done
[ "$n" -ge 3 ] || { echo "refused: the generated files did not come back ($n of ${#FILES[@]})" >&2; exit 3; }
echo "twa-fill: $n files updated"
git -C "$ROOT" status --short -- twa public/.well-known public/privacy.html
