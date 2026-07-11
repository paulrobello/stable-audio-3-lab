.PHONY: build test lint fmt typecheck checkall dev dev-stop dev-restart pre-commit pre-commit-install pre-commit-update pardora-generate pardora-build pardora-test pardora-checkall pardora-run pardora-archive-testflight pardora-upload-testflight

dev:
	npm run dev

dev-stop:
	@lsof -ti:3007 | xargs kill -9 2>/dev/null || echo "No process on port 3007"

dev-restart: dev-stop dev

build:
	npm run build

test:
	npm run test
	python3 -m unittest discover -s tests -v

typecheck:
	npx tsc --noEmit

lint: typecheck
	npx eslint .
	@echo "Lint passed (tsc + eslint)."

fmt:
	@echo "No formatter configured."

checkall: test build

pre-commit:
	pre-commit run --all-files

pre-commit-install:
	pre-commit install --install-hooks --hook-type pre-commit --hook-type pre-push

pre-commit-update:
	pre-commit autoupdate

pardora-generate:
	$(MAKE) -C apps/pardora-ios generate

pardora-build:
	$(MAKE) -C apps/pardora-ios build

pardora-test:
	$(MAKE) -C apps/pardora-ios test

pardora-checkall:
	$(MAKE) -C apps/pardora-ios checkall

pardora-run:
	$(MAKE) -C apps/pardora-ios run

pardora-archive-testflight:
	$(MAKE) -C apps/pardora-ios archive-testflight

pardora-upload-testflight:
	$(MAKE) -C apps/pardora-ios upload-testflight
