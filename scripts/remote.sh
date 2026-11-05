#!/usr/bin/env bash
# Run a command inside a container on the build server.
# Usage: scripts/remote.sh <lane> [--image <img>] [--shm <size>] [--env K=V]... [--lock <name>] [--pull <output>]...
#                         [--expect-gb <n>] -- <command...>
#   --image <img>  container image; shadowlocks-* images are local only and never pulled from a registry
#   --shm <size>   shared memory for the container (browsers need it: --shm 2g)
#   --env K=V      pass an environment variable to the command. Values are visible on the server
#                  (process list, docker inspect): never pass secrets this way.
#   --lock <name>  wait (up to NS_LOCK_WAIT s, default 3600; exit 75 when it gives up) for a server-wide
#                  lock and hold it until the container is gone (one run at a time)
#   --pull <output> copy this output back afterwards, mirrored (local files gone on the server are
#                  removed): test-results, playwright-report, package-lock.json, dist or audio-out.
#                  It is copied on the server while nothing of the lane runs; links, devices and other
#                  special files are left out. A notes.txt at the top of a pulled output is printed at
#                  the end (e2e tests leave notes there).
#   --expect-gb <n> the run writes about n GB (a video render, say): it then needs 100 + n GB free on
#                  the server instead of 100 (NS_MIN_FREE_GB sets the 100). Pulls stay capped at 2 GB.
# Runs of one lane take turns: each waits (same limit) for the lane's earlier run to finish, then
# uploads and runs. The container runs as uid 1000 (not root), with no capabilities,
# no-new-privileges and at most 2048 processes and threads (an e2e run peaks near 300); its npm
# cache is the shadowlocks-npm-user volume. A container is stopped (exit 137) when it runs longer than
# NS_MAX_RUN s (default 7200; raise it for long video renders), so a hung run frees its locks, or when
# the server disk drops under 50 GB free while it runs.
# Exit codes: command's own code; 2 usage; 3 server refused or upload failed; 75 lock wait gave up;
# 130 interrupted.
set -euo pipefail

HOST=ioflood
BASE=/root/shadowlocks/lanes
MAX_LOAD=${NS_MAX_LOAD:-25}
# Our unit, typecheck, build and e2e runs write under 2 GB; the floor keeps room for everything else.
MIN_FREE_GB=${NS_MIN_FREE_GB:-100}
RUN_USER=1000:1000
NPM_VOLUME=shadowlocks-npm-user

usage() {
  echo "usage: $0 <lane> [--image <img>] [--shm <size>] [--env K=V]... [--lock <name>] [--pull <output>]... [--expect-gb <n>] -- <command...>" >&2
  exit 2
}

[ $# -ge 1 ] || usage
LANE=$1
shift
[[ $LANE =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "bad lane name: $LANE" >&2; exit 2; }

IMAGE=node:22-bookworm
SHM=
LOCK=
EXPECT_GB=0
ENVS=()
PULLS=()
while [ $# -gt 0 ]; do
  case $1 in
    --image) [ $# -ge 2 ] || usage; IMAGE=$2; shift 2 ;;
    --shm)
      [ $# -ge 2 ] || usage
      [[ $2 =~ ^[0-9]+[kmgKMG]?$ ]] || { echo "bad --shm size: $2" >&2; exit 2; }
      SHM=$2; shift 2 ;;
    --lock)
      [ $# -ge 2 ] || usage
      # lane-* files are the lane locks (remote-run.sh): a shared lock must never be one of them.
      [[ $2 =~ ^[A-Za-z0-9_-]+$ && $2 != lane-* ]] \
        || { echo "bad --lock name: $2 (letters, digits, _ and -; not starting with lane-)" >&2; exit 2; }
      LOCK=$2; shift 2 ;;
    --expect-gb)
      [ $# -ge 2 ] || usage
      [[ $2 =~ ^[0-9]{1,5}$ ]] || { echo "bad --expect-gb: $2 (whole GB, up to 5 digits)" >&2; exit 2; }
      EXPECT_GB=$2; shift 2 ;;
    --env)
      [ $# -ge 2 ] || usage
      [[ $2 =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || { echo "bad --env, want K=V: $2" >&2; exit 2; }
      ENVS+=(-e "$2"); shift 2 ;;
    --pull)
      [ $# -ge 2 ] || usage
      case ${2%/} in
        test-results|playwright-report|package-lock.json|dist|audio-out) PULLS+=("${2%/}") ;;
        *) echo "--pull takes test-results, playwright-report, package-lock.json, dist or audio-out, not '$2'" >&2
           exit 2 ;;
      esac
      shift 2 ;;
    --) shift; break ;;
    *) usage ;;
  esac
done
[ $# -ge 1 ] || usage
CMD=("$@")
LOCK_WAIT=${NS_LOCK_WAIT:-3600}
[[ $LOCK_WAIT =~ ^[0-9]+$ ]] || { echo "bad NS_LOCK_WAIT: $LOCK_WAIT" >&2; exit 2; }
MAX_RUN=${NS_MAX_RUN:-7200}
[[ $MAX_RUN =~ ^[1-9][0-9]*$ ]] || { echo "bad NS_MAX_RUN: $MAX_RUN" >&2; exit 2; }
[[ $MIN_FREE_GB =~ ^[0-9]{1,5}$ ]] || { echo "bad NS_MIN_FREE_GB: $MIN_FREE_GB (whole GB, up to 5 digits)" >&2; exit 2; }
# 10#: a leading zero (08) is decimal, not octal.
NEED_GB=$((10#$MIN_FREE_GB + 10#$EXPECT_GB))

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
REMOTE_DIR="$BASE/$LANE"
# Time plus 30 random bits: two runs of one lane never share a container name or lock files.
NAME="shadowlocks-$LANE-$(date -u +%m%d%H%M%S)-$RANDOM$RANDOM"

# Gate: load average and free disk on the server. Also makes the npm cache volume the container
# user can write.
gate=$(ssh "$HOST" "mkdir -p $(printf '%q' "$REMOTE_DIR") && docker volume create $NPM_VOLUME >/dev/null \
  && chown $RUN_USER \$(docker volume inspect -f '{{.Mountpoint}}' $NPM_VOLUME) && awk '{print \$1}' /proc/loadavg && df -BG --output=avail / | tail -1 | tr -dc 0-9") \
  || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
LOAD=$(printf '%s\n' "$gate" | sed -n 1p)
FREE=$(printf '%s\n' "$gate" | sed -n 2p)
[[ $LOAD =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "refused: could not read load average from $HOST (got '$LOAD')" >&2; exit 3; }
[[ $FREE =~ ^[0-9]+$ ]] || { echo "refused: could not read free disk from $HOST (got '$FREE')" >&2; exit 3; }
if awk -v l="$LOAD" -v m="$MAX_LOAD" 'BEGIN{exit !(l>m)}'; then
  echo "refused: $HOST load average $LOAD > $MAX_LOAD" >&2; exit 3
fi
if [ "${FREE:-0}" -lt "$NEED_GB" ]; then
  if [ "$EXPECT_GB" -gt 0 ]; then why=" ($MIN_FREE_GB GB floor + $EXPECT_GB GB this run expects to write)"; else why=; fi
  echo "refused: $HOST free disk ${FREE:-0} GB < $NEED_GB GB$why" >&2; exit 3
fi

# Install only when the dependency files changed, then run the command.
INNER='set -e
sum=$(cat package.json package-lock.json 2>/dev/null | sha256sum | cut -d" " -f1)
if [ ! -d node_modules ] || [ "$(cat node_modules/.install-sum 2>/dev/null)" != "$sum" ]; then
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --prefer-offline >/dev/null
  else npm install --no-audit --no-fund --prefer-offline >/dev/null; fi
  echo "$sum" > node_modules/.install-sum
fi
exec "$@"'

# The label lets the server find this lane's containers (no upload while one exists).
DOCKER_OPTS=(--rm --name "$NAME" --label "shadowlocks.lane=$LANE" --cpus 6 --memory 8g --pids-limit 2048
  --user "$RUN_USER" --cap-drop ALL --security-opt no-new-privileges -e npm_config_cache=/npm-cache)
if [ -n "$SHM" ]; then DOCKER_OPTS+=(--shm-size "$SHM"); fi
# Our own images exist only on the server: fail fast instead of trying a registry.
case $IMAGE in shadowlocks-*) DOCKER_OPTS+=(--pull never) ;; esac
DOCKER_OPTS+=(${ENVS[@]+"${ENVS[@]}"})

# scripts/ is read-only inside: code in the container (an npm install script, say) cannot change the
# runner's own files.
RUN=(docker run "${DOCKER_OPTS[@]}" -v "$REMOTE_DIR:/work" -v "$REMOTE_DIR/scripts:/work/scripts:ro" \
  -v "$NPM_VOLUME:/npm-cache" -w /work "$IMAGE" bash -lc "$INNER" _ "${CMD[@]}")
RUN_Q=$(printf '%q ' "${RUN[@]}")
LOCKS=/root/shadowlocks/locks
PULL_DIR=/root/shadowlocks/pulls

# The server side runs as root, so its scripts always come from this checkout and travel on the
# command line. Never run the lane's copies there: /work in a container is that same directory.
# remote-run.sh is the run (pid file, heartbeat watchdog, locks, container), remote-upload.sh the
# server end of the upload, remote-stop.sh stops a run.
STOP_SH=$(cat "$ROOT/scripts/remote-stop.sh")
STOP_Q="bash -c $(printf '%q' "$STOP_SH") remote-stop $NAME $LANE"
# setsid's own stderr is dropped (its "child did not exit normally" after a stop is noise); the run
# gets the real one back on fd 4.
REMOTE_CMD="mkdir -p $LOCKS $PULL_DIR && exec setsid -w bash -c $(printf '%q' "$(cat "$ROOT/scripts/remote-run.sh")") \
remote-run $NAME $LANE $(printf '%q ' "$LOCK" "$LOCK_WAIT" "$MAX_RUN" "$NEED_GB" "${PULLS[*]-}" "$RUN_USER" "$STOP_SH")$RUN_Q 4>&2 2>/dev/null"

# rsync's --rsync-path: run this script text with bash on the server, rsync's own arguments appended.
# The text goes as base64. openrsync (macOS) splits the option into words and removes one level of
# quotes; rsync proper hands it to the remote shell as it is.
if rsync --version 2>/dev/null | grep -q openrsync; then RQ="'"; else RQ=; fi
rsync_path() {
  local text=$1
  shift
  printf 'bash -c %s"$(echo %s | base64 -d)"%s %s' "$RQ" "$(printf '%s' "$text" | base64 | tr -d '\n')" "$RQ" "$*"
}

# Prints "command exited 255" when the run had already ended that way (see remote-stop.sh).
cleanup() {
  ssh -n -o ConnectTimeout=10 "$HOST" "$STOP_Q" 2>/dev/null || true
}

# One byte every 15 s while this script (pid $1) lives; it checks every second, so it ends within a
# second of the script however that ends. It holds none of the caller's streams, so a pipe the
# caller reads closes when the script exits.
heartbeat() {
  exec </dev/null 2>/dev/null
  local n=0
  while kill -0 "$1"; do
    if [ $((n % 15)) -eq 0 ]; then printf . || return 0; fi
    n=$((n + 1))
    sleep 1
  done
}

rc=0
# Scratch for this run: the upload's messages, and a stamp from before the run (a notes.txt older
# than it is from an earlier run).
RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/remote.XXXXXX")
: > "$RUN_TMP/stamp"
UP_LOG=$RUN_TMP/upload.log
# In the background, so a TERM or Ctrl-C reaches the trap at once instead of after ssh returns.
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$HOST" "$REMOTE_CMD" < <(heartbeat $$) &
SSH_PID=$!
# Keep the Mac awake meanwhile: once it sleeps for over 60 s the heartbeat stops and so does the run.
if command -v caffeinate >/dev/null 2>&1; then caffeinate -i -w "$SSH_PID" </dev/null >/dev/null 2>&1 & fi
trap 'kill "$SSH_PID" ${UP_PID:-} 2>/dev/null; cleanup >/dev/null; rm -rf "$RUN_TMP"; exit 130' INT TERM

# Upload once the run holds the lane (the server end, remote-upload.sh, waits for that). Excluded
# paths stay on the server between runs (.video-cache: video frames and mezzanines, which must
# survive an npm ci that clears node_modules). Owners are not copied: the run gives the folder to the
# container user.
rsync -a --no-owner --no-group --delete -e "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3" \
  --rsync-path="$(rsync_path "$(cat "$ROOT/scripts/remote-upload.sh")" remote-upload "$NAME" "$LANE")" \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude test-results --exclude playwright-report --exclude .video-cache \
  "$ROOT/" "$HOST:$REMOTE_DIR/" 2>"$UP_LOG" &
UP_PID=$!
# Stop waiting for it if the run ends first (gave up on the lane, lost connection).
while kill -0 "$UP_PID" 2>/dev/null; do
  kill -0 "$SSH_PID" 2>/dev/null || { kill "$UP_PID" 2>/dev/null; break; }
  sleep 0.5
done
up_rc=0
wait "$UP_PID" || up_rc=$?
# What rsync said matters only while the run goes on; once the run has ended (gave up on the lane,
# lost connection) the upload was cut short on purpose and the run says why.
if kill -0 "$SSH_PID" 2>/dev/null; then
  cat "$UP_LOG" >&2
  if [ "$up_rc" -ne 0 ]; then
    echo "remote.sh: the upload to $HOST failed (rsync exit $up_rc); stopping the run" >&2
    kill "$SSH_PID" 2>/dev/null
    cleanup >/dev/null
    rm -rf "$RUN_TMP"
    exit 3
  fi
fi
wait "$SSH_PID" || rc=$?
trap - INT TERM
# ssh exits 255 when the connection fails, and also when the command itself does.
if [ "$rc" -eq 255 ] && [ "$(cleanup)" != "command exited 255" ]; then
  echo "remote.sh: lost the connection to $HOST; stopping the run there" >&2
fi

# The run copied each pull target to $PULL_DIR/<name>/ (no container sees it); fetch it from there,
# again without links, devices or special files, and remove it on the server afterwards.
PULL_SH='dir=/root/shadowlocks/pulls/$1 p=$2
shift 2
rsync "$@"
rc=$?
rm -rf "$dir/$p"
rmdir "$dir" 2>/dev/null
exit $rc'
for p in ${PULLS[@]+"${PULLS[@]}"}; do
  if rsync -a --no-links --no-devices --no-specials --delete \
    --rsync-path="$(rsync_path "$PULL_SH" remote-pull "$NAME" "$p")" \
    "$HOST:$PULL_DIR/$NAME/$p" "$ROOT/"; then
    # Only a notes.txt this run wrote (newer than the stamp; a failed pull, or a run that did not
    # write one, leaves an old one in place), only a regular file, its first 4 KB, printable ASCII
    # only: the container wrote it.
    f=$ROOT/$p/notes.txt
    if [ -f "$f" ] && [ ! -L "$f" ] && [ -s "$f" ] && [ -n "$(find "$f" -newer "$RUN_TMP/stamp" 2>/dev/null)" ]; then
      echo
      echo "Notes from $p/notes.txt:"
      head -c 4096 "$f" | LC_ALL=C tr -cd '\11\12\40-\176' | sed 's/^/  /' || true
    fi
  else
    echo "warning: could not pull $p" >&2
  fi
done

rm -rf "$RUN_TMP"
exit "$rc"
