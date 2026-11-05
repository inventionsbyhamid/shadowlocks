#!/usr/bin/env bash
# Runs ON THE BUILD SERVER as root: a detached video render, one that keeps going when the Mac sleeps
# or disconnects. scripts/video.sh sends this text from the local checkout over ssh (the lane's copy,
# which containers can write, is never run here) and calls it as:
#   probe <lane>                                  exit 3 if a render of the lane is queued or running
#   start <lane> <max run s> <need GB> <K=V>...   start the render detached; returns at once
#   status <lane>                                 print the status file (a dead watchdog shows as lost)
#   stop <lane>                                   stop the render (resumable: frames on disk stay), cancel
#                                                 a queued one, or clean up after a lost watchdog
# The render: container shadowlocks-e2e-video-<lane> (image shadowlocks-e2e, 6 CPUs, 8 GB, at most
# 2048 processes, uid 1000, no capabilities, no-new-privileges, scripts/ read-only) running the video
# Playwright config under its own hard `timeout`. It takes the lane lock, the lane's write lock and
# then the server-wide "e2e" lock that scripts/e2e.sh runs take (one heavy browser at a time on the
# shared server), in that order as remote-run.sh does, and holds them for as long as it runs; its
# name and image put it in e2e.sh's wait for other browser containers too. A watchdog here, outside
# the container, checks every 30 s and stops the container (it resumes later from its frames) when
# the free disk drops under the floor or the load stays over 25 for 5 minutes, and kills it at its
# time limit plus 300 s whatever the container does. It writes
# /root/shadowlocks/video/<lane>/status.json (state, shot, frame i of N, ETA, load, free disk) and
# keeps the container's log in last.log when it ends. One watchdog per lane: it holds watchdog.lock
# there from `start` to its end, and its pid is in watchdog.pid (root-only folder).
set -u
CMD=${1:-} LANE=${2:-}
[[ $LANE =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "video-detach: bad lane '$LANE'" >&2; exit 2; }
NAME=shadowlocks-e2e-video-$LANE
DIR=/root/shadowlocks/lanes/$LANE
LOCKS=/root/shadowlocks/locks
STATE=/root/shadowlocks/video/$LANE
IMAGE=shadowlocks-e2e
RUN_USER=1000:1000
NPM_VOLUME=shadowlocks-npm-user
FLOOR_GB=${NS_VIDEO_FLOOR_GB:-100}
# Seconds past the container's own time limit at which the host kills it (negative only to test it).
BACKSTOP=${NS_VIDEO_BACKSTOP_S:-300}
# Whole numbers without leading zeros (bash would read 010 as octal).
[[ $BACKSTOP =~ ^-?(0|[1-9][0-9]{0,4})$ ]] || { echo "video-detach: bad NS_VIDEO_BACKSTOP_S '$BACKSTOP'" >&2; exit 2; }
valid_run() { [[ ${1:-} =~ ^[1-9][0-9]{0,5}$ ]] && [[ ${2:-} =~ ^(0|[1-9][0-9]{0,4})$ ]]; }
MAX_LOAD=25
mkdir -p "$STATE" "$LOCKS"
chmod 700 /root/shadowlocks/video "$STATE"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
exists() { docker inspect --type container "$NAME" >/dev/null 2>&1; }
# A watchdog of this lane holds watchdog.lock from `start` until it ends.
watchdog_alive() { ! flock -n "$STATE/watchdog.lock" true; }
# Container output is untrusted: keep only a strict JSON shape from a tagged line ($1: tag, $2: where
# from: the live container or the kept log).
tagged() {
  local line
  line=$({ if [ "$2" = live ]; then docker logs --tail 400 "$NAME" 2>&1; else tail -n 400 "$STATE/last.log" 2>/dev/null; fi; } |
    grep -o "\[$1\] {[^}]*}" | tail -1 | sed "s/^\[$1\] //")
  if [[ $line =~ ^\{[A-Za-z0-9_\":,.\ -]*\}$ ]]; then printf '%s' "$line"; else printf 'null'; fi
}
status() { # state reason [progress source: live | log | none]
  local free load prog=null
  free=$(df -BG --output=avail "$DIR" 2>/dev/null | tail -1 | tr -dc 0-9)
  load=$(awk '{print $1}' /proc/loadavg)
  case ${3:-none} in live) prog=$(tagged video-status live) ;; log) prog=$(tagged video-status log) ;; esac
  printf '{"state":"%s","reason":"%s","container":"%s","started":"%s","updated":"%s","maxRunS":%s,"load":%s,"freeGb":%s,"progress":%s}\n' \
    "$1" "$2" "$NAME" "${STARTED:-}" "$(now)" "${MAX_RUN:-0}" "${load:-0}" "${free:-0}" "$prog" > "$STATE/status.json.tmp"
  mv "$STATE/status.json.tmp" "$STATE/status.json"
}
# The state field of status.json (none when there is no file).
state_now() { sed -n 's/^{"state":"\([a-z]*\)".*/\1/p' "$STATE/status.json" 2>/dev/null | head -1; }
field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$STATE/status.json" 2>/dev/null | head -1; }
# How the tests ended, from the kept log. Each attempt of a test prints [video-attempt] first, a shot
# that stops itself for the disk prints [video-stop], and every attempt ends with [video-result]
# (Playwright's status). Only each test's LAST attempt counts, and only lines the render's own log
# prints ("[video hh:mm:ss] [tag] {"), never code quoted in an error report. Prints "failed" when a
# test's last attempt failed without a stop, else "stopped <its stop JSON>" when one stopped, else ok.
outcome() {
  awk '
    function name(line) { if (match(line, /"test":"[^"]*"/)) return substr(line, RSTART + 8, RLENGTH - 9); return "" }
    /^\[video [0-9:]+\] \[video-attempt\] \{/ { t = name($0); stop[t] = ""; res[t] = "none"; cur = t }
    /^\[video [0-9:]+\] \[video-stop\] \{/ { if (match($0, /\{.*\}/)) stop[cur] = substr($0, RSTART, RLENGTH) }
    /^\[video [0-9:]+\] \[video-result\] \{/ { t = name($0); if (match($0, /"status":"[a-zA-Z]*"/)) res[t] = substr($0, RSTART + 10, RLENGTH - 11) }
    END {
      failed = 0; first = ""
      for (t in res) {
        if (res[t] == "passed" || res[t] == "skipped") continue
        if (stop[t] != "") { if (first == "") first = stop[t] } else failed = 1
      }
      if (failed) print "failed"; else if (first != "") print "stopped " first; else print "ok"
    }' "$STATE/last.log" 2>/dev/null
}
# The watchdog's pid when it is alive and really ours: numeric, its own group leader (setsid), and
# running this script for this lane.
watchdog_pid() {
  local p
  p=$(cat "$STATE/watchdog.pid" 2>/dev/null || true)
  [[ $p =~ ^[0-9]+$ ]] && [ "$p" -gt 1 ] || return 1
  [ "$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')" = "$p" ] || return 1
  tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF " video-detach run $LANE " || return 1
  echo "$p"
}

case $CMD in
  probe)
    if watchdog_alive; then echo "a render of lane $LANE is $(state_now) (video.sh --status / --stop)"; exit 3; fi
    if exists; then echo "$NAME is still there from an earlier run (video.sh --stop removes it)"; exit 3; fi
    echo free
    exit 0 ;;
  status)
    # A watchdog that died (out of memory, a server restart) cannot update the file: say so. Check
    # it first: a live watchdog may write its outcome between our read and our check; a dead one never.
    if ! watchdog_alive; then
      case $(state_now) in
        queued|running)
          STARTED=$(field started) MAX_RUN=0 status lost "the watchdog is gone (server restart or out of memory); video.sh --stop cleans up" none ;;
      esac
    fi
    cat "$STATE/status.json" 2>/dev/null || echo '{"state":"none"}'
    if exists; then docker ps -a --filter "name=^/$NAME$" --format 'container {{.Names}}: {{.Status}}'; fi
    exit 0 ;;
  stop)
    if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ] && watchdog_alive; then
      touch "$STATE/stop-requested"
      docker stop -t 60 "$NAME" >/dev/null
      echo "stopping $NAME (frames on disk stay; video.sh --detach resumes)"
      exit 0
    fi
    if watchdog_alive && [ "$(state_now)" != queued ]; then
      # The render just ended and its watchdog is writing the outcome: leave it, report that.
      for _ in $(seq 1 90); do watchdog_alive || break; sleep 1; done
      echo "the render had already ended: $(state_now) $(field reason)"
      exit 0
    fi
    if watchdog_alive; then
      # Queued (waiting for locks): end the watchdog's whole group.
      if p=$(watchdog_pid); then
        kill -TERM -- "-$p" 2>/dev/null
        for _ in $(seq 1 20); do watchdog_alive || break; sleep 0.5; done
      fi
      if watchdog_alive; then echo "video-detach: the watchdog of lane $LANE did not end; try again" >&2; exit 3; fi
      if exists; then docker logs "$NAME" >"$STATE/last.log" 2>&1; docker rm -f "$NAME" >/dev/null 2>&1; fi
      STARTED=$(sed -n 's/.*"started":"\([^"]*\)".*/\1/p' "$STATE/status.json" 2>/dev/null) status stopped "cancelled before it started" none
      echo "cancelled the queued render of lane $LANE"
      exit 0
    fi
    lost=
    case $(state_now) in queued|running|lost) lost=1 ;; esac
    if exists; then
      # Left over without a watchdog (it died): keep its log and remove it.
      docker stop -t 60 "$NAME" >/dev/null 2>&1
      docker logs "$NAME" >"$STATE/last.log" 2>&1
      docker rm -f "$NAME" >/dev/null 2>&1
      echo "removed $NAME left without a watchdog (log in $STATE/last.log)"
    fi
    if [ -n "$lost" ]; then
      STARTED=$(field started) MAX_RUN=0 status stopped "cleaned up after its watchdog was lost; frames on disk stay" log
      echo "status fixed: stopped (video.sh --detach resumes)"
      exit 0
    fi
    exists || echo "no detached render of lane $LANE is queued or running"
    exit 0 ;;
  start)
    MAX_RUN=${3:-} NEED_GB=${4:-}
    valid_run "$MAX_RUN" "$NEED_GB" || { echo "video-detach: bad max run '$MAX_RUN' or need GB '$NEED_GB'" >&2; exit 2; }
    for kv in "${@:5}"; do
      [[ $kv =~ ^[A-Z_][A-Z0-9_]*=[A-Za-z0-9_.,:x-]*$ ]] || { echo "video-detach: bad env '$kv'" >&2; exit 2; }
    done
    [ -d "$DIR" ] || { echo "video-detach: no lane folder $DIR (upload first)" >&2; exit 3; }
    # One watchdog per lane: take its lock here; the watchdog inherits it (fd 6) and holds it to the
    # end, so a second start can never slip in between.
    exec 6>"$STATE/watchdog.lock"
    flock -n 6 || { echo "video-detach: a render of lane $LANE is already queued or running (video.sh --status / --stop)" >&2; exit 3; }
    if exists; then echo "video-detach: $NAME is still there from an earlier run (video.sh --stop removes it)" >&2; exit 3; fi
    docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "video-detach: image $IMAGE is missing" >&2; exit 3; }
    rm -f "$STATE/stop-requested" "$STATE/watchdog.pid"
    STARTED=$(now) status queued "waiting for the lane and the e2e lock" none
    # The watchdog runs on in its own session; this ssh call returns now.
    NS_VIDEO_STARTED=$(now) setsid -f bash -c "$BASH_EXECUTION_STRING" video-detach run "$LANE" "$MAX_RUN" "$NEED_GB" "${@:5}" \
      </dev/null >>"$STATE/watchdog.log" 2>&1
    echo "detached: $NAME queued (video.sh --status)"
    exit 0 ;;
  run) ;;
  *) echo "usage: video-detach probe|start|status|stop <lane> ..." >&2; exit 2 ;;
esac

# ---- run: the detached watchdog (own session, output in watchdog.log) ----
MAX_RUN=${3:-} NEED_GB=${4:-}
valid_run "$MAX_RUN" "$NEED_GB" || { echo "$(now) video-detach run: bad max run '$MAX_RUN' or need GB '$NEED_GB'"; exit 2; }
# Only a watchdog started by `start` runs: it must hold watchdog.lock on fd 6.
if [ "$(readlink "/proc/$$/fd/6" 2>/dev/null)" != "$STATE/watchdog.lock" ] || ! watchdog_alive; then
  echo "$(now) video-detach run: not started by start (no watchdog.lock on fd 6); refusing"
  exit 3
fi
shift 4
STARTED=${NS_VIDEO_STARTED:-$(now)}
ENVS=()
for kv in "$@"; do ENVS+=(-e "$kv"); done
echo $$ > "$STATE/watchdog.pid"
echo "$(now) $NAME: waiting for the lane, its folder and the e2e lock"
# Same order as remote-run.sh (lane, write, then the shared lock last), so an attached and a detached
# render of one lane can never hold each other's locks, and a queued watchdog never sits on the e2e
# lock while it waits for its lane.
exec 7>"$LOCKS/lane-$LANE.lock"
flock -w 3600 7 || { status failed "another run of lane $LANE went on for an hour"; exit 75; }
exec 8>"$LOCKS/lane-$LANE.write.lock"
flock -w 600 8 || { status failed "the lane folder stayed busy"; exit 3; }
exec 9>"$LOCKS/e2e.lock"
flock -w 3600 9 || { status failed "the e2e lock stayed busy for an hour"; exit 75; }
lane_clear() { local ids; ids=$(docker ps -aq --filter "label=shadowlocks.lane=$LANE") && [ -z "$ids" ]; }
for _ in $(seq 1 30); do lane_clear && break; sleep 1; done
lane_clear || { status failed "a container of lane $LANE is still there"; exit 3; }
free=$(df -BG --output=avail "$DIR" | tail -1 | tr -dc 0-9)
[ "${free:-0}" -ge "$NEED_GB" ] || { status failed "free disk ${free:-?} GB < $NEED_GB GB"; exit 3; }
load=$(awk '{print $1}' /proc/loadavg)
awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l<=m)}' || { status failed "load $load > $MAX_LOAD"; exit 3; }
# Never through a link (-h, find's default), as remote-run.sh does.
find "$DIR" -xdev \( ! -uid "${RUN_USER%:*}" -o ! -gid "${RUN_USER#*:}" \) -exec chown -h "$RUN_USER" {} +
INNER='set -e
sum=$(cat package.json package-lock.json 2>/dev/null | sha256sum | cut -d" " -f1)
if [ ! -d node_modules ] || [ "$(cat node_modules/.install-sum 2>/dev/null)" != "$sum" ]; then
  npm ci --no-audit --no-fund --prefer-offline >/dev/null
  echo "$sum" > node_modules/.install-sum
fi
exec "$@"'
docker volume create "$NPM_VOLUME" >/dev/null
if ! docker run -d --name "$NAME" --label "shadowlocks.lane=$LANE" --label shadowlocks.video=detached \
  --cpus 6 --memory 8g --pids-limit 2048 --shm-size 2g --pull never \
  --user "$RUN_USER" --cap-drop ALL --security-opt no-new-privileges -e npm_config_cache=/npm-cache "${ENVS[@]}" \
  -v "$DIR:/work" -v "$DIR/scripts:/work/scripts:ro" -v "$NPM_VOLUME:/npm-cache" -w /work \
  "$IMAGE" bash -lc "$INNER" _ timeout --signal=TERM --kill-after=120 "${MAX_RUN}s" \
  npx playwright test -c playwright.video.config.ts >/dev/null; then
  status failed "docker run failed"
  exit 3
fi
echo "$(now) $NAME: started"
reason=
high=0
# Wall-clock backstop on the host: the container's own timeout covers the render, not the npm ci
# before it or a container that ignores TERM.
deadline=$((SECONDS + MAX_RUN + BACKSTOP))
while [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; do
  status running "" live
  free=$(df -BG --output=avail "$DIR" | tail -1 | tr -dc 0-9)
  load=$(awk '{print $1}' /proc/loadavg)
  if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l>m)}'; then high=$((high + 1)); else high=0; fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    reason="ran past its $MAX_RUN s limit plus $BACKSTOP s; killed"
    echo "$(now) $NAME: $reason"
    docker kill "$NAME" >/dev/null 2>&1
    break
  fi
  if [ "${free:-0}" -lt "$FLOOR_GB" ]; then reason="free disk $free GB < $FLOOR_GB GB"
  elif [ "$high" -ge 10 ]; then reason="load over $MAX_LOAD for 5 minutes"
  fi
  if [ -n "$reason" ]; then
    echo "$(now) $NAME: $reason; stopping it (frames stay, it resumes)"
    docker stop -t 60 "$NAME" >/dev/null
    break
  fi
  sleep 30
done
docker wait "$NAME" >/dev/null 2>&1
code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME" 2>/dev/null || echo 1)
docker logs "$NAME" >"$STATE/last.log" 2>&1
docker rm -f "$NAME" >/dev/null 2>&1
# A shot that stopped itself for the disk ends "stopped" (frames kept, it resumes), but only when no
# other test's last attempt failed for a real reason.
how=$(outcome)
if [ -e "$STATE/stop-requested" ]; then state=stopped reason="stopped on request"
elif [ -n "$reason" ]; then state=stopped
elif [ "$code" = 0 ]; then state=done
elif [ "$code" = 124 ]; then state=stopped reason="ran longer than $MAX_RUN s"
elif [[ $how == stopped* ]]; then
  json=${how#stopped }
  if [[ $json =~ ^\{[A-Za-z0-9_\":,.\ -]*\}$ ]]; then reason=$(printf '%s' "$json" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p'); fi
  state=stopped reason=${reason:-"stopped for the disk"}
else state=failed reason="exit $code (see last.log)"
fi
rm -f "$STATE/stop-requested" "$STATE/watchdog.pid"
status "$state" "$reason" log
echo "$(now) $NAME: $state ${reason:-}"
