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

"$SWIFTC" "${COMMON[@]}" -O -parse-as-library \
  -emit-module -emit-library -static \
  -module-name ReceiverCore \
  -emit-module-path "$BUILD/ReceiverCore.swiftmodule" \
  -o "$BUILD/libReceiverCore.a" \
  "$ROOT/Sources/ReceiverCore/BridgeRequest.swift" \
  "$ROOT/Sources/ReceiverCore/MusicAutomation.swift" \
  "$ROOT/Sources/ReceiverCore/ReceiverBridgeService.swift"

"$SWIFTC" "${COMMON[@]}" -O -parse-as-library \
  -I "$BUILD" -L "$BUILD" -lReceiverCore \
  -o "$BUILD/ReceiverCoreSelfTests" \
  "$ROOT/Tests/ReceiverCoreTests/BridgeRequestSelfTests.swift"
"$BUILD/ReceiverCoreSelfTests"

"$SWIFTC" "${COMMON[@]}" -O \
  -I "$BUILD" -L "$BUILD" -lReceiverCore \
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
  --entitlements "$ROOT/AppResources/PoolsidePulseXMusicReceiver.entitlements" \
  "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
if [[ "$SIGN_IDENTITY" == '-' ]]; then
  echo 'NOTE: ad hoc signed for this personal Mac. Use POOLSIDE_CODE_SIGN_IDENTITY for a stable Developer ID signature.' >&2
fi
echo "$APP"
