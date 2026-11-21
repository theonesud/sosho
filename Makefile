# Sosho commands. There are six public targets.
#
#   make setup  Install tools, dependencies, and git hooks. Link the pi and yue2-music launchers.
#   make check  Run every non-mutating check in one pass. Vale prints warnings only.
#   make fix    Apply safe auto-fixes (format and lint fixes).
#   make up     Start Docker services for PROFILES and the Studio dev servers.
#   make down   Stop the Studio dev servers and all Docker profiles.
#   make logs   Follow Docker logs. Use S=<service> for one service.
#
# Override PROFILES in local.mk (gitignored) or on the command line: make up PROFILES=music
# Other scripts stay callable directly: ./bin/doctor.sh, ./bin/autotune.sh, ./tests/run_tests.sh.

.PHONY: setup check fix up down logs

# Run tools through mise so they work without an activated shell.
RUN := mise exec --

# Compose profiles for `make up` and `make logs`. The music profile is off by default.
PROFILES ?= llm decision embed
-include local.mk
PROFILE_FLAGS := $(addprefix --profile ,$(PROFILES))

# Legacy paths. The new gates skip them. The rebuild stages remove them from this list.
LEGACY := apps packages yue2 workflows tests docker compose.yaml .pi .agents/skills .impeccable \
	models bin/autotune.sh bin/doctor.sh bin/pi-launcher.sh bin/chunk-read.sh
LEGACY_DOCS := readme.md PRODUCT.md DESIGN.md REFACTOR_PLAN.md model_params.md usecases.md docs/context
EXCL := $(foreach p,$(LEGACY),':(exclude)$(p)')
EXCL_MD := $(EXCL) $(foreach p,$(LEGACY_DOCS),':(exclude)$(p)')
# List tracked and new files that exist on disk.
LS := git ls-files -co --exclude-standard
EXISTS := while read -r f; do [ -f "$$f" ] && echo "$$f"; done; true

SH_FILES = $(shell $(LS) -- '*.sh' $(EXCL) | ($(EXISTS)))
DOCKER_FILES = $(shell $(LS) -- ':(glob)**/Dockerfile*' ':(glob)**/*.Dockerfile' $(EXCL) | ($(EXISTS)))
TOML_FILES = $(shell $(LS) -- '*.toml' $(EXCL) | ($(EXISTS)))
PY_FILES = $(shell $(LS) -- '*.py' $(EXCL) | ($(EXISTS)))
TSCONFIGS = $(shell $(LS) -- ':(glob)**/tsconfig.json' $(EXCL) | ($(EXISTS)))
MD_FILES = $(shell $(LS) -- '*.md' $(EXCL_MD) | ($(EXISTS)))
SHFMT := $(RUN) shfmt -i 2 -ci

# Make needs a default goal. Print a pointer so a bare `make` changes nothing.
.DEFAULT_GOAL := _usage
_usage:
	@echo "Targets: setup check fix up down logs. Read the top of the Makefile."

# The mise postinstall hook runs pnpm install, uv sync, and lefthook install.
setup:
	mise trust
	mise install
	@if [ ! -f .env ]; then ./bin/autotune.sh; fi
	mkdir -p "$$HOME/.local/bin"
	chmod +x "$(CURDIR)/bin/pi-launcher.sh" "$(CURDIR)/yue2/generate.sh"
	ln -sf "$(CURDIR)/bin/pi-launcher.sh" "$$HOME/.local/bin/pi"
	ln -sf "$(CURDIR)/yue2/generate.sh" "$$HOME/.local/bin/yue2-music"

# Run every check, keep going after a failure, and exit non-zero if any check failed.
check:
	@rc=0; \
	echo "== agent docs"; ./bin/check-agent-docs.sh || rc=1; \
	echo "== biome"; $(RUN) pnpm exec biome check --no-errors-on-unmatched . || rc=1; \
	echo "== tsc"; \
	if [ -z "$(TSCONFIGS)" ]; then echo "NOTE: no TypeScript project found. Skip tsc."; \
	else for p in $(TSCONFIGS); do $(RUN) pnpm exec tsc -p "$$p" --noEmit || rc=1; done; fi; \
	echo "== ruff"; $(RUN) uv run ruff format --check . || rc=1; $(RUN) uv run ruff check . || rc=1; \
	echo "== pyright"; \
	if [ -z "$(PY_FILES)" ]; then echo "NOTE: no Python file found. Skip Pyright."; \
	else $(RUN) uv run pyright $(PY_FILES) || rc=1; fi; \
	echo "== shell"; \
	if [ -z "$(SH_FILES)" ]; then echo "NOTE: no in-scope shell file. Skip shell checks."; \
	else $(RUN) shellcheck $(SH_FILES) || rc=1; $(SHFMT) -d $(SH_FILES) || rc=1; fi; \
	echo "== hadolint"; \
	if [ -z "$(DOCKER_FILES)" ]; then echo "NOTE: no in-scope Dockerfile. Skip hadolint."; \
	else $(RUN) hadolint $(DOCKER_FILES) || rc=1; fi; \
	echo "== taplo"; \
	if [ -z "$(TOML_FILES)" ]; then echo "NOTE: no in-scope TOML file. Skip taplo."; \
	else $(RUN) taplo check --no-schema $(TOML_FILES) || rc=1; $(RUN) taplo fmt --check $(TOML_FILES) || rc=1; fi; \
	echo "== vitest"; $(RUN) pnpm exec vitest run --passWithNoTests || rc=1; \
	echo "== pytest"; \
	$(RUN) uv run pytest -q; t=$$?; \
	if [ $$t -eq 5 ]; then echo "NOTE: no pytest tests found. Skip."; elif [ $$t -ne 0 ]; then rc=1; fi; \
	echo "== vale (warnings only)"; \
	if [ -z "$(MD_FILES)" ]; then echo "NOTE: no in-scope Markdown file. Skip Vale."; \
	else $(RUN) vale --no-exit $(MD_FILES) || true; fi; \
	exit $$rc

# Safe auto-fixes only.
fix:
	$(RUN) pnpm exec biome check --write --no-errors-on-unmatched .
	$(RUN) uv run ruff format .
	$(RUN) uv run ruff check --fix .
	@if [ -n "$(SH_FILES)" ]; then $(SHFMT) -w $(SH_FILES); fi
	@if [ -n "$(TOML_FILES)" ]; then $(RUN) taplo fmt $(TOML_FILES); fi

up:
	$(RUN) docker compose $(PROFILE_FLAGS) up -d
	@mkdir -p .pi/run
	@if ! lsof -iTCP:4101 -sTCP:LISTEN >/dev/null 2>&1; then \
		nohup npm --prefix apps/studio run dev:api > .pi/run/studio-api.log 2>&1 & echo $$! > .pi/run/studio-api.pid; \
	fi
	@if ! lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then \
		nohup npm --prefix apps/studio run dev:ui > .pi/run/studio-ui.log 2>&1 & echo $$! > .pi/run/studio-ui.pid; \
	fi
	@echo "Studio UI: http://127.0.0.1:3000  API: http://127.0.0.1:4101/api/docs"

down:
	@for f in .pi/run/studio-ui.pid .pi/run/studio-api.pid; do \
		if [ -f "$$f" ]; then kill "$$(cat "$$f")" 2>/dev/null || true; rm -f "$$f"; fi; \
	done
	$(RUN) docker compose --profile llm --profile music --profile agent --profile decision --profile embed --profile orchestration down

logs:
	$(RUN) docker compose $(PROFILE_FLAGS) logs -f $(S)
