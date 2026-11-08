#!/usr/bin/env bash
# Runs ON THE BUILD SERVER as root: the server side of one remote.sh run. remote.sh starts it as the
# leader of its own process group (setsid -w), with the client's heartbeat on stdin and the real
# stderr on fd 4, and sends this text from the local checkout: the lane's copy is never run.
# Usage: remote-run.sh <name> <lane> <lock or ""> <wait s> <max run s> <need GB> <pulls or ""> <uid:gid>
#                      <stop script text> <signing 0|1> <docker run args...>
#   <signing> 1 (remote.sh --signing-key): the first line of stdin, before the heartbeat, is the keystore
#   password. It is kept in this shell's memory and given to the container's stdin; the keystore at
#   SIGNING_STORE must be there. Its folder goes when this run ends (finish: the build's end, a lock wait
#   given up, a missing upload or keystore), or, when the run is stopped (remote-stop.sh's SIGKILL, so
#   finish never runs), by remote-stop.sh, which finds the locks/<name>.signing this run leaves until finish.
#   <lock> is <name> (held exclusively: remote.sh --lock) or <name>:<slots> (held shared, plus one of
#   <slots> slot locks: remote.sh --lock-shared). Both use the file locks/<name>.lock, so an exclusive
#   holder (from these scripts or older ones) and shared holders never overlap.
#   1. Writes its pid to <name>.pgid and starts a watchdog: when the heartbeat (a byte every 15 s)
#      ends or is silent for 60 s (Ctrl-C, killed client, dropped connection, sleeping laptop) it
#      runs the stop script outside this group, so no lock waiter or container is left behind.
#   2. Takes the lane lock: one run of a lane at a time. Names itself in lane-<lane>.owner, which
#      lets the client's upload in (remote-upload.sh), and waits for that upload.
#   3. Takes the lane's write lock: root writes the lane folder only while holding it and while no
#      container of the lane exists. The run holds it until its container is gone.
#   4. Hands the lane folder to the container's uid:gid, takes the server-wide lock if one is named
#      (on fd 9, a shared one's slot on fd 6, held until this script exits), checks the disk still
#      has <need GB> free (the waits may have been long) and runs the container, stopping it after
#      <max run s> (a hung run gives its locks back) or once the disk has under KEEP_FREE bytes free.
#   5. Still holding both lane locks, copies the pull targets to pulls/<name>/, a folder no container
#      sees, for the client to fetch: never through a link, without devices or special files, at
#      most PULL_MAX bytes per run, and only while KEEP_FREE bytes stay free on the disk.
set -u
exec 2>&4 4>&-
NAME=$1 LANE=$2 LOCK=$3 WAIT=$4 MAX_RUN=$5 NEED_GB=$6 PULLS=$7 RUN_USER=$8 STOP_SH=$9 SIGN=${10}
shift 10
# remote.sh's SIGNING_STORE: an APK build's keystore, only during that build.
SIGNING_STORE=/root/shadowlocks/twa-key/shadowlocks-android.keystore
# Unset first: a SECRET that came in exported stays exported through an assignment, and would hand the
# password to every program this script starts.
unset SECRET
SECRET=
if [ "$SIGN" = 1 ]; then IFS= read -r SECRET || SECRET=; fi
LOCKS=/root/shadowlocks/locks
DIR=/root/shadowlocks/lanes/$LANE
PULL_DIR=/root/shadowlocks/pulls
OWNER=$LOCKS/lane-$LANE.owner
PULL_MAX=$((2 * 1024 * 1024 * 1024))
KEEP_FREE=$((50 * 1024 * 1024 * 1024))

# A signing run's mark, before the pid file a stop looks for: remote-stop.sh then removes the keystore.
if [ "$SIGN" = 1 ]; then : > "$LOCKS/$NAME.signing"; fi
echo $$ > "$LOCKS/$NAME.pgid"
# The watchdog ignores SIGPIPE: its stderr may be the dead ssh channel.
exec 3<&0
( trap '' PIPE
  while IFS= read -r -n 1 -t 60 -u 3 _; do :; done
  echo "remote.sh: client gone, stopping $NAME" >&2
  setsid -f bash -c "$STOP_SH" remote-stop "$NAME" "$LANE" ) &
watch=$!

finish() {
  kill "$watch" 2>/dev/null
  # The keystore leaves the server with the run, built or not (and then the mark that would have had
  # remote-stop.sh remove it).
  if [ "$SIGN" = 1 ]; then rm -rf "$(dirname "$SIGNING_STORE")"; fi
  if [ "$(cat "$OWNER" 2>/dev/null)" = "$NAME" ]; then rm -f "$OWNER"; fi
  rm -f "$LOCKS/$NAME.pgid" "$LOCKS/$NAME.uploaded" "$LOCKS/$NAME.signing"
  if [ "$1" -eq 255 ]; then touch "$LOCKS/$NAME.exit255"; fi
  exit "$1"
}
# True only when docker answers and lists no container of this lane: an error counts as "not clear".
lane_clear() { local ids; ids=$(docker ps -aq --filter "label=shadowlocks.lane=$LANE") && [ -z "$ids" ]; }

# Shared hold of lock <name> with <slots> slots: first a free slot (<name>.slot<i>.lock, fd 6), then
# <name>.lock shared (fd 9), but only once no one waits for it exclusively. flock gives a new shared
# lock even while an exclusive request waits, so a stream of shared runs could keep a --lock run (or
# an older script's) out for good: a blocked exclusive request shows in /proc/locks as
# "-> FLOCK ADVISORY WRITE <pid> <major>:<minor>:<inode>" (device numbers in hex), and while one is
# there for this file, no new shared hold starts. Polls every 2 s; false (1) after WAIT s in all.
lock_shared() {
  # 10#: a leading zero (0600) is decimal, not octal.
  local name=$1 slots=$2 end=$((SECONDS + 10#$WAIT)) i st dev key
  while :; do
    for i in $(seq 1 "$slots"); do
      exec 6>"$LOCKS/$name.slot$i.lock"
      flock -n 6 && break 2
      exec 6>&-
    done
    [ "$SECONDS" -lt "$end" ] || return 1
    sleep 2
  done
  exec 9>"$LOCKS/$name.lock"
  # The file open on fd 9, as /proc/locks names it: the kernel's major and minor of st_dev, in hex.
  st=$(stat -L -c '%d %i' /dev/fd/9) && [[ $st =~ ^[0-9]+\ [0-9]+$ ]] || return 1
  dev=${st% *}
  key=$(printf '%02x:%02x:%s' $(((dev >> 8) & 0xfff)) $(((dev & 0xff) | ((dev >> 12) & 0xfff00))) "${st#* }")
  until ! grep -qE -- "-> FLOCK +ADVISORY +WRITE +[0-9]+ $key " /proc/locks && flock -n -s 9; do
    [ "$SECONDS" -lt "$end" ] || return 1
    sleep 2
  done
}

# Pull copies a client never fetched (it died after its run), from any lane.
find "$PULL_DIR" -mindepth 1 -maxdepth 1 -name 'shadowlocks-*' -mmin +1440 -exec rm -rf {} +

exec 7>"$LOCKS/lane-$LANE.lock"
if ! flock -w "$WAIT" 7; then
  echo "remote.sh: waited $WAIT s for another run of lane '$LANE' and gave up (exit 75)" >&2
  finish 75
fi
echo "$NAME" > "$OWNER"
for _ in $(seq 1 3000); do [ -e "$LOCKS/$NAME.uploaded" ] && break; sleep 0.2; done
rm -f "$OWNER"
[ -e "$LOCKS/$NAME.uploaded" ] || { echo "remote.sh: the upload did not arrive within 600 s" >&2; finish 3; }
rm -f "$LOCKS/$NAME.uploaded"

exec 8>"$LOCKS/lane-$LANE.write.lock"
flock -w 600 8 || { echo "remote.sh: the lane '$LANE' folder stayed busy for 600 s" >&2; finish 3; }
# A stopped run's container may still be going away.
for _ in $(seq 1 30); do lane_clear && break; sleep 1; done
lane_clear || { echo "remote.sh: a container of lane '$LANE' is still there (or docker did not answer); not starting" >&2; finish 3; }
# Uploads add root-owned files; the container user must own the folder to build and test in it.
# -h and find's default: never through a link.
find "$DIR" -xdev \( ! -uid "${RUN_USER%:*}" -o ! -gid "${RUN_USER#*:}" \) -exec chown -h "$RUN_USER" {} +

case $LOCK in
  "") ;;
  *:*)
    if ! lock_shared "${LOCK%%:*}" "${LOCK#*:}"; then
      echo "remote.sh: waited $WAIT s for the '${LOCK%%:*}' lock (shared, in one of ${LOCK#*:} slots) on the build server and gave up (exit 75)" >&2
      finish 75
    fi ;;
  *)
    exec 9>"$LOCKS/$LOCK.lock"
    if ! flock -w "$WAIT" 9; then
      echo "remote.sh: waited $WAIT s for the '$LOCK' lock on the build server and gave up (exit 75)" >&2
      finish 75
    fi ;;
esac
free=$(df -BG --output=avail "$DIR" 2>/dev/null | tail -1 | tr -dc 0-9)
if ! [[ $free =~ ^[0-9]+$ ]] || [ "$free" -lt "$NEED_GB" ]; then
  echo "remote.sh: free disk ${free:-unknown} GB < $NEED_GB GB on the build server; not starting (exit 3)" >&2
  finish 3
fi

# The limits: every 30 s the timer checks the run time (MAX_RUN) and the free disk (KEEP_FREE, the
# same floor the pull copies keep); past either it kills the container and then removes it every
# 2 s until the main path, which waits for the container to go, stops the timer: so a create still
# in flight is removed too, and so is a container that outlived its docker client. It keeps no lock
# descriptor, and stopping it (TERM) also ends its sleep.
( exec 0</dev/null >/dev/null 3<&- 6>&- 7>&- 8>&- 9>&-
  s=
  trap '[ -n "${s:-}" ] && kill "$s" 2>/dev/null; exit 0' TERM
  end=$((SECONDS + MAX_RUN))
  while :; do
    left=$((end - SECONDS))
    if [ "$left" -le 0 ]; then why="ran longer than $MAX_RUN s (NS_MAX_RUN)"; break; fi
    free=$(df -B1 --output=avail "$DIR" 2>/dev/null | tail -1 | tr -dc 0-9)
    if [[ $free =~ ^[0-9]+$ ]] && [ "$free" -lt "$KEEP_FREE" ]; then
      why="left under $((KEEP_FREE >> 30)) GB free on the disk"
      break
    fi
    sleep $((left < 30 ? left : 30)) &
    s=$!
    wait "$s" || exit 0
    s=
  done
  echo "remote.sh: $NAME $why; stopping it" >&2
  exec 2>/dev/null
  docker kill "$NAME"
  while :; do
    docker rm -f "$NAME"
    sleep 2 &
    s=$!
    wait "$s" || exit 0
    s=
  done ) &
timer=$!
if [ "$SIGN" = 1 ]; then
  # The keystore must be a plain file, readable by the container user alone; the password goes to the
  # container's stdin (printf is a builtin: no command line holds it).
  if [ -z "$SECRET" ] || [ ! -f "$SIGNING_STORE" ] || [ -L "$SIGNING_STORE" ]; then
    echo "remote.sh: --signing-key needs the keystore at $SIGNING_STORE and its password; not starting" >&2
    kill "$timer" 2>/dev/null
    finish 3
  fi
  chown "$RUN_USER" "$SIGNING_STORE" && chmod 400 "$SIGNING_STORE"
  printf '%s\n' "$SECRET" | "$@"
  rc=$?
  SECRET=
else
  "$@"
  rc=$?
fi
# Keep every lock until the container is gone, even if its docker client died first. docker wait
# returns at once for one that was only created (its client died first): remove that one now.
docker wait "$NAME" >/dev/null 2>&1
if docker inspect --type container "$NAME" >/dev/null 2>&1; then
  for d in 0 2 3; do sleep "$d"; docker rm -f "$NAME" >/dev/null 2>&1; done
fi
kill "$timer" 2>/dev/null

if [ -n "$PULLS" ]; then
  mkdir -p "$PULL_DIR/$NAME"
  left=$PULL_MAX
  for p in $PULLS; do
    src=$DIR/$p
    if [ -L "$src" ]; then echo "remote.sh: not pulling $p: it is a link" >&2; continue; fi
    [ -e "$src" ] && [ "$(realpath -e "$src")" = "$src" ] || continue
    # Apparent size, so a sparse file counts at its full length; -l counts every hard link, since the
    # copy (rsync without -H) and the Mac's fetch write each one in full.
    size=$(du -s -l --apparent-size -B1 "$src" 2>/dev/null | cut -f1)
    free=$(df -B1 --output=avail "$PULL_DIR" 2>/dev/null | tail -1 | tr -dc 0-9)
    if ! [[ $size =~ ^[0-9]+$ && $free =~ ^[0-9]+$ ]]; then
      echo "remote.sh: not pulling $p: could not measure it or the free disk" >&2
    elif [ "$size" -gt "$left" ]; then
      echo "remote.sh: not pulling $p: $((size >> 20)) MB, more than the $((left >> 20)) MB left of the $((PULL_MAX >> 20)) MB a run may pull" >&2
    elif [ $((free - size)) -lt "$KEEP_FREE" ]; then
      echo "remote.sh: not pulling $p: copying $((size >> 20)) MB would leave under $((KEEP_FREE >> 30)) GB free" >&2
    else
      rsync -a -S --max-size="$PULL_MAX" --no-links --no-devices --no-specials "$src" "$PULL_DIR/$NAME/"
      left=$((left - size))
    fi
  done
fi
finish $rc
