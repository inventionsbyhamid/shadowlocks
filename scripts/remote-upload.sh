#!/usr/bin/env bash
# Runs ON THE BUILD SERVER as root, in front of the rsync that receives remote.sh's upload (remote.sh
# passes this text in rsync's --rsync-path; the lane's copy is never run). The upload writes the lane
# folder only:
#   - for the run that holds the lane (remote-run.sh names it in lane-<lane>.owner), so each run
#     gets its own files;
#   - under the lane's write lock and while no container of the lane exists, so a container can
#     never swap a path for a link while root's rsync writes there.
# Usage: remote-upload.sh <name> <lane> <rsync server args...>
set -u
NAME=$1 LANE=$2
shift 2
LOCKS=/root/shadowlocks/locks
OWNER=$LOCKS/lane-$LANE.owner
owned() { [ "$(cat "$OWNER" 2>/dev/null)" = "$NAME" ]; }
# True only when docker answers and lists no container of this lane: an error counts as "not clear".
lane_clear() { local ids; ids=$(docker ps -aq --filter "label=shadowlocks.lane=$LANE") && [ -z "$ids" ]; }

# Wait for the run to take the lane. Give up once the run is gone: its pid file was there and went,
# or never came within 30 s.
seen= n=0
until owned; do
  if [ -e "$LOCKS/$NAME.pgid" ]; then
    seen=1
  elif [ -n "$seen" ] || [ $n -ge 150 ]; then
    echo "remote.sh: the run is gone; not uploading" >&2
    exit 1
  fi
  sleep 0.2
  n=$((n + 1))
done

exec 8>"$LOCKS/lane-$LANE.write.lock"
flock -w 600 8 || { echo "remote.sh: the lane '$LANE' folder stayed busy for 600 s" >&2; exit 1; }
owned || { echo "remote.sh: the run gave up the lane; not uploading" >&2; exit 1; }
# A stopped run's container may still be going away.
for _ in $(seq 1 30); do lane_clear && break; sleep 1; done
lane_clear || { echo "remote.sh: a container of lane '$LANE' is still there (or docker did not answer); not uploading" >&2; exit 1; }
rsync "$@" && touch "$LOCKS/$NAME.uploaded"
