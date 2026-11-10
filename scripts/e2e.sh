#!/usr/bin/env bash
# Run the Playwright e2e tests on the build server in the shadowlocks-e2e image.
# Usage: scripts/e2e.sh [playwright args...]   e.g. scripts/e2e.sh tests/e2e/boot.spec.ts
#        scripts/e2e.sh --print-mode [playwright args...]   only print "functional" or "exclusive"
# Lane: $NS_LANE, else this worktree's branch lane/<name>, else "main".
#
# Two kinds of run share the server's browser slot (the server-wide "e2e" lock):
#   exclusive  runs alone: no other browser run of any lane goes meanwhile. A run is exclusive when
#              - it names no spec file (the full suite; a --grep alone still spans every spec), or
#              - any argument (a spec path or filter, a --grep, any option) contains cost,
#                perf-budget, bot, store, shadows, lantern or tests/video, ignoring case, or
#              - a spec filter is not a plain path or name (after an optional :line, only letters,
#                digits and . _ / -, and not /.../; anything else is a pattern this script does not
#                follow), or
#              - a spec filter matches a spec here whose name is one of those or which carries the
#                line "// e2e: exclusive" (every spec that gates on wall-clock time must), or matches
#                no spec here at all (Playwright reads filters as patterns: "hand" runs
#                hand-cost.spec.ts too), or
#              - NS_E2E_EXCLUSIVE is set to anything but empty or 0.
#   functional anything else: up to two functional runs (of any lanes) go at once.
# An exclusive run waits until every other run has ended. Once its lock request waits on the server
# (after the pre-wait below), no new run starts ahead of it; during its pre-wait on this Mac,
# functional runs still start. scripts/e2e.sh --print-mode <args> says which kind a run would be,
# --print-limits <args> also the load and browser runs it starts under.
#
# First waits up to NS_E2E_PREWAIT seconds (default 1800) while the server is busy or too many browser
# containers run. The gates (Ruling 111) are the named defaults below:
#   - a functional run starts at load FUNCTIONAL_MAX_LOAD (34, Ruling 111's gate) or
#     less, with fewer than FUNCTIONAL_SLOTS (2) browser runs going;
#   - an exclusive run starts at load EXCLUSIVE_MAX_LOAD (25) or less, with none going.
# NS_MAX_LOAD, when set, is the load limit for both, here and in remote.sh's own gate. Then:
#   - a functional run still facing FUNCTIONAL_SLOTS runs gives up (exit 75);
#   - an exclusive run queues for the lock anyway, and starts as soon as the runs holding it end.
# It then holds the "e2e" lock while the browser container runs: exclusively (remote.sh --lock e2e) or
# shared in one of two slots (remote.sh --lock-shared e2e). Waiting for the lock gives up after
# NS_LOCK_WAIT seconds (default 3600) with exit 75. Older copies of this script hold the same lock too:
# their functional runs shared, in one slot file each (copies older than the shared slots hold it
# exclusively). The four slot files keep all functional runs together within 24 CPUs (remote.sh's
# SHARED_SLOTS).
# CPUs: an exclusive run's container is pinned to remote.sh's TIMING_CPUS
# (all of NUMA node 1) with no CPU quota (remote.sh --timing-cpus), so the kernel never stops it
# mid-frame. A functional run gets an 11-CPU quota on any CPU (remote.sh's SHARED_QUOTA): the kernel
# may still stop it now and then, which costs time only, since functional specs time nothing on the
# wall clock and it never runs beside an exclusive run (the e2e lock).
# A run that writes a lot (a video render) sets NS_EXPECT_GB=<n>: it then needs 100 + n GB free.
# Screenshots come back in test-results/shots/, failure reports in test-results/artifacts/, and
# notes the tests leave in test-results/notes.txt are printed at the end (remote.sh does that).
set -euo pipefail

HOST=ioflood
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# The gates (Ruling 111; the header). FUNCTIONAL_SLOTS must equal remote.sh's SHARED_SLOTS.
FUNCTIONAL_SLOTS=2
FUNCTIONAL_MAX_LOAD=34
EXCLUSIVE_MAX_LOAD=25

# Prints "exclusive" or "functional" for these Playwright arguments: the rule in the header. Spec
# filters are matched as Playwright does (a pattern, ignoring case, any :line dropped, against the
# spec's path in the container, /work/tests/...) against the spec files of this checkout.
e2e_mode() (
  shopt -s nocasematch
  hot='cost|perf-budget|bot|store|shadows|lantern|tests/video'
  linecol='^([^:]*):[0-9]+(:[0-9]+)?$'
  plain='^[A-Za-z0-9._/-]+$'
  case ${NS_E2E_EXCLUSIVE:-0} in 0) ;; *) echo exclusive; exit 0 ;; esac
  specs=$(cd "$ROOT" && find tests -name '*.spec.ts' -type f 2>/dev/null) || specs=
  filters=0 skip=
  for a in "$@"; do
    if [[ $a =~ $hot ]]; then echo exclusive; exit 0; fi
    if [ -n "$skip" ]; then skip=; continue; fi
    case $a in
      # Playwright options that take the next argument as their value.
      -c|--config|-g|--grep|--grep-invert|-j|--workers|--project|--reporter|--retries|--repeat-each|\
      --timeout|--global-timeout|--max-failures|--output|--shard|--trace|--tsconfig) skip=1; continue ;;
      -*) continue ;;
    esac
    filters=$((filters + 1))
    if [[ $a =~ $linecol ]]; then a=${BASH_REMATCH[1]}; fi
    # /.../ is Playwright's own pattern form.
    if ! [[ $a =~ $plain ]] || [[ $a == /*/ ]]; then echo exclusive; exit 0; fi
    n=0
    for f in $specs; do
      [[ /work/$f =~ $a ]] || continue
      n=$((n + 1))
      if [[ $f =~ $hot ]] || grep -qF '// e2e: exclusive' "$ROOT/$f"; then echo exclusive; exit 0; fi
    done
    if [ "$n" -eq 0 ]; then echo exclusive; exit 0; fi
  done
  if [ "$filters" -gt 0 ]; then echo functional; else echo exclusive; fi
)

# Prints "<load limit> <browser runs that may be going>" for a run of this mode (the header).
e2e_limits() {
  if [ "$1" = exclusive ]; then
    echo "${NS_MAX_LOAD:-$EXCLUSIVE_MAX_LOAD} 0"
  else
    echo "${NS_MAX_LOAD:-$FUNCTIONAL_MAX_LOAD} $((FUNCTIONAL_SLOTS - 1))"
  fi
}

case ${1:-} in
  --print-mode) shift; e2e_mode "$@"; exit 0 ;;
  --print-limits) shift; m=$(e2e_mode "$@"); echo "$m $(e2e_limits "$m")"; exit 0 ;;
esac

LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
PREWAIT=${NS_E2E_PREWAIT:-1800}
[[ $PREWAIT =~ ^(0|[1-9][0-9]{0,5})$ ]] || { echo "bad NS_E2E_PREWAIT: $PREWAIT (whole seconds, no leading zero)" >&2; exit 2; }
MODE=$(e2e_mode "$@")
LIMITS=$(e2e_limits "$MODE")
MAX_LOAD=${LIMITS% *} MAX_BUSY=${LIMITS#* }
if [ "$MODE" = exclusive ]; then LOCK_OPTS=(--lock e2e --timing-cpus); else LOCK_OPTS=(--lock-shared e2e); fi
# remote.sh's own load gate uses the same limit.
export NS_MAX_LOAD=$MAX_LOAD
echo "e2e: $MODE run, starts at load $MAX_LOAD or less (scripts/e2e.sh header)" >&2

ssh "$HOST" "docker image inspect shadowlocks-e2e >/dev/null 2>&1" || {
  echo "image shadowlocks-e2e is missing on $HOST: build it with scripts/e2e-image/build.sh" >&2
  exit 3
}

end=$((SECONDS + PREWAIT))
while :; do
  read -r load busy < <(ssh "$HOST" "echo \$(awk '{print \$1}' /proc/loadavg) \$(docker ps -q --filter ancestor=shadowlocks-e2e | wc -l)") \
    || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
  if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l<=m)}' && [ "$busy" -le "$MAX_BUSY" ]; then break; fi
  left=$((end - SECONDS))
  [ "$left" -gt 0 ] || break
  echo "waiting: load $load, e2e runs going $busy ($MODE run: starts with at most $MAX_BUSY going)" >&2
  sleep $((left < 30 ? left : 30))
done
if [ "$busy" -gt "$MAX_BUSY" ]; then
  if [ "$MODE" = functional ]; then
    echo "refused: $busy browser runs were still going after $PREWAIT s of waiting (exit 75)" >&2
    exit 75
  fi
  # A load still over the limit is refused by remote.sh (exit 3), as before.
  echo "e2e: $busy browser runs still going after $PREWAIT s; queueing for the 'e2e' lock (once it waits there, no new run starts ahead of it)" >&2
fi

exec "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --shm 2g "${LOCK_OPTS[@]}" --pull test-results \
  ${NS_EXPECT_GB:+--expect-gb "$NS_EXPECT_GB"} -- npx playwright test "$@"
