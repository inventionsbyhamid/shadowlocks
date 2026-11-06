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
#                perf-budget, bot, store or tests/video, ignoring case: timing-sensitive or long specs, or
#              - a spec filter also matches such a spec here (Playwright reads filters as patterns:
#                "lantern" runs lantern-cost.spec.ts too) or matches no spec here at all, or
#              - NS_E2E_EXCLUSIVE=1 is set.
#   functional anything else: up to two functional runs (of any lanes) go at once.
# An exclusive run waits until every other run has ended, and none starts while one waits or runs.
# scripts/e2e.sh --print-mode <args> says which kind a run would be.
#
# Waits up to 30 min while the server is busy (load > 25) or too many browser containers run (an
# exclusive run needs none, a functional one fewer than two; still too many after that: exit 75), then
# holds the "e2e" lock while the browser container runs: exclusively (remote.sh --lock e2e) or shared
# in one of two slots (remote.sh --lock-shared e2e). It gives up after NS_LOCK_WAIT seconds (default
# 3600) with exit 75. Older copies of this script hold the same lock exclusively, so they never
# overlap with any run of this one.
# A run that writes a lot (a video render) sets NS_EXPECT_GB=<n>: it then needs 100 + n GB free.
# Screenshots come back in test-results/shots/, failure reports in test-results/artifacts/, and
# notes the tests leave in test-results/notes.txt are printed at the end (remote.sh does that).
set -euo pipefail

HOST=ioflood
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
MAX_LOAD=${NS_MAX_LOAD:-25}

# Prints "exclusive" or "functional" for these Playwright arguments: the rule in the header. Spec
# filters are matched as Playwright does (a pattern, ignoring case, any :line dropped, against the
# spec's path in the container, /work/tests/...) against the spec files of this checkout.
e2e_mode() (
  shopt -s nocasematch
  hot='cost|perf-budget|bot|store|tests/video'
  linecol='^([^:]*):[0-9]+(:[0-9]+)?$'
  if [ "${NS_E2E_EXCLUSIVE:-}" = 1 ]; then echo exclusive; exit 0; fi
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
    n=0
    for f in $specs; do
      rc=0
      [[ /work/$f =~ $a ]] || rc=$?
      # 2: not a pattern bash can read, so what it runs is unknown.
      if [ "$rc" -eq 2 ]; then echo exclusive; exit 0; fi
      if [ "$rc" -eq 0 ]; then
        n=$((n + 1))
        if [[ $f =~ $hot ]]; then echo exclusive; exit 0; fi
      fi
    done
    if [ "$n" -eq 0 ]; then echo exclusive; exit 0; fi
  done
  if [ "$filters" -gt 0 ]; then echo functional; else echo exclusive; fi
)

if [ "${1:-}" = --print-mode ]; then
  shift
  e2e_mode "$@"
  exit 0
fi

LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
MODE=$(e2e_mode "$@")
if [ "$MODE" = exclusive ]; then
  MAX_BUSY=0 LOCK_OPT=--lock
else
  MAX_BUSY=1 LOCK_OPT=--lock-shared
fi
echo "e2e: $MODE run (scripts/e2e.sh header)" >&2

ssh "$HOST" "docker image inspect shadowlocks-e2e >/dev/null 2>&1" || {
  echo "image shadowlocks-e2e is missing on $HOST: build it with scripts/e2e-image/build.sh" >&2
  exit 3
}

for _ in $(seq 1 60); do
  read -r load busy < <(ssh "$HOST" "echo \$(awk '{print \$1}' /proc/loadavg) \$(docker ps -q --filter ancestor=shadowlocks-e2e | wc -l)") \
    || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
  if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l<=m)}' && [ "$busy" -le "$MAX_BUSY" ]; then break; fi
  echo "waiting: load $load, e2e runs going $busy (a $MODE run starts with at most $MAX_BUSY)" >&2
  sleep 30
done
if [ "$busy" -gt "$MAX_BUSY" ]; then
  echo "refused: $busy browser runs were still going after 30 minutes of waiting (exit 75)" >&2
  exit 75
fi

exec "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --shm 2g "$LOCK_OPT" e2e --pull test-results \
  ${NS_EXPECT_GB:+--expect-gb "$NS_EXPECT_GB"} -- npx playwright test "$@"
