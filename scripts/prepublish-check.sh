#!/usr/bin/env bash
# Run before the repository goes public: fails when HEAD's tracked files, the history of HEAD (merges included) or a
# commit message holds a secret-looking value, a key or secret file (.secrets above all), an absolute /Users/ path, or an
# email address. Allowed: example.com addresses, and the public support address in public/privacy.html only, pinned by
# its SHA-256 (SUPPORT_SHA256 below), so editing the page's link cannot widen what is allowed. Prints "clean" when
# nothing is found. It never prints a match: a secret shows only as its rule and where it is, an email masked. A pattern
# git or bash cannot compile, a failing git command, or a privacy page without its support link stops the check
# (exit 2) instead of letting it pass.
# Usage: scripts/prepublish-check.sh [--all]   (--all: every branch's history, not only HEAD's)
# Runs with git and coreutils (the build server's lanes get no .git; its tests run it in throwaway repositories).
# Tests only: PREPUBLISH_SUPPORT_SHA256 replaces the pinned hash, PREPUBLISH_TEST_RULE ("name<TAB>regex") adds a rule.
set -euo pipefail
export LC_ALL=C
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT"

REVS=HEAD
case ${1:-} in
  "") ;;
  --all) REVS=--all ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac

# sha256 of the support address the owner chose (2026-11-06); the address itself is on the privacy page.
SUPPORT_SHA256=f0bbeb803323ec2dc8b14f264172323dd2c061b95f0ac4c5b7395c24aeaed4a8
if [ -n "${PREPUBLISH_SUPPORT_SHA256:-}" ]; then
  echo "prepublish-check: note: PREPUBLISH_SUPPORT_SHA256 replaces the pinned support address hash (tests only)" >&2
  SUPPORT_SHA256=$PREPUBLISH_SUPPORT_SHA256
fi
SUPPORT_FILE=public/privacy.html

FOUND=0
fail() {
  echo "FAIL $1"
  FOUND=$((FOUND + 1))
}
die() {
  echo "prepublish-check: $1" >&2
  exit 2
}
# git with its output captured: exit 0 and 1 (nothing found) are answers, anything else stops the check. Always assign
# its output to a variable first (out=$(gitq ...)): set -e then stops the script, which a failure inside a here-string
# or a pipe would not.
gitq() {
  local out rc=0
  out=$(git "$@") || rc=$?
  [ "$rc" -le 1 ] || die "git $1 failed (exit $rc): its pattern or arguments are wrong"
  printf '%s' "$out"
}
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }

# Every pattern has a bracket or a group right after its fixed start, so this file never matches itself. Q is any quote.
Q="[\"'\`]"
# Names that hold secrets, in any case: password, passwd, secret, token, api key.
SECRET_NAME="([Pp][Aa][Ss][Ss][Ww]([Oo][Rr])?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii]_?[Kk][Ee][Yy])"
# A secret-like value: token characters only (base64 and the like), never an expansion ($x, ${x}, $(...)), code or a
# version range (^4.0.0); a quoted one has at least one letter (so "4.0.0" is not one).
TOKEN_CHARS="[A-Za-z0-9/+_.~=-]"
QUOTED_VALUE="${Q}${TOKEN_CHARS}*[A-Za-z]${TOKEN_CHARS}*${Q}"
NAMES=()
RES=()
rule() { NAMES+=("$1"); RES+=("$2"); }
rule "private key" '-----BEGIN ([A-Z]+ )*PRIVATE KEY'
rule "AWS access key" '(AKIA|ASIA)[0-9A-Z]{16}'
rule "GitHub token" 'gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}'
rule "Slack token" 'xox[abprs]-[A-Za-z0-9-]{10,}'
rule "Google API key" 'AIza[0-9A-Za-z_-]{35}'
rule "API secret key" '(sk|rk)_(live|test)_[0-9A-Za-z]{16,}|(^|[^A-Za-z0-9_])sk-(proj-|ant-)?[A-Za-z0-9_-]{32,}|(^|[^A-Za-z0-9_])sk_[0-9a-f]{40,}'
rule "JSON web token" 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}'
rule "bearer token" '[Bb]earer[[:space:]]+[A-Za-z0-9_.=-]{30,}'
rule "Meta access token" '(OC|[0-9]{8,20})[|][0-9]{8,20}[|][0-9a-f]{32}|(^|[^0-9])[0-9]{10,20}[|][0-9a-f]{32}'
rule "Meta app secret" "([Aa][Pp][Pp]_?)?[Ss][Ee][Cc][Rr][Ee][Tt]${Q}?[[:space:]]*[:=][[:space:]]*${Q}?[0-9a-f]{32}"
# NAME=value at the start of a line (env and properties files, shell): KEYSTORE_PASSWORD=x, storePassword=x,
# export API_TOKEN=x, a quoted value too. A value of any length that ends the word (end of line, a space before a
# command or a comment, a ;), or 12 or more token characters whatever follows them. Upper-case env names also catch KEY
# and PASS (CLOUDFLARE_API_KEY, NPM_PASS). $ is no token character, so an expansion ($X, ${X}, $(...)) never matches.
rule "secret in an assignment" "^[[:space:]]*(export[[:space:]]+)?([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS)[A-Z0-9_]*|[A-Za-z0-9_.]*${SECRET_NAME}[A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*${Q}?(${TOKEN_CHARS}{12,}|${TOKEN_CHARS}+${Q}?([[:space:]#;]|$))"
# A secret-named key or variable given a quoted token-like value anywhere in a line, any value length (an apiKey or a
# storePassword set to a quoted string in code or config).
rule "secret in a quoted literal" "[A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*${Q}?[[:space:]]*[:=][[:space:]]*${QUOTED_VALUE}"
rule "absolute /Users/ path" '/[U]sers/[A-Za-z0-9._-]'
if [ -n "${PREPUBLISH_TEST_RULE:-}" ]; then rule "${PREPUBLISH_TEST_RULE%%$'\t'*}" "${PREPUBLISH_TEST_RULE#*$'\t'}"; fi
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

# Every pattern must compile for git (on nothing) and for bash; a broken one stops the check rather than matching nothing.
for i in "${!NAMES[@]}"; do
  rc=0
  git grep -q -E -e "${RES[$i]}" HEAD -- "no-such-path-$RANDOM" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 1 ] || die "the pattern for \"${NAMES[$i]}\" does not compile for git (exit $rc)"
  rc=0
  [[ "x" =~ ${RES[$i]} ]] 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || die "the pattern for \"${NAMES[$i]}\" does not compile for bash"
done

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
mask() { printf '%s***@%s' "${1:0:1}" "${1#*@}"; }

# The support address: the one in the privacy page's support link at HEAD, if its hash is the pinned one.
SUPPORT=
SUPPORT_RE='id="support-email" href="mailto:([^"]+)"'
if git cat-file -e "HEAD:$SUPPORT_FILE" 2>/dev/null; then
  page=$(git show "HEAD:$SUPPORT_FILE")
  [[ $page =~ $SUPPORT_RE ]] || die "$SUPPORT_FILE has no support link (<a id=\"support-email\" href=\"mailto:...\">); fix the page"
  found=$(lower "${BASH_REMATCH[1]}")
  if [ "$(printf '%s' "$found" | sha256)" = "$SUPPORT_SHA256" ]; then
    SUPPORT=$found
  else
    fail "the support address on $SUPPORT_FILE is not the pinned one (update SUPPORT_SHA256 only on purpose)"
  fi
fi
email_ok() { # address, the file it is in ("" for a commit message)
  local e
  e=$(lower "$1")
  case $e in *@example.com | *@example.org | *@example.net) return 0 ;; esac
  [ -n "$SUPPORT" ] && [ "$e" = "$SUPPORT" ] && [ "$2" = "$SUPPORT_FILE" ]
}
# npm registry text, not ours: a package's "deprecated" notice in the lock file may name its maintainer's address.
DEPRECATED_RE='^[+-]?[[:space:]]*"deprecated":'
registry_line() { [ "$1" = package-lock.json ] && [[ $2 =~ $DEPRECATED_RE ]]; }
# Every address in `text` (whole line), each checked once.
scan_line() { # where, text, the file it is from ("" for a commit message)
  local rest=$2 e
  while [[ $rest =~ $EMAIL_RE ]]; do
    e=${BASH_REMATCH[0]}
    email_ok "$e" "$3" || fail "email $(mask "$e"): $1"
    rest=${rest#*"$e"}
  done
}

# 1. Key and secret files, tracked at HEAD or ever added on this history.
bad_file() {
  case /$1 in
    */.secrets | */.secrets/*) echo ".secrets" ;;
    */.env | */.env.*) echo "env file" ;;
    *.keystore | *.jks | *.p12 | *.pfx | *.pem | *.key | *.apk | *.aab | */id_rsa* | */id_ed25519* | *.mobileprovision) echo "key or package file" ;;
    *) return 1 ;;
  esac
}
out=$(gitq ls-tree -r --name-only HEAD)
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if why=$(bad_file "$f"); then fail "$why tracked: $f"; fi
done <<<"$out"
SEEN=$'\n'
out=$(gitq log $REVS -m --no-renames --format= --name-only --diff-filter=A)
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case $SEEN in *$'\n'"$f"$'\n'*) continue ;; esac
  SEEN="$SEEN$f"$'\n'
  if why=$(bad_file "$f"); then fail "$why in the history: $f"; fi
done <<<"$out"
git check-ignore -q --no-index .secrets/x || fail ".gitignore does not keep .secrets/ out"
git check-ignore -q --no-index x.keystore || fail ".gitignore does not keep *.keystore out"

# 2. Secrets and local paths in HEAD's files (counted per file, never shown) and in the history, merges included: a
# commit is flagged when it adds a matching line (removing one leaks nothing; the commit that added it is flagged).
# Reviewed history findings that are not secrets, as "<full 40-character commit hash> <rule>". Never add a real secret
# here: rewrite the history instead.
HISTORY_ALLOW=(
  # A made-up test value ("s3cr3tV4lue" plus x's) in the first version of this check's tests; they now build every
  # sample at run time.
  "96445c5ef8c77ecb7c78a75306fb55672fd5d152 secret in a quoted literal"
)
history_allowed() { # full commit hash, rule name
  local a
  for a in "${HISTORY_ALLOW[@]}"; do
    if [[ $1 == "${a%% *}" && "${a#* }" == "$2" ]]; then return 0; fi
  done
  return 1
}
# Does commit $1 (against any parent) add a line that matches $2?
adds() {
  local d l header=0
  d=$(gitq show --format= -U0 --no-color --no-ext-diff --no-renames -m "$1") || die "git show $1 failed"
  while IFS= read -r l; do
    case $l in
      "diff --git "*) header=1; continue ;;
      "@@"*) header=0; continue ;;
    esac
    [ $header -eq 0 ] || continue
    case $l in "+"*) if [[ ${l:1} =~ $2 ]]; then return 0; fi ;; esac
  done <<<"$d"
  return 1
}
for i in "${!NAMES[@]}"; do
  out=$(gitq grep -I -c -E -e "${RES[$i]}" HEAD -- .)
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    l=${l#HEAD:}
    fail "${NAMES[$i]}: ${l%:*} (${l##*:} lines)"
  done <<<"$out"
  n=0
  SEEN=$'\n'
  # Full hashes (%H), so an exception matches exactly one commit; reported by their first 7 characters.
  out=$(gitq log $REVS -m --no-renames --format=%H -G"${RES[$i]}" -- .)
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    case $SEEN in *$'\n'"$c"$'\n'*) continue ;; esac
    SEEN="$SEEN$c"$'\n'
    adds "$c" "${RES[$i]}" || continue
    history_allowed "$c" "${NAMES[$i]}" && continue
    n=$((n + 1))
    [ $n -le 5 ] && fail "${NAMES[$i]}: added in commit ${c:0:7}"
  done <<<"$out"
done

# 3. Emails in HEAD's files: whole lines (an -o match can be cut at the wrong place when one line holds an address twice),
# each line's addresses found and checked by scan_line.
out=$(gitq grep -I -n -E -e "$EMAIL_RE" HEAD -- .)
while IFS= read -r l; do
  [ -n "$l" ] || continue
  l=${l#HEAD:}
  f=${l%%:*}
  rest=${l#*:}
  n=${rest%%:*}
  text=${rest#*:}
  registry_line "$f" "$text" || scan_line "$f:$n" "$text" "$f"
done <<<"$out"

# 4. Emails in the history's changed lines (merges diffed against each parent, renames as delete and add), and
# anything in commit messages.
SEEN=$'\n'
commits=$(gitq log $REVS -m --no-renames --format=%h -G"$EMAIL_RE" -- .)
while IFS= read -r c; do
  [ -n "$c" ] || continue
  case $SEEN in *$'\n'"$c"$'\n'*) continue ;; esac
  SEEN="$SEEN$c"$'\n'
  file= minus= header=0
  diff=$(gitq show --format= -U0 --no-color --no-ext-diff --no-renames -m "$c")
  while IFS= read -r l; do
    case $l in
      "diff --git "*) header=1; file= minus=; continue ;;
      "@@"*) header=0; continue ;;
    esac
    if [ $header -eq 1 ]; then
      case $l in
        "--- a/"*) minus=${l#--- a/} ;;
        "--- /dev/null") minus= ;;
        "+++ b/"*) file=${l#+++ b/} ;;
        # A deleted file: its removed lines are the old path's, never the previous file's.
        "+++ /dev/null") file=$minus ;;
      esac
      continue
    fi
    # The line without its diff marker: "+" and "-" can be part of an address.
    case $l in "+"* | "-"*) registry_line "$file" "$l" || scan_line "commit $c" "${l:1}" "$file" ;; esac
  done <<<"$diff"
done <<<"$commits"
commit=
out=$(gitq log $REVS --format='@@commit %h%n%B')
while IFS= read -r l; do
  case $l in "@@commit "*) commit=${l#@@commit }; continue ;; esac
  scan_line "message of $commit" "$l" ""
  for i in "${!NAMES[@]}"; do
    if [[ $l =~ ${RES[$i]} ]]; then fail "${NAMES[$i]}: message of $commit"; fi
  done
done <<<"$out"

if [ "$FOUND" -eq 0 ]; then
  echo clean
  exit 0
fi
echo "prepublish-check: $FOUND problems"
exit 1
