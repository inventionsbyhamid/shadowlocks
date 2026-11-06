#!/usr/bin/env bash
# Render the store listing's inline media from the game and put it in the planning folder (plan/store/assets/inline/,
# next to the repo; never in the repo): 1 the box in the dimmed room with the lantern in hand (still), 2 the lantern
# carried onto a lock's spot and the lock opening in gold, 3 the fingertip casting the missing piece (each a still, an
# MP4 loop and a GIF under 5 MB), plus inline.json. Placement in the long description: plan/store/listing.md.
# Usage: scripts/store-inline.sh [video.sh options]   e.g. --fresh, or --detach (then run it again without it to finish)
#   NS_INLINE_SIZE=960x540 renders a quick draft instead of the store's 2560x1440.
# Steps: scripts/video.sh renders tests/video/shots/inline-{room,lock,finger}.ts (the shared browser lock, frame by
# frame; finished shots are reused), then scripts/inline-media.mjs cuts the files on the server.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
PLAN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")/../plan
[ -d "$PLAN" ] || { echo "no planning folder at $PLAN" >&2; exit 2; }
SIZE=${NS_INLINE_SIZE:-2560x1440}
[[ $SIZE =~ ^[0-9]{3,4}x[0-9]{3,4}$ ]] || { echo "bad NS_INLINE_SIZE: $SIZE" >&2; exit 2; }
FPS=30

"$ROOT/scripts/video.sh" --shots inline-room,inline-lock,inline-finger --size "$SIZE" --fps "$FPS" --crf 18 "$@"
for a in "$@"; do [ "$a" != --detach ] || { echo "store-inline: detached; run it again without --detach once the render is done" >&2; exit 0; }; done

"$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --pull test-results -- \
  node scripts/inline-media.mjs "test-results/video/$SIZE-$FPS" test-results/store-inline
DEST=$PLAN/store/assets/inline
mkdir -p "$DEST"
n=0
for f in "$ROOT"/test-results/store-inline/*; do
  [ -f "$f" ] || continue
  cp "$f" "$DEST/"
  n=$((n + 1))
done
echo "store-inline: $n files in $DEST"
