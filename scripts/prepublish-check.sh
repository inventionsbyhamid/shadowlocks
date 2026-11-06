#!/usr/bin/env bash
# Run before the repository goes public: fails when a tracked file, the history of HEAD or a commit
# message holds a secret-looking value, a key or secret file (.secrets above all), an absolute /Users/
# path, or an email address other than the commit authors' (the public support address on the
# privacy page and example.com addresses are allowed too). Prints "clean" when nothing is found.
# It never prints a match: a secret shows only as its rule and where it is, an email masked.
# Usage: scripts/prepublish-check.sh [--all]   (--all: every branch's history, not only HEAD's)
# Runs on this Mac with git alone (the build server gets no .git).
set -euo pipefail
export LC_ALL=C
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT"

REVS=HEAD
case ${1:-} in
  "") ;;
  --all) REVS=--all ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac

FOUND=0
fail() {
  echo "FAIL $1"
  FOUND=$((FOUND + 1))
}

# Every pattern has a bracket or a group right after its fixed start, so this file never matches
# itself. Q is any quote character.
Q="[\"'\`]"
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
rule "secret in an env assignment" "^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*=${Q}?[A-Za-z0-9/+_.=-]{12,}"
rule "secret in a quoted literal" "([Aa][Pp][Ii]_?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd])[A-Za-z0-9_]*${Q}?[[:space:]]*[:=][[:space:]]*${Q}[A-Za-z0-9/+_.=-]{20,}${Q}"
rule "absolute /Users/ path" '/[U]sers/[A-Za-z0-9._-]'
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# Allowed: the commit authors and committers, the support address on the privacy page, example.com.
ALLOWED=$'\n'
while IFS= read -r e; do
  [ -n "$e" ] && ALLOWED="$ALLOWED$(lower "$e")"$'\n'
done < <(git log $REVS --format='%ae%n%ce')
SUPPORT_RE='id="support-email" href="mailto:([^"]+)"'
if page=$(git show HEAD:public/privacy.html 2>/dev/null) && [[ $page =~ $SUPPORT_RE ]]; then
  ALLOWED="$ALLOWED$(lower "${BASH_REMATCH[1]}")"$'\n'
fi
email_ok() {
  local e
  e=$(lower "$1")
  case $e in *@example.com | *@example.org | *@example.net) return 0 ;; esac
  case $ALLOWED in *$'\n'"$e"$'\n'*) return 0 ;; esac
  return 1
}
mask() { printf '%s***@%s' "${1:0:1}" "${1#*@}"; }
# npm registry text, not ours: a package's "deprecated" notice in the lock file may name its
# maintainer's public address.
DEPRECATED_RE='^[+-]?[[:space:]]*"deprecated":'
registry_line() { [ "$1" = package-lock.json ] && [[ $2 =~ $DEPRECATED_RE ]]; }

# 1. Key and secret files, tracked now or ever added on this history.
bad_file() {
  case /$1 in
    */.secrets | */.secrets/*) echo ".secrets" ;;
    */.env | */.env.*) echo "env file" ;;
    *.keystore | *.jks | *.p12 | *.pfx | *.pem | *.key | *.apk | *.aab | */id_rsa* | */id_ed25519* | *.mobileprovision) echo "key or package file" ;;
    *) return 1 ;;
  esac
}
while IFS= read -r f; do
  if why=$(bad_file "$f"); then fail "$why tracked: $f"; fi
done < <(git ls-files)
SEEN=$'\n'
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case $SEEN in *$'\n'"$f"$'\n'*) continue ;; esac
  SEEN="$SEEN$f"$'\n'
  if why=$(bad_file "$f"); then fail "$why in the history: $f"; fi
done < <(git log $REVS --format= --name-only --diff-filter=A)
git check-ignore -q --no-index .secrets/x || fail ".gitignore does not keep .secrets/ out"
git check-ignore -q --no-index x.keystore || fail ".gitignore does not keep *.keystore out"

# 2. Secrets and local paths in tracked files (counted per file, never shown) and in the history.
for i in "${!NAMES[@]}"; do
  while IFS= read -r l; do
    fail "${NAMES[$i]}: ${l%:*} (${l##*:} lines)"
  done < <(git grep -I -c -E -e "${RES[$i]}" -- . || true)
  n=0
  while IFS= read -r c; do
    n=$((n + 1))
    [ $n -le 5 ] && fail "${NAMES[$i]}: added or removed in commit $c"
  done < <(git log $REVS --format=%h -G"${RES[$i]}" -- . || true)
done

# 3. Emails in tracked files (the lock file is public registry text: read whole lines there).
scan_line() { # where, text
  local rest=$2 e
  while [[ $rest =~ $EMAIL_RE ]]; do
    e=${BASH_REMATCH[0]}
    email_ok "$e" || fail "email $(mask "$e"): $1"
    rest=${rest#*"$e"}
  done
}
while IFS= read -r l; do
  e=${l##*:}
  email_ok "$e" || fail "email $(mask "$e"): ${l%:*}"
done < <(git grep -I -n -o -E -e "$EMAIL_RE" -- . ':!package-lock.json' || true)
while IFS= read -r l; do
  text=${l#*:}
  registry_line package-lock.json "$text" || scan_line "package-lock.json:${l%%:*}" "$text"
done < <(git grep -I -n -E -e "$EMAIL_RE" -- package-lock.json | sed 's/^package-lock\.json://' || true)

# 4. Emails in the history's changed lines, and anything in commit messages.
while IFS= read -r c; do
  file=
  while IFS= read -r l; do
    case $l in
      "+++ b/"*) file=${l#+++ b/}; continue ;;
      "+++"* | "---"*) continue ;;
      "+"* | "-"*) registry_line "$file" "$l" || scan_line "commit $c" "$l" ;;
    esac
  done < <(git show --format= -U0 --no-color --no-ext-diff "$c")
done < <(git log $REVS --format=%h -G"$EMAIL_RE" -- . || true)
commit=
while IFS= read -r l; do
  case $l in "@@commit "*) commit=${l#@@commit }; continue ;; esac
  scan_line "message of $commit" "$l"
  for i in "${!NAMES[@]}"; do
    if [[ $l =~ ${RES[$i]} ]]; then fail "${NAMES[$i]}: message of $commit"; fi
  done
done < <(git log $REVS --format='@@commit %h%n%B')

# A note, not a failure: the commit authors' own addresses are allowed, but say where they appear.
authors=0
while IFS= read -r e; do
  [ -n "$e" ] || continue
  n=$(git grep -I -h -c -i -F -e "$e" -- . | awk '{ s += $1 } END { print s + 0 }' || true)
  authors=$((authors + ${n:-0}))
done < <(git log $REVS --format='%ae' | sort -u)
[ "$authors" -eq 0 ] || echo "note: a commit author's address appears on $authors tracked lines (allowed)"

if [ "$FOUND" -eq 0 ]; then
  echo clean
  exit 0
fi
echo "prepublish-check: $FOUND problems"
exit 1
