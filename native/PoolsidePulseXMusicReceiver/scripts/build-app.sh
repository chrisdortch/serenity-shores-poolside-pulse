#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
APP_NAME='Poolside Pulse X Music Receiver.app'
APP="$ROOT/dist/$APP_NAME"
BUILD="$ROOT/.build-local"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SWIFTC="$(xcrun --find swiftc)"
ARCH="$(uname -m)"
TARGET="$ARCH-apple-macosx13.0"
MODULE_CACHE="$BUILD/module-cache"
SIGN_IDENTITY="${POOLSIDE_CODE_SIGN_IDENTITY:--}"

mkdir -p "$BUILD" "$MODULE_CACHE" "$ROOT/dist"

COMMON=(
  -sdk "$SDK"
  -target "$TARGET"
  -module-cache-path "$MODULE_CACHE"
)

"$SWIFTC" "${COMMON[@]}" -O \
  -o "$BUILD/PoolsidePulseXMusicReceiver" \
  "$ROOT/Sources/PoolsidePulseXMusicReceiver/ReceiverWebView.swift" \
  "$ROOT/Sources/PoolsidePulseXMusicReceiver/PoolsidePulseXMusicReceiverApp.swift"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD/PoolsidePulseXMusicReceiver" "$APP/Contents/MacOS/PoolsidePulseXMusicReceiver"
cp "$ROOT/AppResources/Info.plist" "$APP/Contents/Info.plist"

codesign \
  --force \
  --deep \
  --options runtime \
  --sign "$SIGN_IDENTITY" \
  "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
if [[ "$SIGN_IDENTITY" == '-' ]]; then
  SIGNING_DETAILS="$(codesign -d --verbose=4 "$APP" 2>&1)"
  if [[ "$SIGNING_DETAILS" != *'Signature=adhoc'* ]]; then
    echo 'ERROR: expected an ad hoc app signature.' >&2
    exit 1
  fi
  echo 'NOTE: ad hoc signed for this personal Mac. Use POOLSIDE_CODE_SIGN_IDENTITY for a stable Developer ID signature.' >&2
fi
echo "$APP"
