#!/usr/bin/env bash
# Render demo video shots (tests/video) on the build server, frame by frame on the virtual clock.
# Slow by nature: about 0.9 s of server time per 720p frame and 1.9 s at 1080p (55 and 110 s per
# second of video).
# Usage: scripts/video.sh [--detach] [--shots a,b] [--edit name] [--final] [--size WxH] [--fps n]
#                         [--hfov deg] [--crf n] [--fresh] [--reuse-stale] [--keep-frames]
#                         [--stop-after n] [--expect-gb n]
#        scripts/video.sh --status | --pull | --stop
#   --shots a,b     shots to render (tests/video/shots/<name>.ts), in order; finished ones are reused
#   --edit name     then cut the edit <name> (tests/video/edits.ts) from rendered shots
#   --final         1920x1080 x264 CRF 18 (default: the 1280x720 draft)
#   --crf n         x264 CRF of the delivery encode (a change re-encodes from the mezzanine only)
#   --fresh         ignore frames and finished shots from earlier runs (first attempt only)
#   --reuse-stale   reuse finished shots (and their mezzanines) made from an older app, image or shot
#                   (default: render them again); frames of a shot still in progress never carry over
#   --keep-frames   keep a shot's PNG frames after its mezzanine is verified (default: deleted)
#   --stop-after n  stop a shot after n new frames (to check that the next run resumes)
#   --expect-gb n   disk the frames of the shot in progress may take (default: 2 for drafts, 4 for
#                   --final): the server must have 100 + n GB free to start, and the render stops
#                   (resumably) when the frames pass n GB or the disk drops under 100 GB free
#   --detach        start the render on the server and return: it keeps going when this Mac sleeps
#                   or disconnects (server-side watchdog, the shared "e2e" lock, a stop after 20 min
#                   without progress, hard time limit: 3 h by default, NS_MAX_RUN seconds)
#   --status        state of the detached render: shot, frame i of N, ETA, load, free disk ("lost"
#                   when its watchdog died: --stop then cleans up)
#   --pull          fetch test-results/video/ (MP4s, contact sheets, stills, JSON) once it is done
#   --stop          stop the detached render (frames on disk stay and the next run resumes), cancel a
#                   queued one, or clean up after a lost watchdog
# Attached runs (no --detach) need this Mac awake and connected, as any remote.sh run. Both kinds wait
# until no other shadowlocks-e2e browser container runs, then hold the server-wide "e2e" lock that
# scripts/e2e.sh takes: one heavy browser at a time on the shared server. A long render therefore
# holds e2e runs of every lane back (they give up after NS_LOCK_WAIT s, default an hour, exit 75):
# render long cuts detached at quiet times, shot by shot.
# Output, pulled back to test-results/video/<width>x<height>-<fps>/: <shot>.mp4, <shot>-contact.png,
# <shot>-still-1..3.png, <shot>.json (events, cues, timings, loudness), <edit>.mp4/.json/-contact.png.
# Frames, lossless mezzanines, stems and work files stay on the server in the lane's
# .video-cache/ (kept across uploads and npm installs) and are never pulled.
set -euo pipefail

HOST=ioflood
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
MAX_LOAD=${NS_MAX_LOAD:-25}
# The floor the renders keep free (ruling: 100 GB plus what the frames may take).
export NS_MIN_FREE_GB=${NS_MIN_FREE_GB:-100}

ENVS=()
QUALITY=draft
EXPECT=
MODE=attached
while [ $# -gt 0 ]; do
  case $1 in
    --shots) ENVS+=("SHOTS=$2"); shift 2 ;;
    --edit) ENVS+=("EDIT=$2"); shift 2 ;;
    --final) QUALITY=final; shift ;;
    --size) ENVS+=("SIZE=$2"); shift 2 ;;
    --fps) ENVS+=("FPS=$2"); shift 2 ;;
    --hfov) ENVS+=("HFOV=$2"); shift 2 ;;
    --crf) ENVS+=("CRF=$2"); shift 2 ;;
    --fresh) ENVS+=(FRESH=1); shift ;;
    --reuse-stale) ENVS+=(REUSE_STALE=1); shift ;;
    --keep-frames) ENVS+=(KEEP_FRAMES=1); shift ;;
    --stop-after) ENVS+=("STOP_AFTER=$2"); shift 2 ;;
    --expect-gb) EXPECT=$2; shift 2 ;;
    --detach) MODE=detach; shift ;;
    --status) MODE=status; shift ;;
    --pull) MODE=pull; shift ;;
    --stop) MODE=stop; shift ;;
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
for kv in ${ENVS[@]+"${ENVS[@]}"}; do
  [[ $kv =~ ^[A-Z_][A-Z0-9_]*=[A-Za-z0-9_.,:x-]*$ ]] || { echo "bad value in $kv (letters, digits and _ . , : x - only)" >&2; exit 2; }
done

# The detached render's server side always comes from this checkout.
server() {
  ssh "$HOST" "bash -c $(printf '%q' "$(cat "$ROOT/scripts/video-detach-server.sh")") video-detach $(printf '%q ' "$@")"
}

case $MODE in
  status) server status "$LANE"; exit 0 ;;
  stop) server stop "$LANE"; exit 0 ;;
  pull)
    if server status "$LANE" | grep -q '"state":"\(queued\|running\)"'; then
      echo "the detached render is still going (video.sh --status); pull when it is done" >&2
      exit 3
    fi
    if ! busy=$(server probe "$LANE"); then echo "refused: $busy" >&2; exit 3; fi
    exec "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --pull test-results -- true ;;
esac

# 1080p PNG frames run about 1.3 MB, 720p about 0.7 MB; 4 GB covers a 50 s final shot.
if [ -z "$EXPECT" ]; then
  if [ "$QUALITY" = final ]; then EXPECT=4; else EXPECT=2; fi
fi
[[ $EXPECT =~ ^(0|[1-9][0-9]{0,3})$ ]] || { echo "bad --expect-gb: $EXPECT (whole GB, no leading zero)" >&2; exit 2; }
[[ $NS_MIN_FREE_GB =~ ^[0-9]{1,5}$ ]] || { echo "bad NS_MIN_FREE_GB: $NS_MIN_FREE_GB" >&2; exit 2; }
# Refuse at once when a render of this lane is queued or running (before the image check, the load
# wait and the upload, which would otherwise wait up to an hour for the lane lock).
if [ "$MODE" = detach ] && ! busy=$(server probe "$LANE"); then echo "refused: $busy" >&2; exit 3; fi
IMAGE_ID=$(ssh "$HOST" "docker image inspect shadowlocks-e2e --format '{{.Id}}'" 2>/dev/null) || {
  echo "image shadowlocks-e2e is missing on $HOST (or $HOST is unreachable): build it with scripts/e2e-image/build.sh" >&2
  exit 3
}
[[ $IMAGE_ID =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "unexpected image id: $IMAGE_ID" >&2; exit 3; }
ENVS+=("QUALITY=$QUALITY" "EXPECT_GB=$EXPECT" "MIN_FREE_GB=$NS_MIN_FREE_GB" "NS_IMAGE_ID=$IMAGE_ID")

# As scripts/e2e.sh: wait (up to an hour) while the server is busy or another browser container runs.
for _ in $(seq 1 120); do
  read -r load busy < <(ssh "$HOST" "echo \$(awk '{print \$1}' /proc/loadavg) \$(docker ps -q --filter ancestor=shadowlocks-e2e | wc -l)") \
    || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
  if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l<=m)}' && [ "$busy" -eq 0 ]; then break; fi
  echo "waiting: load $load, browser runs going $busy" >&2
  sleep 30
done
if [ "$busy" -gt 0 ]; then
  echo "refused: another browser run was still going after an hour of waiting (exit 75)" >&2
  exit 75
fi

# A render holds the shared e2e lock for as long as it runs: 3 h at most by default (a long final
# sets NS_MAX_RUN higher, in seconds), so a stuck one never keeps every lane's e2e runs out for long.
if [ "$MODE" = detach ]; then
  # Upload this worktree (and install dependencies) through the runner, then start on the server.
  "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e -- true
  # 10#: a leading zero (08) is decimal, not octal.
  server start "$LANE" "${NS_MAX_RUN:-10800}" "$((10#$NS_MIN_FREE_GB + 10#$EXPECT))" "${ENVS[@]}"
  exit 0
fi

# Attached: the runner's cap of 2 h is too short for long renders (3 h here; NS_MAX_RUN for more).
export NS_MAX_RUN=${NS_MAX_RUN:-10800}
RENV=()
for kv in "${ENVS[@]}"; do RENV+=(--env "$kv"); done
# The shared e2e lock (as scripts/e2e.sh takes it): one heavy browser on the server at a time.
exec "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --shm 2g --lock e2e --pull test-results \
  --expect-gb "$EXPECT" "${RENV[@]}" -- npx playwright test -c playwright.video.config.ts
