# Sosho commands. There are six public targets.
#
#   make setup  Install mise if it is missing. Install the pinned tools and dependencies.
#               Check nvm and load Node from .nvmrc. Link the pi and yue2-music launchers.
#               Add PATH and mise lines to the shell rc files.
#   make check  Run every non-mutating check in one pass. Vale prints warnings only.
#   make fix    Apply safe auto-fixes (format and lint fixes).
#   make up     Start the always-on Docker services (root compose.yaml). Then start the
#               Studio API and UI dev servers. Print the service URLs.
#   make down   Stop the Studio dev servers. Stop all Docker services, including the music profile.
#   make logs   Follow Docker logs for all services, music profile included. Use S=<service> for one.
#
# The YuE2 music services are optional. Start them with: docker compose -p sosho --profile music up -d
# Override variables in local.mk (gitignored) or on the command line.

.PHONY: setup check fix up down logs

# Path to mise. Use the copy on PATH, or the default installer path.
MISE := $(shell command -v mise 2>/dev/null || echo $(HOME)/.local/bin/mise)

# Node comes from nvm. The version comes from .nvmrc. Setup puts this bin directory first on PATH.
NODE_VERSION := $(strip $(shell cat .nvmrc))
NODE_BIN := $(HOME)/.nvm/versions/node/v$(NODE_VERSION)/bin

# Run tools through mise so they work without an activated shell.
RUN := $(MISE) exec --
-include local.mk

# Root compose file. The project name keeps the existing volumes.
COMPOSE := docker compose -p sosho

# Moved-in code. The strict gates skip it until it passes review against docs/standards.
# packages/llm, packages/memory, packages/workflow-engine, and packages/yue2 are pending review.
LEGACY := legacy apps workflows packages/llm packages/memory packages/workflow-engine packages/yue2 docker/Dockerfile.yue2-gateway .pi .agents/skills models
LEGACY_DOCS := usecases.md
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

# Install mise when it is missing. Then trust the repo and install the pinned tools.
# The mise postinstall hook runs pnpm install, uv sync, and lefthook install.
setup:
	@if [ ! -x "$(MISE)" ]; then \
		echo "mise not found. Installing to $$HOME/.local/bin/mise."; \
		curl -fsSL https://mise.run | sh; \
	fi
	@# Node comes from nvm and .nvmrc. Stop when nvm is missing. Do not install nvm here.
	@if [ ! -s "$$HOME/.nvm/nvm.sh" ]; then \
		echo "STOP: nvm not found at $$HOME/.nvm/nvm.sh. Node comes from nvm and .nvmrc."; \
		echo "Install nvm with the official command from https://github.com/nvm-sh/nvm:"; \
		echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash"; \
		echo "Then open a new shell and run make setup again."; \
		exit 1; \
	fi
	@cd "$(CURDIR)" && bash -c '. "$$HOME/.nvm/nvm.sh" && nvm install && nvm use && test "$$(node --version)" = "v$(NODE_VERSION)"' || { echo "STOP: nvm did not select Node v$(NODE_VERSION). Read the nvm output above."; exit 1; }
	$(MISE) trust
	PATH="$(NODE_BIN):$$PATH" $(MISE) install
	@mkdir -p "$$HOME/.local/bin"
	@# Link the pi launcher. Move a regular file to pi.bak once. Never overwrite an existing pi.bak.
	@b="$$HOME/.local/bin"; t="$(CURDIR)/bin/pi-launcher.sh"; \
	if [ -e "$$b/pi" ] && [ ! -L "$$b/pi" ]; then \
		if [ -e "$$b/pi.bak" ]; then echo "STOP: $$b/pi.bak exists. Move $$b/pi aside by hand."; exit 1; fi; \
		mv "$$b/pi" "$$b/pi.bak"; echo "Moved $$b/pi to $$b/pi.bak"; \
	fi; \
	ln -sf "$$t" "$$b/pi"; echo "Linked $$b/pi to $$t"
	@# Link the yue2-music launcher with the same rule.
	@b="$$HOME/.local/bin"; t="$(CURDIR)/packages/yue2/generate.sh"; \
	if [ -e "$$b/yue2-music" ] && [ ! -L "$$b/yue2-music" ]; then \
		if [ -e "$$b/yue2-music.bak" ]; then echo "STOP: $$b/yue2-music.bak exists. Move $$b/yue2-music aside by hand."; exit 1; fi; \
		mv "$$b/yue2-music" "$$b/yue2-music.bak"; echo "Moved $$b/yue2-music to $$b/yue2-music.bak"; \
	fi; \
	ln -sf "$$t" "$$b/yue2-music"; echo "Linked $$b/yue2-music to $$t"
	@# Add the PATH and mise lines once to each shell rc file. Skip a file that has the marker.
	@changed=""; \
	for pair in zsh:.zshrc bash:.bashrc; do \
		sh=$${pair%%:*}; rc="$$HOME/$${pair#*:}"; \
		if [ ! -e "$$rc" ]; then \
			if [ "$$sh" = zsh ] && [ "$$(basename "$$SHELL")" = zsh ]; then : > "$$rc"; else continue; fi; \
		fi; \
		if grep -q '^# >>> sosho setup >>>' "$$rc"; then echo "Shell setup already present in $$rc"; continue; fi; \
		printf '%s\n' '# >>> sosho setup >>>' \
			'case ":$$PATH:" in *":$$HOME/.local/bin:"*) ;; *) export PATH="$$HOME/.local/bin:$$PATH" ;; esac' \
			"command -v mise >/dev/null 2>&1 && eval \"\$$(mise activate $$sh)\"" \
			'# <<< sosho setup <<<' >> "$$rc"; \
		changed="$$changed $$rc"; echo "Added shell setup to $$rc"; \
	done; \
	if [ -n "$$changed" ]; then echo "Changed files:$$changed. Open a new shell to load them."; \
	else echo "No shell rc file changed."; fi
	@# Install Studio and root workspace dependencies when pnpm-workspace.yaml lists members.
	@if [ -f pnpm-workspace.yaml ] && grep -q '^  - ' pnpm-workspace.yaml; then PATH="$(NODE_BIN):$$PATH" $(RUN) pnpm install; fi

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

# Start the always-on Docker services. Then start the Studio dev servers in the background.
# Logs and pids go to .pi/run/. A server that already listens on its port is left alone.
up:
	$(RUN) $(COMPOSE) up -d
	@mkdir -p .pi/run
	@if ! lsof -iTCP:4101 -sTCP:LISTEN >/dev/null 2>&1; then \
		nohup npm --prefix apps/studio run dev:api > .pi/run/studio-api.log 2>&1 & echo $$! > .pi/run/studio-api.pid; \
	fi
	@if ! lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then \
		nohup npm --prefix apps/studio run dev:ui > .pi/run/studio-ui.log 2>&1 & echo $$! > .pi/run/studio-ui.pid; \
	fi
	@echo "Studio UI:   http://127.0.0.1:3000"
	@echo "Studio API:  http://127.0.0.1:4101/api/docs"
	@echo "Langfuse:    http://127.0.0.1:3001"
	@echo "LiteLLM:     http://127.0.0.1:4000"
	@echo "LangGraph:   http://127.0.0.1:8123"
	@echo "Langflow:    http://127.0.0.1:7860"

# Stop the Studio dev servers. Then stop every Docker service, including the music profile.
down:
	@for f in .pi/run/studio-ui.pid .pi/run/studio-api.pid; do \
		if [ -f "$$f" ]; then kill "$$(cat "$$f")" 2>/dev/null || true; rm -f "$$f"; fi; \
	done
	$(RUN) $(COMPOSE) --profile music down

# Follow Docker logs for every service. Use S=<service> for one service.
logs:
	$(RUN) $(COMPOSE) --profile music logs -f $(S)
