.PHONY: build test lint fmt typecheck checkall dev

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

typecheck:
	npx tsc --noEmit

lint: typecheck
	@echo "No separate linter configured; TypeScript check passed."

fmt:
	@echo "No formatter configured."

checkall: test build
