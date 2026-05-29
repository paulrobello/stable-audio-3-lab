#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/xcodebuild" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$PATH" >> "$TEST_XCODEBUILD_PATH_LOG"
printf '%s\n' "$*" >> "$TEST_XCODEBUILD_ARGS_LOG"

if [ "${1:-}" = "archive" ]; then
	while [ "$#" -gt 0 ]; do
		if [ "$1" = "-archivePath" ]; then
			shift
			mkdir -p "$1"
			exit 0
		fi
		shift
	done
	exit 1
fi

if [ "${1:-}" = "-exportArchive" ]; then
	while [ "$#" -gt 0 ]; do
		if [ "$1" = "-exportPath" ]; then
			shift
			mkdir -p "$1"
			exit 0
		fi
		shift
	done
	exit 1
fi

printf 'unexpected xcodebuild call: %s\n' "$*" >&2
exit 1
SH
chmod +x "$FAKE_BIN/xcodebuild"

export PATH="$FAKE_BIN:$PATH"
export TEST_XCODEBUILD_PATH_LOG="$TMP_DIR/xcodebuild-path.log"
export TEST_XCODEBUILD_ARGS_LOG="$TMP_DIR/xcodebuild-args.log"
export SCHEME="Pardora"
export APP_NAME="Pardora"
export BUNDLE_ID="net.pardev.pardora"
export TEAM_ID="QMLVG482FY"
export BUILD_NUMBER="202601010101"
export ARCHIVE_PATH="$TMP_DIR/Pardora.xcarchive"
export EXPORT_PATH="$TMP_DIR/export"
export EXPORT_OPTIONS="$ROOT_DIR/Config/ExportOptions-TestFlight.plist"
export PARVAULT_ASC_SECRET=""
export ASC_KEY_ID="KEY123"
export ASC_ISSUER_ID="issuer-123"
export ASC_KEY_PATH="$TMP_DIR/AuthKey_KEY123.p8"

touch "$ASC_KEY_PATH"
"$ROOT_DIR/scripts/testflight-upload.sh" upload >/tmp/pardora-testflight-upload-test.out

grep -F "archive -scheme Pardora" "$TEST_XCODEBUILD_ARGS_LOG" >/dev/null
grep -F "CURRENT_PROJECT_VERSION=202601010101" "$TEST_XCODEBUILD_ARGS_LOG" >/dev/null
grep -F -- "-exportArchive -archivePath $ARCHIVE_PATH -exportPath $EXPORT_PATH -exportOptionsPlist $EXPORT_OPTIONS" "$TEST_XCODEBUILD_ARGS_LOG" >/dev/null
grep -F -- "-authenticationKeyID KEY123" "$TEST_XCODEBUILD_ARGS_LOG" >/dev/null
grep -Fx "/usr/bin:/bin:/usr/sbin:/sbin" "$TEST_XCODEBUILD_PATH_LOG" >/dev/null

printf 'testflight-upload-test passed\n'
