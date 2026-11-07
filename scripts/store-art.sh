#!/usr/bin/env bash
# Render the Meta Horizon Store art from the game on the build server and put it in the planning folder
# (plan/store/assets/, next to the repo; never in the repo): the hero cover, the three covers, the mini
# landscape, the icon, the logo and five screenshots, at Meta's sizes and pixel formats, plus
# store-art.json (what each file is) and overview.png (everything on one sheet). It also makes the website's link card
# (index.html's og:image) and puts that in the repo, public/og-image.jpg: commit it.
# Usage: scripts/store-art.sh [playwright args...]   e.g. scripts/store-art.sh -g "plate hero|art"
#        scripts/store-art.sh --link-card            only the link card and its plate (-g "link.card", a few minutes);
#                                                    the planning folder is not touched
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

LINK_ONLY=0
if [ "${1:-}" = --link-card ]; then
  [ $# -eq 1 ] || { echo "--link-card takes nothing else" >&2; exit 2; }
  LINK_ONLY=1
  set -- -g "link.card"
fi

TRIES=${NS_STORE_ART_TRIES:-3}
[[ $TRIES =~ ^[1-9]$ ]] || { echo "bad NS_STORE_ART_TRIES: $TRIES (1 to 9)" >&2; exit 2; }
rc=75
for ((i = 1; i <= TRIES && rc == 75; i++)); do
  rc=0
  NS_EXPECT_GB=${NS_EXPECT_GB:-1} "$ROOT/scripts/e2e.sh" -c playwright.store.config.ts "$@" || rc=$?
  [ "$rc" -ne 75 ] || echo "store-art: the browser slot stayed busy (try $i of $TRIES)" >&2
done
[ -d "$SRC" ] || { echo "no art came back (exit $rc)" >&2; exit "$((rc == 0 ? 3 : rc))"; }

# The link card goes into the repo, never to the planning folder. The spec writes it only once all its checks pass.
if [ -f "$SRC/og-image.jpg" ]; then
  cp "$SRC/og-image.jpg" "$ROOT/public/og-image.jpg"
  echo "store-art: public/og-image.jpg updated (review: $SRC/review/link-card-*.png)"
fi
if [ "$LINK_ONLY" -eq 1 ]; then
  [ -f "$SRC/og-image.jpg" ] || { echo "no link card came back (exit $rc)" >&2; exit "$((rc == 0 ? 3 : rc))"; }
  exit "$rc"
fi
# A run that made no store art (a filter that matched none of it) leaves the planning folder as it is.
made=$(find "$SRC" -maxdepth 1 -name '*.png')
[ -n "$made" ] || { echo "store-art: no store art in this run; $DEST unchanged"; exit "$rc"; }

mkdir -p "$DEST"
# The pipeline's own files mirror the last run: each name it owns (owned.txt, written at the start of the run) goes
# first, so a file this run did not make is not left from an older one. Anything else in the folder stays (a headset
# capture placed by hand, inline/).
[ -f "$SRC/owned.txt" ] || { echo "no owned.txt from the run: not touching $DEST" >&2; exit "$((rc == 0 ? 3 : rc))"; }
NAME_RE='^[A-Za-z0-9._-]+$'
while IFS= read -r name; do
  [[ $name =~ $NAME_RE ]] || continue
  rm -f "$DEST/$name"
done <"$SRC/owned.txt"
n=0
for f in "$SRC"/*.png "$SRC"/store-art.json; do
  [ -f "$f" ] || continue
  cp "$f" "$DEST/"
  n=$((n + 1))
done
echo "store-art: $n files in $DEST"
exit "$rc"
