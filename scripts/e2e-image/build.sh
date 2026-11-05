#!/usr/bin/env bash
# Build the shadowlocks-e2e image on the build server and pin it.
# The server's nightly cleanup deletes images no container uses, so a stopped
# placeholder container keeps this one alive.
# Usage: scripts/e2e-image/build.sh
set -euo pipefail

HOST=ioflood
DIR=/root/shadowlocks/e2e-image
IMAGE=shadowlocks-e2e
PIN=keep-shadowlocks-e2e
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)

ssh "$HOST" "mkdir -p $DIR"
rsync -a "$HERE/Dockerfile" "$HOST:$DIR/Dockerfile"
ssh "$HOST" "set -e
  load=\$(awk '{print \$1}' /proc/loadavg)
  if awk -v l=\"\$load\" 'BEGIN{exit !(l>25)}'; then echo \"refused: load \$load > 25\" >&2; exit 3; fi
  free=\$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
  if [ \"\${free:-0}\" -lt 100 ]; then echo \"refused: free disk \${free:-0} GB < 100 GB\" >&2; exit 3; fi
  docker build --pull -t $IMAGE $DIR
  docker rm -f $PIN >/dev/null 2>&1 || true
  docker create --name $PIN --label purpose=pin-image --network none $IMAGE true >/dev/null
  docker image inspect $IMAGE --format '{{.Id}} {{.Size}}'"
