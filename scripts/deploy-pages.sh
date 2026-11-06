#!/usr/bin/env bash
# Build the game for production on the build server and publish it to Cloudflare Pages: one build,
# to one Pages project or to both of ours (v1 serves the same build on both hosts).
# Usage: scripts/deploy-pages.sh (--both | --preview | --project <name>...) [--branch <name>] [--dry-run] [--allow-dirty]
#        scripts/deploy-pages.sh --verify <host>
#   --both            publish to shadowlocks (the public host, the store app) and shadowlocks-judge (the
#                     judge host, the Competition app)
#   --preview         a test link only: shadowlocks, branch preview, at preview.shadowlocks.pages.dev; the
#                     public and judge hosts stay as they are
#   --project <name>  a Pages project (lowercase letters, digits, hyphens); give it again for more
#   --branch <name>   Pages branch; the production branch (default main) is the live site,
#                     any other name makes a preview at <branch>.<project>.pages.dev
#   --create          create each project first (only for a new project; ours exist)
#   --dry-run         build and check only, and list what would be published; needs no token
#   --allow-dirty     publish a working tree with uncommitted changes (off by default)
#   --judge-after-deadline  publish to shadowlocks-judge after the competition deadline (refused otherwise)
#   --verify <host>   only check a live site, e.g. shadowlocks.pages.dev or a custom domain
#   --check-token     only check that the token in .secrets/cloudflare.env is active for the account
# Every publish starts with that check, then publishes; after publishing, each host it went to (<project>.pages.dev, or <branch>.<project>.pages.dev for a
# preview) is checked, its asset links byte for byte against the build's (the Quest apps open only
# when those match their package and key).
# A real publish reads CLOUDFLARE_API_TOKEN (a token with "Cloudflare Pages: Edit" only) and
# CLOUDFLARE_ACCOUNT_ID from .secrets/cloudflare.env next to the repo (NS_CLOUDFLARE_ENV overrides).
# The token may be account-owned: wrangler then needs CLOUDFLARE_ACCOUNT_ID (always set here) and
# `wrangler whoami` can fail, so the check uses /accounts/<id>/tokens/verify instead.
# The token is read only in the subshell that sends it, and reaches the server only on stdin: never
# in this script's variables, on a command line, or in a server-side environment outside the
# throwaway deploy container. Wrangler runs there, in shadowlocks-deploy-*. Free Pages features only.
# The build runs in lane NS_DEPLOY_LANE (default deploy).
set -euo pipefail

HOST=ioflood
WRANGLER=wrangler@4.150.0
IMAGE=node:22-bookworm
NPM_VOLUME=shadowlocks-npm-user
MAX_LOAD=${NS_MAX_LOAD:-25}
MIN_FREE_GB=${NS_MIN_FREE_GB:-100}
BUILD_LANE=${NS_DEPLOY_LANE:-deploy}
PUBLIC_PROJECT=shadowlocks
JUDGE_PROJECT=shadowlocks-judge
# 2026-11-18 20:00 UTC: after it, the judge host stays as the judges saw it.
DEADLINE_EPOCH=1795032000
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

usage() {
  sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

PROJECTS=() BRANCH=main CREATE=0 DRY=0 DIRTY=0 VERIFY= LATE_JUDGE=0 PREVIEW=0 CHECK_TOKEN=0
while [ $# -gt 0 ]; do
  case $1 in
    --both) PROJECTS+=("$PUBLIC_PROJECT" "$JUDGE_PROJECT"); shift ;;
    --check-token) CHECK_TOKEN=1; shift ;;
    --preview) PREVIEW=1; shift ;;
    --project) [ $# -ge 2 ] || usage; PROJECTS+=("$2"); shift 2 ;;
    --branch) [ $# -ge 2 ] || usage; BRANCH=$2; shift 2 ;;
    --create) CREATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --allow-dirty) DIRTY=1; shift ;;
    --judge-after-deadline) LATE_JUDGE=1; shift ;;
    --verify) [ $# -ge 2 ] || usage; VERIFY=$2; shift 2 ;;
    *) usage ;;
  esac
done

# The hosting contract: what the browser, the service worker and the Quest apps need from the site.
# head_ok and body_ok (scripts/http-check.sh) compare status, type, header and body literally.
. "$ROOT/scripts/http-check.sh"
verify() { # host, the asset links file the site must serve
  local host=$1 links=$2 bad=0
  check() { # path, status, types ("a|b"), header line (optional)
    head_ok "$(curl -s -o /dev/null -D - --max-time 20 "https://$host$1" || true)" "$@" || bad=1
  }
  check / 200 text/html "content-security-policy-report-only: default-src 'self'"
  check /manifest.webmanifest 200 application/manifest+json "cache-control: no-cache"
  check /sw.js 200 "application/javascript|text/javascript" "cache-control: no-cache"
  check /icons/icon-192.png 200 image/png
  check /icons/icon-512.png 200 image/png
  check /icons/icon-512-maskable.png 200 image/png
  # The store listing's privacy policy URL (Pages serves privacy.html at /privacy).
  check /privacy 200 text/html
  check /.well-known/assetlinks.json 200 application/json
  body_ok "$(curl -s --max-time 20 "https://$host/.well-known/assetlinks.json" || true)" /.well-known/assetlinks.json "$links" || bad=1
  # A missing URL gets the 404 page, not index.html with 200.
  check "/no-such-page-$RANDOM" 404 text/html
  if curl -s --max-time 20 "https://$host/privacy" | grep -q REPLACE_WITH_SUPPORT_EMAIL; then
    echo "note /privacy still has the placeholder support address (fill it before the store submission)"
  fi
  return $bad
}

if [ -n "$VERIFY" ]; then
  [[ $VERIFY =~ ^[A-Za-z0-9.-]+$ ]] || { echo "bad host: $VERIFY" >&2; exit 2; }
  # What the site should serve: the asset links committed here (redeploy after a fill).
  verify "$VERIFY" "$ROOT/public/.well-known/assetlinks.json"
  exit
fi

# The secrets file and the account id; the token itself is only checked for here and read in the
# subshell that sends it.
load_account() {
  SECRETS=${NS_CLOUDFLARE_ENV:-$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")/../.secrets/cloudflare.env}
  [ -f "$SECRETS" ] || { echo "missing $SECRETS (CLOUDFLARE_API_TOKEN=..., CLOUDFLARE_ACCOUNT_ID=...)" >&2; exit 2; }
  grep -q '^CLOUDFLARE_API_TOKEN=.' "$SECRETS" || { echo "no CLOUDFLARE_API_TOKEN in $SECRETS" >&2; exit 2; }
  ACCOUNT=$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' "$SECRETS" | tail -1)
  [[ $ACCOUNT =~ ^[0-9a-f]{32}$ ]] || { echo "no CLOUDFLARE_ACCOUNT_ID (32 hex) in $SECRETS" >&2; exit 2; }
}
send_token() { sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS" | tail -1; }
# Container code: is the token (CLOUDFLARE_API_TOKEN, read from stdin) active for CLOUDFLARE_ACCOUNT_ID?
# The header goes to curl on its stdin, so the token is never in a process's arguments.
TOKEN_CHECK='v=$(printf "Authorization: Bearer %s\n" "$CLOUDFLARE_API_TOKEN" | curl -s --max-time 20 -H @- "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" || true)
if printf "%s" "$v" | grep -Eq "\"status\" *: *\"active\""; then echo "deploy: the Cloudflare token is active for the account"
else echo "deploy: the Cloudflare token did not verify for this account (accounts/<id>/tokens/verify)" >&2; exit 3; fi'

if [ "$CHECK_TOKEN" -eq 1 ]; then
  load_account
  CHECK_INNER="set -euo pipefail
IFS= read -r CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT
$TOKEN_CHECK"
  send_token | ssh "$HOST" "docker run --rm -i --name shadowlocks-deploy-check-$(date -u +%m%d%H%M%S)-$RANDOM --cpus 1 --memory 512m \
    --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 $IMAGE bash -c $(printf '%q' "$CHECK_INNER")"
  exit
fi

if [ "$PREVIEW" -eq 1 ]; then
  # Only the public project, only a preview branch: the live hosts are never touched.
  [ ${#PROJECTS[@]} -eq 0 ] && [ "$BRANCH" = main ] && [ "$CREATE" -eq 0 ] \
    || { echo "--preview takes no --both, --project, --branch or --create" >&2; exit 2; }
  PROJECTS=("$PUBLIC_PROJECT")
  BRANCH=preview
fi
[ ${#PROJECTS[@]} -gt 0 ] || usage
for p in "${PROJECTS[@]}"; do
  [[ $p =~ ^[a-z0-9][a-z0-9-]{0,57}$ ]] || { echo "bad project name: $p" >&2; exit 2; }
done
# Each project once, in the order given.
UNIQUE=()
for p in "${PROJECTS[@]}"; do
  case " ${UNIQUE[*]-} " in *" $p "*) ;; *) UNIQUE+=("$p") ;; esac
done
PROJECTS=("${UNIQUE[@]}")
[[ $BRANCH =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]] || { echo "bad branch name: $BRANCH" >&2; exit 2; }
if [ "$DRY" -eq 0 ] && [ "$LATE_JUDGE" -eq 0 ] && [ "$(date -u +%s)" -ge "$DEADLINE_EPOCH" ]; then
  for p in "${PROJECTS[@]}"; do
    if [ "$p" = "$JUDGE_PROJECT" ]; then
      echo "refused: the competition deadline has passed; $JUDGE_PROJECT stays as the judges saw it (--judge-after-deadline overrides)" >&2
      exit 2
    fi
  done
fi
LIST=$(printf "'%s', " "${PROJECTS[@]}")
LIST=${LIST%, }

COMMIT=$(git -C "$ROOT" rev-parse HEAD)
SUBJECT=$(git -C "$ROOT" log -1 --format=%s | tr -cd 'A-Za-z0-9 .,:()/_-' | cut -c1-200)
if [ -n "$(git -C "$ROOT" status --porcelain)" ] && [ "$DIRTY" -eq 0 ]; then
  echo "refused: uncommitted changes (commit them, or pass --allow-dirty)" >&2
  exit 2
fi

# Build on the server (vite build, then check-dist), and pull dist/ back to check it here too. An
# old dist/ must never be published: it is removed first, and the pulled sw.js must match the stamp
# check-dist printed for this build.
DIST=$ROOT/dist
rm -rf "$DIST"
LOG=$(mktemp "${TMPDIR:-/tmp}/deploy-build.XXXXXX")
trap 'rm -f "$LOG"' EXIT
echo "building $COMMIT on $HOST"
set +e
"$ROOT/scripts/remote.sh" "$BUILD_LANE" --pull dist -- npm run build 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 0 ] || { echo "refused: the build failed (exit $rc)" >&2; exit 3; }
if grep -q "could not pull dist" "$LOG"; then echo "refused: dist/ did not come back from $HOST" >&2; exit 3; fi
STAMP=$(sed -n 's/^check-dist: sw.js sha256 \([0-9a-f]\{64\}\)$/\1/p' "$LOG" | tail -1)
[ -n "$STAMP" ] || { echo "refused: the build printed no sw.js stamp" >&2; exit 3; }
for f in index.html sw.js manifest.webmanifest _headers privacy.html .well-known/assetlinks.json icons/icon-512.png; do
  [ -f "$DIST/$f" ] || { echo "refused: dist/$f is missing" >&2; exit 3; }
done
if find "$DIST" -type f \( -name '*.keystore' -o -name '*.jks' -o -name '*.p12' -o -name '.env*' \) | grep -q .; then
  echo "refused: a key or secret file is in dist/" >&2
  exit 3
fi
[ "$(shasum -a 256 "$DIST/sw.js" | cut -d' ' -f1)" = "$STAMP" ] || { echo "refused: dist/sw.js is not this build's" >&2; exit 3; }
cmp -s "$DIST/.well-known/assetlinks.json" "$ROOT/public/.well-known/assetlinks.json" \
  || { echo "refused: dist/.well-known/assetlinks.json is not the committed one" >&2; exit 3; }
FILES=$(find "$DIST" -type f | wc -l | tr -d ' ')
echo "dist: $FILES files, $(du -sh "$DIST" | cut -f1)"
if grep -q REPLACE_WITH "$DIST/.well-known/assetlinks.json"; then
  echo "note: the asset links still have placeholders (fine until the Quest apps exist; scripts/twa-fill.sh fills them)"
fi

if [ "$DRY" -eq 1 ]; then
  (cd "$DIST" && find . -type f | sed 's#^\./##' | sort)
  echo "dry run: would publish dist/ to Pages project(s) $LIST, branch '$BRANCH'"
  exit 0
fi

load_account

gate=$(ssh "$HOST" "awk '{print \$1}' /proc/loadavg && df -BG --output=avail / | tail -1 | tr -dc 0-9") \
  || { echo "cannot reach $HOST (is the VPN on?)" >&2; exit 3; }
LOAD=$(printf '%s\n' "$gate" | sed -n 1p)
FREE=$(printf '%s\n' "$gate" | sed -n 2p)
if awk -v l="$LOAD" -v m="$MAX_LOAD" 'BEGIN{exit !(l>m)}'; then echo "refused: $HOST load $LOAD > $MAX_LOAD" >&2; exit 3; fi
if [ "${FREE:-0}" -lt "$MIN_FREE_GB" ]; then echo "refused: $HOST free disk ${FREE:-0} GB < $MIN_FREE_GB GB" >&2; exit 3; fi

# In the container: the first stdin line is the token, the rest is dist/ as a tar stream. The token
# is checked first; then every project gets the same files, one after the other; the first failure
# stops the rest.
INNER="set -euo pipefail
IFS= read -r CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$ACCOUNT WRANGLER_SEND_METRICS=false CI=1
$TOKEN_CHECK
mkdir -p /tmp/site && tar -C /tmp/site --no-same-owner -xf -
find /tmp/site -name '._*' -delete
[ \$(find /tmp/site -type f | wc -l) -eq $FILES ] || { echo 'deploy: dist did not arrive whole' >&2; exit 3; }
cd /tmp
for p in ${PROJECTS[*]}; do
  echo \"publishing to Pages project \$p, branch $BRANCH\"
  if [ $CREATE -eq 1 ]; then npx -y $WRANGLER pages project create \$p --production-branch main; fi
  npx -y $WRANGLER pages deploy /tmp/site --project-name \$p --branch $BRANCH \
    --commit-hash $COMMIT --commit-message $(printf '%q' "$SUBJECT") --commit-dirty=$([ -n "$(git -C "$ROOT" status --porcelain)" ] && echo true || echo false)
done"
NAME="shadowlocks-deploy-$(date -u +%m%d%H%M%S)-$RANDOM"
# macOS tar would add ._* files (extended attributes) for every file; leave them out.
TAR=(tar)
if tar --version 2>/dev/null | grep -q bsdtar; then TAR=(env COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs); fi
echo "publishing to Pages project(s) $LIST, branch '$BRANCH'"
{ send_token; "${TAR[@]}" -C "$DIST" -cf - .; } | ssh "$HOST" "docker run --rm -i --name $NAME --cpus 2 --memory 2g \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 \
  -v $NPM_VOLUME:/npm-cache -e npm_config_cache=/npm-cache $IMAGE bash -c $(printf '%q' "$INNER")"

# Each host this deploy went to: the live one for main, <branch>.<project>.pages.dev for a preview
# (Pages may take a few seconds to serve a new preview alias).
[ "$BRANCH" = main ] || sleep 10
bad=0
for p in "${PROJECTS[@]}"; do
  if [ "$BRANCH" = main ]; then host=$p.pages.dev; else host=$(printf '%s' "$BRANCH" | tr '[:upper:]_' '[:lower:]-').$p.pages.dev; fi
  echo "checking https://$host"
  verify "$host" "$DIST/.well-known/assetlinks.json" || bad=1
done
exit $bad
