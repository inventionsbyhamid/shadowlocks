#!/usr/bin/env bash
# Build the Quest APKs with Meta's Bubblewrap and check each one against Meta's release rules, inside an Android build
# container on the build server, from the repo root:
#   bash scripts/twa-build.sh [--test [--icons-from <host>]] [--out <dir>] store|competition...
#   --test              a test build: a throwaway keystore made inside the container (never the real one, never kept),
#                       placeholders allowed, and apk-check skips the App ID and signing key comparisons. The APK is
#                       not kept: only its dumps and the check report.
#   --icons-from <host> (with --test) fetch the icons and the web manifest from this host when the app's own host does
#                       not serve the game yet. The APK still opens the app's own host.
#   --out <dir>         where each app's files go: <dir>/<app>/ (default test-results/twa)
# A real build reads the keystore password on stdin (one line) and signs with the keystore at the configs' signingKey
# path, /secrets/shadowlocks-android.keystore, mounted read-only for that build only (plan: ship steps, step 25). It
# keeps the APK as <dir>/<app>/shadowlocks-<app>-<version>.apk.
#
# For each app, in order, any failure stopping the build:
#   1. node scripts/twa-config.mjs check --app <app>: the config is the generator's, no placeholder left for it;
#   2. the host serves the icons as PNG (Bubblewrap fetches them: deploy the game to the app's host first);
#   3. bubblewrap update --skipVersionUpgrade (the version is the config's; raise it with twa-config fill
#      --<app>-version <n>);
#   4. node scripts/twa-config.mjs patch: what Meta's release rules want and Bubblewrap has no setting for;
#   5. bubblewrap build --skipSigning (Bubblewrap never sees the password: its own signing passes it to apksigner and
#      jarsigner on their command lines), then zipalign, then apksigner signs with scheme v2 (Meta's
#      VRC.Quest.Packaging.2), the passwords read from the environment of that one command;
#   6. aapt and apksigner dumps (xmltree.txt, badging.txt, apksigner.txt), and node scripts/twa-config.mjs apk-check
#      (apk-check.txt): every release rule, one line each, and the checked APK's SHA-256 last.
# Secrets: the password lives in an unexported shell variable and reaches keytool and apksigner only through their
# environment (`-storepass:env`, `--ks-pass env:`), never a command line, a log or a file; the script never runs with
# set -x. A test key, and everything else the build writes, stays in the scratch folder inside the container.
# Needs JDK 17, Node 18 or later, the Android SDK's cmdline-tools and the network (Bubblewrap from npm, SDK packages,
# Gradle and its libraries). reactnativecommunity/react-native-android on the build server has them all (TWA_IMAGE
# below). The SDK packages the build needs go into a scratch SDK next to links to the image's tools, and everything
# else (Bubblewrap, Gradle, the project, a test key) into the same scratch folder, removed at the end.
set -euo pipefail

# Meta's Bubblewrap fork, the version Meta's PWA packaging page was verified with (2026-10-22).
BUBBLEWRAP=@meta-quest/bubblewrap-cli@1.24.1
# The build tools Bubblewrap 1.24.1 wants (zipalign, apksigner and aapt come from them too), and the platform the patched
# project compiles against.
BUILD_TOOLS=34.0.0
PLATFORM=android-34
# The image this was tested in (for the command in the ship steps).
TWA_IMAGE=reactnativecommunity/react-native-android@sha256:e817ea1959719c97c05adbc55348ebe21d286cec2caed1f18ad3c4b88c08cbf7
: "$TWA_IMAGE"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

TEST=0 ICONS= OUT=test-results/twa APPS=()
while [ $# -gt 0 ]; do
  case $1 in
    --test) TEST=1; shift ;;
    --icons-from) [ $# -ge 2 ] || usage; ICONS=$2; shift 2 ;;
    --out) [ $# -ge 2 ] || usage; OUT=$2; shift 2 ;;
    store|competition) APPS+=("$1"); shift ;;
    *) usage ;;
  esac
done
[ ${#APPS[@]} -ge 1 ] || usage
if [ -n "$ICONS" ]; then
  [ "$TEST" = 1 ] || { echo "twa-build: --icons-from is for test builds only" >&2; exit 2; }
  [[ $ICONS =~ ^[a-z0-9.-]+$ ]] || { echo "twa-build: --icons-from takes a host name" >&2; exit 2; }
fi
[ -f scripts/twa-config.mjs ] || { echo "twa-build: run it from the repo root" >&2; exit 2; }
for tool in node npm java keytool curl; do
  command -v "$tool" >/dev/null || { echo "twa-build: no $tool in this image" >&2; exit 2; }
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/twa-build.XXXXXX")
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT TERM HUP
# A home of our own when the container user has none (Bubblewrap keeps its config there, Gradle and the SDK tools
# their caches).
if [ -z "${HOME:-}" ] || [ ! -w "${HOME:-/}" ]; then export HOME=$TMP/home; fi
mkdir -p "$HOME"
export GRADLE_USER_HOME=$TMP/gradle ANDROID_USER_HOME=$TMP/android-user
JAVA_HOME=${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}
export JAVA_HOME

# The keystore and its password: a throwaway pair for a test build, else the real keystore and the password on stdin.
# PW is never exported: only keytool and apksigner get it, as TWA_KS_PASS in their own environment.
KEY_PATH=$(node -p 'require("./twa/store/twa-manifest.json").signingKey.path')
KEY_ALIAS=$(node -p 'require("./twa/store/twa-manifest.json").signingKey.alias')
unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD TWA_KS_PASS
if [ "$TEST" = 1 ]; then
  PW=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
  KEY_PATH=$TMP/test.keystore
  TWA_KS_PASS=$PW keytool -genkeypair -keystore "$KEY_PATH" -storetype PKCS12 -alias "$KEY_ALIAS" -keyalg RSA \
    -keysize 2048 -validity 3 -dname "CN=Shadow Locks test build" -storepass:env TWA_KS_PASS -keypass:env TWA_KS_PASS \
    >/dev/null 2>&1
  echo "twa-build: test build, signed with a throwaway key made for this run"
else
  [ -r "$KEY_PATH" ] || { echo "twa-build: no keystore at $KEY_PATH (mount it read-only for the build)" >&2; exit 2; }
  IFS= read -r PW || true
  [ -n "${PW:-}" ] || { echo "twa-build: no keystore password on stdin" >&2; exit 2; }
fi

# The Android SDK, with the build tools and platform the build needs.
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$SDK" ] && [ -d "$SDK" ] || { echo "twa-build: no Android SDK (ANDROID_HOME)" >&2; exit 2; }
SDKMANAGER=$(command -v sdkmanager || ls "$SDK"/cmdline-tools/*/bin/sdkmanager 2>/dev/null | head -1)
[ -n "$SDKMANAGER" ] || { echo "twa-build: no sdkmanager in $SDK/cmdline-tools" >&2; exit 2; }
# A scratch SDK, so the image's own is never changed: links to its tools, its accepted licenses, and the packages
# below. Bubblewrap takes an SDK only with a tools/ or bin/ folder at its top (the layout it installs itself).
TOOLS=$(dirname "$(dirname "$(readlink -f "$SDKMANAGER")")")
mkdir -p "$TMP/sdk/cmdline-tools"
if [ -d "$SDK/licenses" ]; then cp -r "$SDK/licenses" "$TMP/sdk/"; fi
ln -s "$TOOLS" "$TMP/sdk/cmdline-tools/latest"
ln -s "$TOOLS/bin" "$TMP/sdk/bin"
if [ -d "$SDK/platform-tools" ]; then ln -s "$SDK/platform-tools" "$TMP/sdk/platform-tools"; fi
SDK=$TMP/sdk
echo "twa-build: SDK packages build-tools;$BUILD_TOOLS and platforms;$PLATFORM in $SDK"
yes 2>/dev/null | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --sdk_root="$SDK" "build-tools;$BUILD_TOOLS" "platforms;$PLATFORM" >/dev/null
export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
BT=$SDK/build-tools/$BUILD_TOOLS

echo "twa-build: installing $BUBBLEWRAP"
npm install --prefix "$TMP/bw" --no-audit --no-fund --no-update-notifier --loglevel=error "$BUBBLEWRAP" >/dev/null
BW=$TMP/bw/node_modules/.bin/bubblewrap
mkdir -p "$HOME/.bubblewrap"
printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$JAVA_HOME" "$SDK" > "$HOME/.bubblewrap/config.json"
echo "twa-build: bubblewrap $("$BW" --version 2>/dev/null | tail -1), JDK $JAVA_HOME"

for app in "${APPS[@]}"; do
  echo "== $app"
  conf=twa/$app/twa-manifest.json
  if [ "$TEST" = 1 ]; then node scripts/twa-config.mjs check --app "$app" --allow-placeholders
  else node scripts/twa-config.mjs check --app "$app"; fi
  host=$(node -p 'require(process.argv[1]).host' "./$conf")
  version=$(node -p 'require(process.argv[1]).appVersionCode' "./$conf")
  icons=${ICONS:-$host}
  for want in "/icons/icon-512.png image/png" "/icons/icon-512-maskable.png image/png" "/manifest.webmanifest application/manifest+json"; do
    p=${want% *} type=${want#* }
    got=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 20 "https://$icons$p" || true)
    case $got in
      "200 $type"*) ;;
      *) echo "twa-build: https://$icons$p answers '$got', not $type: deploy the game to $icons first (Bubblewrap takes the app's icons and web manifest from its host)" >&2
         exit 1 ;;
    esac
  done
  dir=$TMP/$app
  mkdir -p "$dir"
  # The config as it is, except in a test build: the throwaway key, and the icons and web manifest (which Bubblewrap
  # copies into the APK) from --icons-from.
  node -e '
    const fs = require("fs");
    const [src, dst, test, key, icons] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(src, "utf8"));
    if (test === "1") m.signingKey = { ...m.signingKey, path: key };
    if (icons) for (const k of ["iconUrl", "maskableIconUrl", "webManifestUrl"]) m[k] = m[k].replace(/^https:\/\/[^/]+/, `https://${icons}`);
    fs.writeFileSync(dst, `${JSON.stringify(m, null, 2)}\n`);
  ' "$conf" "$dir/twa-manifest.json" "$TEST" "$KEY_PATH" "$ICONS"
  (cd "$dir" && "$BW" update --skipVersionUpgrade)
  node scripts/twa-config.mjs patch "$dir"
  # Unsigned: Bubblewrap's own signing would put the password on apksigner's and jarsigner's command lines.
  (cd "$dir" && "$BW" build --skipPwaValidation --skipSigning)
  unsigned=$dir/app-release-unsigned-aligned.apk
  aligned=$dir/app-release-aligned.apk
  apk=$dir/app-release-signed.apk
  [ -f "$unsigned" ] || { echo "twa-build: bubblewrap build made no app-release-unsigned-aligned.apk" >&2; exit 1; }
  "$BT/zipalign" -p -f 4 "$unsigned" "$aligned"
  # VRC.Quest.Packaging.2: "The application must be signed with APK Signature Scheme v2." apksigner's default for a
  # minSdkVersion of 28 or more is v3 alone (it keeps to that even when asked for v2 too), so sign with v2 alone: what
  # the Android Gradle Plugin gives a release APK by default, and what Quest has always taken (v1 is for Android 6 and
  # older; v3 adds only key rotation). The passwords come from this one command's environment.
  TWA_KS_PASS=$PW "$BT/apksigner" sign --ks "$KEY_PATH" --ks-key-alias "$KEY_ALIAS" --ks-pass env:TWA_KS_PASS \
    --key-pass env:TWA_KS_PASS --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled false \
    --out "$apk" "$aligned"
  out=$OUT/$app
  rm -rf "$out"
  mkdir -p "$out"
  cp "$dir/app/src/main/AndroidManifest.xml" "$out/AndroidManifest.xml"
  "$BT/aapt" dump xmltree "$apk" AndroidManifest.xml > "$out/xmltree.txt"
  "$BT/aapt" dump badging "$apk" > "$out/badging.txt"
  "$BT/apksigner" verify --verbose --print-certs "$apk" > "$out/apksigner.txt" 2>&1 || true
  checked=(node scripts/twa-config.mjs apk-check "$apk" --app "$app" --build-tools "$BT")
  if [ "$TEST" = 1 ]; then checked+=(--test); fi
  "${checked[@]}" | tee "$out/apk-check.txt"
  # The checked file's hash: before an upload, the file to upload must have this one.
  echo "sha256 $(sha256sum "$apk" | cut -d' ' -f1) shadowlocks-$app-$version.apk" | tee -a "$out/apk-check.txt"
  if [ "$TEST" = 1 ]; then
    echo "twa-build: $app test APK checked; not kept (throwaway key)"
  else
    cp "$apk" "$out/shadowlocks-$app-$version.apk"
    echo "twa-build: $app APK: $out/shadowlocks-$app-$version.apk"
  fi
done
