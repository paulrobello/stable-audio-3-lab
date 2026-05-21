.PHONY: build test lint fmt typecheck checkall dev pre-commit pre-commit-install pre-commit-update

dev:
	npm run dev

build:
	npm run build

test:
	npm run test
	python3 -m unittest discover -s tests -v

typecheck:
	npx tsc --noEmit

lint: typecheck
	@echo "No separate linter configured; TypeScript check passed."

fmt:
	@echo "No formatter configured."

checkall: test build

pre-commit:
	pre-commit run --all-files

pre-commit-install:
	pre-commit install --install-hooks --hook-type pre-commit --hook-type pre-push

pre-commit-update:
	pre-commit autoupdate
