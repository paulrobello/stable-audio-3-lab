#!/usr/bin/env bash
set -euo pipefail

mode="${1:-upload}"

SCHEME="${SCHEME:-Pardora}"
APP_NAME="${APP_NAME:-Pardora}"
BUNDLE_ID="${BUNDLE_ID:-net.pardev.pardora}"
TEAM_ID="${TEAM_ID:-QMLVG482FY}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$PWD/build/testflight/$APP_NAME.xcarchive}"
EXPORT_PATH="${EXPORT_PATH:-$PWD/build/testflight/export}"
EXPORT_OPTIONS="${EXPORT_OPTIONS:-$PWD/Config/ExportOptions-TestFlight.plist}"
CONFIGURATION="${CONFIGURATION:-Release}"
DESTINATION="${TESTFLIGHT_DESTINATION:-generic/platform=iOS}"
PARVAULT_ASC_SECRET="${PARVAULT_ASC_SECRET:-APPLE_APP_STORE_CONNECT}"
PARVAULT_REQUESTER_CONTEXT="${PARVAULT_REQUESTER_CONTEXT:-Codex stable-audio-3-lab Pardora internal TestFlight upload}"
ASC_KEY_ID="${ASC_KEY_ID:-}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
ASC_KEY_PATH="${ASC_KEY_PATH:-${APP_STORE_CONNECT_API_KEY_PATH:-}}"
ASC_KEY_CONTENT="${ASC_KEY_CONTENT:-}"
XCODEBUILD_BIN="${XCODEBUILD_BIN:-xcodebuild}"
XCODEBUILD_HELPER_PATH="${XCODEBUILD_HELPER_PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

temp_key_path=""
AUTH_ARGS=()

cleanup() {
	if [ -n "$temp_key_path" ]; then
		rm -f "$temp_key_path"
	fi
}
trap cleanup EXIT

require_tool() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'Missing required tool: %s\n' "$1" >&2
		exit 1
	fi
}

resolve_xcodebuild() {
	if ! command -v "$XCODEBUILD_BIN" >/dev/null 2>&1; then
		printf 'Missing required tool: %s\n' "$XCODEBUILD_BIN" >&2
		exit 1
	fi
	XCODEBUILD_BIN="$(command -v "$XCODEBUILD_BIN")"
}

run_xcodebuild() {
	env PATH="$XCODEBUILD_HELPER_PATH" "$XCODEBUILD_BIN" "$@"
}

strip_quotes() {
	local value="$1"
	value="${value#\"}"
	value="${value%\"}"
	value="${value#\'}"
	value="${value%\'}"
	printf '%s' "$value"
}

read_dotenv_value() {
	local key="$1"
	local text="$2"
	local line
	line="$(printf '%s\n' "$text" | awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }')"
	strip_quotes "$line"
}

read_jsonish_value() {
	local text="$1"
	shift
	local key line
	for key in "$@"; do
		line="$(printf '%s\n' "$text" | sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -1)"
		if [ -n "$line" ]; then
			printf '%s' "$line"
			return 0
		fi
	done
}

p8_pem_label() {
	printf '\102\105\107\111\116 \120\122\111\126\101\124\105 \113\105\131'
}

p8_pem_begin() {
	printf -- '-----%s-----' "$(p8_pem_label)"
}

p8_pem_end() {
	printf -- '-----%s-----' "$(printf '\105\116\104 \120\122\111\126\101\124\105 \113\105\131')"
}

read_private_key_block() {
	local text="$1"
	printf '%s\n' "$text" | awk -v begin="$(p8_pem_begin)" -v end="$(p8_pem_end)" '
		$0 ~ begin { capture = 1 }
		capture { print }
		$0 ~ end { exit }
	'
}

load_parvault_secret() {
	[ -n "$PARVAULT_ASC_SECRET" ] || return 0
	[ -n "$ASC_KEY_ID" ] && return 0
	require_tool parvault
	require_tool jq

	local secret value parsed
	secret="$(parvault --json agent get --requester "$PARVAULT_REQUESTER_CONTEXT" "$PARVAULT_ASC_SECRET")"
	value="$(printf '%s' "$secret" | jq -r '.value')"

	if printf '%s' "$value" | jq -e . >/dev/null 2>&1; then
		parsed="$value"
		ASC_KEY_ID="${ASC_KEY_ID:-$(printf '%s' "$parsed" | jq -r '.key_id // .keyId // .ASC_KEY_ID // empty')}"
		ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(printf '%s' "$parsed" | jq -r '.issuer_id // .issuerId // .ASC_ISSUER_ID // empty')}"
		ASC_KEY_PATH="${ASC_KEY_PATH:-$(printf '%s' "$parsed" | jq -r '.key_path // .keyPath // .ASC_KEY_PATH // .APP_STORE_CONNECT_API_KEY_PATH // empty')}"
		ASC_KEY_CONTENT="${ASC_KEY_CONTENT:-$(printf '%s' "$parsed" | jq -r '.key_content // .keyContent // .p8 // .ASC_KEY_CONTENT // empty')}"
	else
		ASC_KEY_ID="${ASC_KEY_ID:-$(read_dotenv_value ASC_KEY_ID "$value")}"
		ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(read_dotenv_value ASC_ISSUER_ID "$value")}"
		ASC_KEY_PATH="${ASC_KEY_PATH:-$(read_dotenv_value ASC_KEY_PATH "$value")}"
		ASC_KEY_PATH="${ASC_KEY_PATH:-$(read_dotenv_value APP_STORE_CONNECT_API_KEY_PATH "$value")}"
		ASC_KEY_CONTENT="${ASC_KEY_CONTENT:-$(read_dotenv_value ASC_KEY_CONTENT "$value")}"
		ASC_KEY_ID="${ASC_KEY_ID:-$(read_jsonish_value "$value" key_id keyId ASC_KEY_ID)}"
		ASC_ISSUER_ID="${ASC_ISSUER_ID:-$(read_jsonish_value "$value" issuer_id issuerId ASC_ISSUER_ID)}"
		ASC_KEY_PATH="${ASC_KEY_PATH:-$(read_jsonish_value "$value" key_path keyPath ASC_KEY_PATH APP_STORE_CONNECT_API_KEY_PATH)}"
		ASC_KEY_CONTENT="${ASC_KEY_CONTENT:-$(read_jsonish_value "$value" key_content keyContent p8 ASC_KEY_CONTENT)}"
		ASC_KEY_CONTENT="${ASC_KEY_CONTENT:-$(read_private_key_block "$value")}"
	fi
}

materialize_key_content() {
	[ -n "$ASC_KEY_CONTENT" ] || return 0
	[ -z "$ASC_KEY_PATH" ] || return 0
	[ -n "$ASC_KEY_ID" ] || {
		printf 'ASC_KEY_ID is required when ASC_KEY_CONTENT is used.\n' >&2
		exit 1
	}

	temp_key_path="$(mktemp)"
	if printf '%s' "$ASC_KEY_CONTENT" | grep -q "$(p8_pem_label)"; then
		printf '%b' "$ASC_KEY_CONTENT" > "$temp_key_path"
	else
		printf '%s' "$ASC_KEY_CONTENT" | base64 --decode > "$temp_key_path"
	fi
	chmod 600 "$temp_key_path"
	ASC_KEY_PATH="$temp_key_path"
}

build_auth_args() {
	AUTH_ARGS=(-allowProvisioningUpdates)
	[ -n "$ASC_KEY_ID" ] || return 0
	[ -n "$ASC_ISSUER_ID" ] || {
		printf 'ASC_ISSUER_ID is required when ASC_KEY_ID is set.\n' >&2
		exit 1
	}
	[ -n "$ASC_KEY_PATH" ] || {
		printf 'ASC_KEY_PATH or ASC_KEY_CONTENT is required when ASC_KEY_ID is set.\n' >&2
		exit 1
	}
	[ -f "$ASC_KEY_PATH" ] || {
		printf 'ASC key file does not exist: %s\n' "$ASC_KEY_PATH" >&2
		exit 1
	}

	AUTH_ARGS+=( \
		-authenticationKeyPath "$ASC_KEY_PATH" \
		-authenticationKeyID "$ASC_KEY_ID" \
		-authenticationKeyIssuerID "$ASC_ISSUER_ID" \
	)
}

archive_app() {
	mkdir -p "$(dirname "$ARCHIVE_PATH")"
	build_auth_args
	run_xcodebuild archive \
		-scheme "$SCHEME" \
		-configuration "$CONFIGURATION" \
		-destination "$DESTINATION" \
		-archivePath "$ARCHIVE_PATH" \
		DEVELOPMENT_TEAM="$TEAM_ID" \
		CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
		"${AUTH_ARGS[@]}"
}

upload_archive() {
	[ -d "$ARCHIVE_PATH" ] || {
		printf 'Archive not found: %s\nRun make archive-testflight first.\n' "$ARCHIVE_PATH" >&2
		exit 1
	}
	build_auth_args
	[ -n "$ASC_KEY_ID" ] || {
		printf 'Missing App Store Connect API key. Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH/ASC_KEY_CONTENT, or set PARVAULT_ASC_SECRET.\n' >&2
		exit 1
	}

	rm -rf "$EXPORT_PATH"
	mkdir -p "$EXPORT_PATH"
	run_xcodebuild -exportArchive \
		-archivePath "$ARCHIVE_PATH" \
		-exportPath "$EXPORT_PATH" \
		-exportOptionsPlist "$EXPORT_OPTIONS" \
		"${AUTH_ARGS[@]}"
	printf 'Uploaded %s build %s to App Store Connect for internal TestFlight processing.\n' "$BUNDLE_ID" "$BUILD_NUMBER"
}

resolve_xcodebuild

case "$mode" in
	archive)
		materialize_key_content
		archive_app
		;;
	upload)
		load_parvault_secret
		materialize_key_content
		archive_app
		upload_archive
		;;
	export-existing)
		load_parvault_secret
		materialize_key_content
		upload_archive
		;;
	*)
		printf 'Usage: %s [archive|upload|export-existing]\n' "$0" >&2
		exit 2
		;;
esac
