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
# A secret-like value: token characters (base64 and the like), never an expansion ($x, ${x}, $(...)).
TOKEN_CHARS="[A-Za-z0-9/+_.~=-]"
# A quoted one may hold punctuation too, but no space, quote, $, bracket or brace (so no sentence, template, expansion,
# code or pattern), and has at least one letter (so a version such as 4.0.0 or ^4.0.0 is not one).
VALUE_CHARS="[A-Za-z0-9/+_.~=!#%&*,:;?@^|-]"
QUOTED_VALUE="${Q}${VALUE_CHARS}*[A-Za-z]${VALUE_CHARS}*${Q}"
# A variable or key that holds a secret: upper-case env names with KEY or PASS too (CLOUDFLARE_API_KEY, NPM_PASS), and
# any name with password, passwd, secret, token or api key in it (storePassword, keyPassword).
ASSIGNED_NAME="([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS)[A-Z0-9_]*|[A-Za-z0-9_.]*${SECRET_NAME}[A-Za-z0-9_]*)"
# Punctuation a tight value may start with; never $, a bracket, a brace or a quote (an expansion, code or a pattern).
LEAD_CHARS="[!#%&*,:?@^|]"
# A plain web address (http or https, no user or password before its host) is no secret: the rules marked "urls" read
# each line with such addresses replaced by $U, which none of them takes as a value. An address with credentials in it
# (user:pass@ or token@ before the host) is left as it is, so it still counts. Group 2 is that @.
URL_RE="https?://[^/@[:space:]\"'\`]+([/?#][^[:space:]\"'\`]*)?(@?)"
NAMES=()
RES=()
URLS=()
rule() { NAMES+=("$1"); RES+=("$2"); URLS+=("${3:-}"); }
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
# A secret-named assignment at the start of a line, optionally exported, the value quoted or not. Two shapes:
# - Tight, NAME=value (shell, env and properties files): token characters, after any run of leading punctuation
#   (LEAD_CHARS), ending at the line's end or at any character that is neither a token character nor $, so punctuation,
#   a space before a command or comment, or a ; ends it. Only $ continues the word: an expansion ($X, ${X}, $(...),
#   abc$X) never matches.
# - Spaced, name = value (code style): 12 or more token characters whatever follows them, or a shorter value ending the
#   word (end of line, a space before a command or a comment, a ;). A code reassignment of a longer expression can trip
#   it; HEAD and the history must stay clean anyway.
# A plain web address as the value passes (urls): a token endpoint is no secret.
rule "secret in an assignment" "^[[:space:]]*(export[[:space:]]+)?${ASSIGNED_NAME}(=${Q}?${LEAD_CHARS}*${TOKEN_CHARS}+([^\$A-Za-z0-9/+_.~=-]|\$)|[[:space:]]*=[[:space:]]*${Q}?(${TOKEN_CHARS}{12,}|${TOKEN_CHARS}+${Q}?([[:space:]#;]|\$)))" urls
# A secret-named key or variable given a quoted secret-like value (QUOTED_VALUE: punctuation in, spaces out) anywhere
# in a line, any value length (an apiKey or a storePassword set to a quoted string in code or config). A plain web
# address passes here too (urls).
rule "secret in a quoted literal" "[A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*${Q}?[[:space:]]*[:=][[:space:]]*${QUOTED_VALUE}" urls
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

# PLAIN: line $1 with every plain web address (URL_RE without its @) replaced by $U; addresses with credentials stay.
without_urls() {
  local rest=$1 m
  PLAIN=
  while [[ $rest =~ $URL_RE ]]; do
    m=${BASH_REMATCH[0]}
    if [ -n "${BASH_REMATCH[2]}" ]; then PLAIN+=${rest%%"$m"*}$m; else PLAIN+=${rest%%"$m"*}'$U'; fi
    rest=${rest#*"$m"}
  done
  PLAIN+=$rest
}
# Does rule $1 (an index) match line $2? A "urls" rule must still match once plain web addresses are set aside.
hits() {
  [[ $2 =~ ${RES[$1]} ]] || return 1
  [ "${URLS[$1]}" = urls ] || return 0
  without_urls "$2"
  [[ $PLAIN =~ ${RES[$1]} ]]
}

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
    # Android signing passwords live in key.properties, gradle.properties or local.properties; the repo needs none.
    *.properties) echo "properties file" ;;
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
# Reviewed history findings that are not secrets, as "<full 40-character commit hash> <rule>" for a line the commit
# adds, or "<hash> <rule> (message)" for its message. Never add a real secret here: rewrite the history instead.
HISTORY_ALLOW=(
  # A made-up test value ("s3cr3tV4lue" plus x's) in the first version of this check's tests; they now build every
  # sample at run time.
  "96445c5ef8c77ecb7c78a75306fb55672fd5d152 secret in a quoted literal"
  # Prose: the message lists this check's example names, each set to a one-letter x, written before the assignment
  # rule ended a value at punctuation.
  "dd1f70cfb756ba6fdad9ea2f5236713649ca5b07 secret in an assignment (message)"
)
history_allowed() { # full commit hash, rule name
  local a
  for a in "${HISTORY_ALLOW[@]}"; do
    if [[ $1 == "${a%% *}" && "${a#* }" == "$2" ]]; then return 0; fi
  done
  return 1
}
# Does commit $1 (against any parent) add a line that rule $2 (an index) hits?
adds() {
  local d l header=0
  d=$(gitq show --format= -U0 --no-color --no-ext-diff --no-renames -m "$1") || die "git show $1 failed"
  while IFS= read -r l; do
    case $l in
      "diff --git "*) header=1; continue ;;
      "@@"*) header=0; continue ;;
    esac
    [ $header -eq 0 ] || continue
    case $l in "+"*) if hits "$2" "${l:1}"; then return 0; fi ;; esac
  done <<<"$d"
  return 1
}
for i in "${!NAMES[@]}"; do
  # HEAD's matching lines (never shown), counted per file; git grep lists one file's lines together. A "urls" rule
  # counts a line only if it still matches with plain web addresses set aside.
  out=$(gitq grep -I -n -E -e "${RES[$i]}" HEAD -- .)
  cur= n=0
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    l=${l#HEAD:}
    f=${l%%:*}
    rest=${l#*:}
    if [ "${URLS[$i]}" = urls ]; then
      without_urls "${rest#*:}"
      [[ $PLAIN =~ ${RES[$i]} ]] || continue
    fi
    if [ "$f" != "$cur" ]; then
      [ "$n" -eq 0 ] || fail "${NAMES[$i]}: $cur ($n lines)"
      cur=$f n=0
    fi
    n=$((n + 1))
  done <<<"$out"
  [ "$n" -eq 0 ] || fail "${NAMES[$i]}: $cur ($n lines)"
  n=0
  SEEN=$'\n'
  # Full hashes (%H), so an exception matches exactly one commit; reported by their first 7 characters.
  out=$(gitq log $REVS -m --no-renames --format=%H -G"${RES[$i]}" -- .)
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    case $SEEN in *$'\n'"$c"$'\n'*) continue ;; esac
    SEEN="$SEEN$c"$'\n'
    adds "$c" "$i" || continue
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
# Each message is read on its own, by its commit's full hash, so no line of one message can pose as the start of
# another (or claim another commit's exception); a message exception matches exactly one commit. Reported by the
# first 7 characters.
revs=$(gitq rev-list $REVS)
while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  msg=$(gitq log -1 --format=%B "$commit")
  while IFS= read -r l; do
    scan_line "message of ${commit:0:7}" "$l" ""
    for i in "${!NAMES[@]}"; do
      if hits "$i" "$l" && ! history_allowed "$commit" "${NAMES[$i]} (message)"; then
        fail "${NAMES[$i]}: message of ${commit:0:7}"
      fi
    done
  done <<<"$msg"
done <<<"$revs"

if [ "$FOUND" -eq 0 ]; then
  echo clean
  exit 0
fi
echo "prepublish-check: $FOUND problems"
exit 1
