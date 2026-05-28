.PHONY: generate build build-simulator build-phone test lint fmt typecheck checkall run run-simulator install-phone run-phone

SCHEME := Pardora
SIMULATOR_NAME := iPhone 17 Pro Max
SIMULATOR_DESTINATION := platform=iOS Simulator,name=$(SIMULATOR_NAME),OS=26.5
PHONE_DEVICE_ID ?= 00008150-001A089E1AD8401C
PHONE_DESTINATION ?= id=$(PHONE_DEVICE_ID)
BUNDLE_ID := net.pardev.pardora
DERIVED_DATA := build
DEVICE_DERIVED_DATA := build-device
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

checkall: test

run: run-simulator

run-simulator: build-simulator
	xcrun simctl boot '$(SIMULATOR_NAME)' || true
	xcrun simctl bootstatus '$(SIMULATOR_NAME)' -b
	xcrun simctl install booted $(SIMULATOR_APP)
	xcrun simctl ui booted appearance dark
	xcrun simctl launch booted $(BUNDLE_ID)

install-phone: build-phone
	xcrun devicectl device install app --device '$(PHONE_DEVICE_ID)' $(PHONE_APP)

run-phone: install-phone
	xcrun devicectl device process launch --device '$(PHONE_DEVICE_ID)' --terminate-existing $(BUNDLE_ID)
