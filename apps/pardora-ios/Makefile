.PHONY: generate build build-simulator build-phone test lint fmt typecheck checkall testflight-upload-script-test run run-simulator install-phone run-phone archive-testflight upload-testflight

SCHEME := Pardora
SIMULATOR_NAME := iPhone 17 Pro Max
SIMULATOR_OS := 26.5
SIMULATOR_ID ?= $(shell xcrun simctl list devices available 'iOS $(SIMULATOR_OS)' | sed -nE 's/^[[:space:]]*$(SIMULATOR_NAME) \(([0-9A-F-]+)\).*/\1/p' | head -n 1)
SIMULATOR_DESTINATION := platform=iOS Simulator,id=$(SIMULATOR_ID)
PHONE_DEVICE_ID ?= 00008150-001A089E1AD8401C
PHONE_DESTINATION ?= id=$(PHONE_DEVICE_ID)
BUNDLE_ID := net.pardev.pardora
DERIVED_DATA := build
DEVICE_DERIVED_DATA := build-device
TESTFLIGHT_BUILD_NUMBER ?= $(shell date +%Y%m%d%H%M)
TESTFLIGHT_ARCHIVE_PATH ?= $(CURDIR)/build/testflight/$(SCHEME).xcarchive
TESTFLIGHT_EXPORT_PATH ?= $(CURDIR)/build/testflight/export
TESTFLIGHT_EXPORT_OPTIONS ?= $(CURDIR)/Config/ExportOptions-TestFlight.plist
PARVAULT_ASC_SECRET ?= APPLE_APP_STORE_CONNECT
SIMULATOR_APP := $(DERIVED_DATA)/Build/Products/Debug-iphonesimulator/Pardora.app
PHONE_APP := $(DEVICE_DERIVED_DATA)/Build/Products/Debug-iphoneos/Pardora.app

generate:
	xcodegen generate

build: build-simulator

build-simulator: generate
	xcodebuild -scheme $(SCHEME) -destination '$(SIMULATOR_DESTINATION)' -derivedDataPath $(DERIVED_DATA) build

build-phone: generate
	xcodebuild -scheme $(SCHEME) -destination '$(PHONE_DESTINATION)' -derivedDataPath $(DEVICE_DERIVED_DATA) -allowProvisioningUpdates build

test: generate
	xcodebuild -scheme $(SCHEME) -destination '$(SIMULATOR_DESTINATION)' -derivedDataPath $(DERIVED_DATA) test

typecheck: build

lint: typecheck
	@echo "No separate Swift linter configured; xcodebuild passed."

fmt:
	@echo "No Swift formatter configured."

checkall: test testflight-upload-script-test

testflight-upload-script-test:
	scripts/testflight-upload-test.sh

run: run-simulator

run-simulator: build-simulator
	xcrun simctl boot '$(SIMULATOR_ID)' || true
	xcrun simctl bootstatus '$(SIMULATOR_ID)' -b
	xcrun simctl install '$(SIMULATOR_ID)' $(SIMULATOR_APP)
	xcrun simctl ui '$(SIMULATOR_ID)' appearance dark
	xcrun simctl launch '$(SIMULATOR_ID)' $(BUNDLE_ID)

install-phone: build-phone
	xcrun devicectl device install app --device '$(PHONE_DEVICE_ID)' $(PHONE_APP)

run-phone: install-phone
	xcrun devicectl device process launch --device '$(PHONE_DEVICE_ID)' --terminate-existing $(BUNDLE_ID)

archive-testflight: generate
	SCHEME="$(SCHEME)" APP_NAME="$(SCHEME)" BUNDLE_ID="$(BUNDLE_ID)" \
		TEAM_ID="QMLVG482FY" BUILD_NUMBER="$(TESTFLIGHT_BUILD_NUMBER)" \
		ARCHIVE_PATH="$(TESTFLIGHT_ARCHIVE_PATH)" EXPORT_PATH="$(TESTFLIGHT_EXPORT_PATH)" \
		EXPORT_OPTIONS="$(TESTFLIGHT_EXPORT_OPTIONS)" PARVAULT_ASC_SECRET="$(PARVAULT_ASC_SECRET)" \
		scripts/testflight-upload.sh archive

upload-testflight: generate
	SCHEME="$(SCHEME)" APP_NAME="$(SCHEME)" BUNDLE_ID="$(BUNDLE_ID)" \
		TEAM_ID="QMLVG482FY" BUILD_NUMBER="$(TESTFLIGHT_BUILD_NUMBER)" \
		ARCHIVE_PATH="$(TESTFLIGHT_ARCHIVE_PATH)" EXPORT_PATH="$(TESTFLIGHT_EXPORT_PATH)" \
		EXPORT_OPTIONS="$(TESTFLIGHT_EXPORT_OPTIONS)" PARVAULT_ASC_SECRET="$(PARVAULT_ASC_SECRET)" \
		scripts/testflight-upload.sh upload
