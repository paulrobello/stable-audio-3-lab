.PHONY: generate build test lint fmt typecheck checkall run

SCHEME := Pardora
DESTINATION := platform=iOS Simulator,name=iPhone 17 Pro Max,OS=26.5
DERIVED_DATA := build
APP := $(DERIVED_DATA)/Build/Products/Debug-iphonesimulator/Pardora.app

generate:
	xcodegen generate

build: generate
	xcodebuild -scheme $(SCHEME) -destination '$(DESTINATION)' -derivedDataPath $(DERIVED_DATA) build

test: generate
	xcodebuild -scheme $(SCHEME) -destination '$(DESTINATION)' -derivedDataPath $(DERIVED_DATA) test

typecheck: build

lint: typecheck
	@echo "No separate Swift linter configured; xcodebuild passed."

fmt:
	@echo "No Swift formatter configured."

checkall: test

run: build
	xcrun simctl install booted $(APP)
	xcrun simctl ui booted appearance dark
	xcrun simctl launch booted net.pardev.pardora
