#!/usr/bin/env bash
# Runs ON THE BUILD SERVER as root. remote.sh sends this text from the local checkout on the command
# line; it never runs the lane's copy there, which containers can write. Stops one run for good:
#   1. SIGKILL its whole process group (lock waiter, docker client, docker wait). SIGKILL, because a
#      docker client catches TERM and could still start the container afterwards.
#   2. docker rm -f the container, also one created but not started yet, three times over ~5 s in
#      case dockerd finishes a create that was already in flight.
#   3. For an APK build (remote.sh --signing-key: remote-run.sh leaves locks/<name>.signing until its
#      finish, which step 1 keeps from running), removes the keystore's folder, after step 1 and again
#      after step 2.
# Run it from outside the run's process group (setsid), since step 1 kills that group.
# Usage: remote-stop.sh <container name> <lane>   (NS_STOP_DRY=1: only say what it would kill; for tests)
set -u
NAME=${1:-} LANE=${2:-}
[[ $NAME =~ ^shadowlocks-[A-Za-z0-9_-]+$ ]] || { echo "remote-stop: bad name '$NAME'" >&2; exit 2; }
[[ $LANE =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ && $NAME == "shadowlocks-$LANE-"* ]] \
  || { echo "remote-stop: bad lane '$LANE' for '$NAME'" >&2; exit 2; }
LOCKS=/root/shadowlocks/locks
FILE=$LOCKS/$NAME.pgid
# The folder of remote.sh's SIGNING_STORE (remote-run.sh names the same path).
STORE_DIR=/root/shadowlocks/twa-key

# The run already ended with its command's own exit 255, which the client cannot tell apart from a
# lost connection: nothing to stop, say so.
if [ -e "$LOCKS/$NAME.exit255" ] && [ -z "${NS_STOP_DRY:-}" ]; then
  rm -f "$LOCKS/$NAME.exit255"
  echo "command exited 255"
  exit 0
fi

p=$(cat "$FILE" 2>/dev/null || true)
# Only kill a group that is really this run's: numeric, not init, a group leader, and remote-run.sh
# started for $NAME.
if [[ $p =~ ^[0-9]+$ ]] && [ "$p" -gt 1 ] \
  && [ "$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')" = "$p" ] \
  && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF " remote-run $NAME $LANE "; then
  if [ -n "${NS_STOP_DRY:-}" ]; then echo "would kill group $p"; else kill -KILL -- "-$p" 2>/dev/null; fi
elif [ -n "${NS_STOP_DRY:-}" ]; then
  echo "refused pid '$p'"
fi
[ -n "${NS_STOP_DRY:-}" ] && exit 0
# A signing run's keystore: its finish never ran, so it goes here.
SIGNING=0
if [ -e "$LOCKS/$NAME.signing" ]; then SIGNING=1; rm -rf "$STORE_DIR"; fi
rm -f "$FILE" "$LOCKS/$NAME.exit255" "$LOCKS/$NAME.uploaded"
if [ "$(cat "$LOCKS/lane-$LANE.owner" 2>/dev/null)" = "$NAME" ]; then rm -f "$LOCKS/lane-$LANE.owner"; fi
rm -rf "/root/shadowlocks/pulls/$NAME"
for d in 0 2 3; do
  sleep "$d"
  docker rm -f "$NAME" >/dev/null 2>&1
done
# Again, now that no container of the run can be created: a create dockerd finished after the kill would
# have made the keystore mount's missing source again, as an empty folder.
if [ "$SIGNING" = 1 ]; then rm -rf "$STORE_DIR"; rm -f "$LOCKS/$NAME.signing"; fi
exit 0
