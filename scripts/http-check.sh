# Sourced by scripts/deploy-pages.sh (and tests/unit/http-check.test.ts): checks one HTTP response
# head, as `curl -s -o /dev/null -D -` prints it. Everything is compared literally (no patterns), and
# it runs on macOS's bash 3.2.
#
# head_ok <head> <path> <status> <types> [header]
#   <types>   content types separated by "|", each matched as a prefix ("text/html" also matches
#             "text/html; charset=utf-8")
#   [header]  a line the head must have, matched as a prefix, case-insensitively
#             (e.g. "cache-control: no-cache")
# Prints "ok   <path>: ..." or "FAIL <path>: ..." and returns 0 or 1.
head_ok() {
  local head path want types line code type t found=1 lower_line
  head=$(printf '%s' "$1" | tr -d '\r')
  path=$2 want=$3 types=$4 line=${5:-}
  code=$(printf '%s\n' "$head" | awk 'NR==1{print $2}')
  type=$(printf '%s\n' "$head" | awk 'index(tolower($0), "content-type:") == 1 {sub(/^[^:]*:[ \t]*/, ""); print}' | tail -1)
  local IFS='|'
  for t in $types; do
    case $type in "$t"*) found=0 ;; esac
  done
  unset IFS
  if [ "$code" != "$want" ] || [ "$found" -ne 0 ]; then
    echo "FAIL $path: ${code:-no answer} ${type:-no type} (want $want $types)"
    return 1
  fi
  if [ -n "$line" ]; then
    lower_line=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')
    if ! printf '%s\n' "$head" | tr '[:upper:]' '[:lower:]' | awk -v w="$lower_line" 'index($0, w) == 1 {f = 1} END {exit !f}'; then
      echo "FAIL $path: no '$line' header"
      return 1
    fi
  fi
  echo "ok   $path: $code $type"
}

# body_ok <body> <path> <file>
#   The body (as `curl -s` prints it) must be the file's text exactly, line ends and a trailing newline
#   aside: the asset links the Quest apps check at launch must be the ones this build carries. Also
#   notes placeholders still in the file (the apps will not launch until they are filled in).
# Prints "ok   <path>: ..." or "FAIL <path>: ..." and returns 0 or 1.
body_ok() {
  local body path file want
  body=$(printf '%s' "$1" | tr -d '\r')
  path=$2 file=$3
  [ -f "$file" ] || { echo "FAIL $path: no $file to compare with"; return 1; }
  want=$(tr -d '\r' < "$file")
  if [ -z "$body" ]; then
    echo "FAIL $path: empty body"
    return 1
  fi
  if [ "$body" != "$want" ]; then
    echo "FAIL $path: the live file is not $file"
    return 1
  fi
  echo "ok   $path: same as $(basename "$file")"
  case $body in
    *REPLACE_WITH*) echo "note $path still has placeholders: the Quest apps will not launch until scripts/twa-fill.sh fills them" ;;
  esac
}
