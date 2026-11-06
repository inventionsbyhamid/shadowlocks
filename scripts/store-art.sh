#!/usr/bin/env bash
# Render the Meta Horizon Store art from the game on the build server and put it in the planning folder
# (plan/store/assets/, next to the repo; never in the repo): the hero cover, the three covers, the mini
# landscape, the icon, the logo and five screenshots, at Meta's sizes and pixel formats, plus
# store-art.json (what each file is) and overview.png (everything on one sheet).
# Usage: scripts/store-art.sh [playwright args...]   e.g. scripts/store-art.sh -g "plate hero|art"
# Runs through scripts/e2e.sh (the e2e image, the shared browser lock; about 20 to 30 minutes), with
# tests/video/store.spec.ts and playwright.store.config.ts. Layout and sizes: tests/video/lib/store-art.ts.
# When other lanes keep the browser slot busy for e2e.sh's whole 30 minute wait (exit 75), it tries
# again, up to NS_STORE_ART_TRIES times (default 3).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
PLAN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")/../plan
[ -d "$PLAN" ] || { echo "no planning folder at $PLAN" >&2; exit 2; }
DEST=$PLAN/store/assets
SRC=$ROOT/test-results/store

TRIES=${NS_STORE_ART_TRIES:-3}
[[ $TRIES =~ ^[1-9]$ ]] || { echo "bad NS_STORE_ART_TRIES: $TRIES (1 to 9)" >&2; exit 2; }
rc=75
for ((i = 1; i <= TRIES && rc == 75; i++)); do
  rc=0
  NS_EXPECT_GB=${NS_EXPECT_GB:-1} "$ROOT/scripts/e2e.sh" -c playwright.store.config.ts "$@" || rc=$?
  [ "$rc" -ne 75 ] || echo "store-art: the browser slot stayed busy (try $i of $TRIES)" >&2
done
[ -d "$SRC" ] || { echo "no art came back (exit $rc)" >&2; exit "$((rc == 0 ? 3 : rc))"; }

mkdir -p "$DEST"
# The folder mirrors the last run: its top-level art goes first (inline/ and other folders stay).
rm -f "$DEST"/*.png "$DEST"/store-art.json
n=0
for f in "$SRC"/*.png "$SRC"/store-art.json; do
  [ -f "$f" ] || continue
  cp "$f" "$DEST/"
  n=$((n + 1))
done
echo "store-art: $n files in $DEST"
exit "$rc"
