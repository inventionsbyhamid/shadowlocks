#!/usr/bin/env bash
# Run the Playwright e2e tests on the build server in the shadowlocks-e2e image.
# Usage: scripts/e2e.sh [playwright args...]   e.g. scripts/e2e.sh tests/e2e/boot.spec.ts
# Lane: $NS_LANE, else this worktree's branch lane/<name>, else "main".
# Waits up to 30 min while the server is busy (load > 25) or another browser container runs (still
# one after that: exit 75), then holds the server-wide "e2e" lock while the browser container runs,
# so two lanes never render at once (gives up after NS_LOCK_WAIT seconds, default 3600, with exit 75).
# A run that writes a lot (a video render) sets NS_EXPECT_GB=<n>: it then needs 100 + n GB free.
# Screenshots come back in test-results/shots/, failure reports in test-results/artifacts/, and
# notes the tests leave in test-results/notes.txt are printed at the end (remote.sh does that).
set -euo pipefail

HOST=ioflood
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
LANE=${NS_LANE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's#^lane/##p')}
LANE=${LANE:-main}
MAX_LOAD=${NS_MAX_LOAD:-25}

ssh "$HOST" "docker image inspect shadowlocks-e2e >/dev/null 2>&1" || {
  echo "image shadowlocks-e2e is missing on $HOST: build it with scripts/e2e-image/build.sh" >&2
  exit 3
}

for _ in $(seq 1 60); do
  read -r load busy < <(ssh "$HOST" "echo \$(awk '{print \$1}' /proc/loadavg) \$(docker ps -q --filter ancestor=shadowlocks-e2e | wc -l)") \
    || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
  if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l<=m)}' && [ "$busy" -eq 0 ]; then break; fi
  echo "waiting: load $load, e2e runs going $busy" >&2
  sleep 30
done
if [ "$busy" -gt 0 ]; then
  echo "refused: another browser run was still going after 30 minutes of waiting (exit 75)" >&2
  exit 75
fi

exec "$ROOT/scripts/remote.sh" "$LANE" --image shadowlocks-e2e --shm 2g --lock e2e --pull test-results \
  ${NS_EXPECT_GB:+--expect-gb "$NS_EXPECT_GB"} -- npx playwright test "$@"
