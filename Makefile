.PHONY: setup test test-fast cov fix up down logs worker worker-install worker-uninstall worker-logs

MISE := $(shell command -v mise 2>/dev/null || echo $(HOME)/.local/bin/mise)

NODE_VERSION := $(strip $(shell cat .nvmrc))
NODE_BIN := $(HOME)/.nvm/versions/node/v$(NODE_VERSION)/bin

RUN := $(MISE) exec --
-include local.mk

COMPOSE := docker compose -p sosho

LEGACY := legacy packages/memory packages/yue2 docker/Dockerfile.yue2-gateway .pi .agents/skills models
LEGACY_DOCS := docs/usecases.md
EXCL := $(foreach p,$(LEGACY),':(exclude)$(p)')
EXCL_MD := $(EXCL) $(foreach p,$(LEGACY_DOCS),':(exclude)$(p)')
LS := git ls-files -co --exclude-standard
EXISTS := while read -r f; do [ -f "$$f" ] && echo "$$f"; done; true

SH_FILES = $(shell $(LS) -- '*.sh' $(EXCL) | ($(EXISTS)))
DOCKER_FILES = $(shell $(LS) -- ':(glob)**/Dockerfile*' ':(glob)**/*.Dockerfile' $(EXCL) | ($(EXISTS)))
TOML_FILES = $(shell $(LS) -- '*.toml' $(EXCL) | ($(EXISTS)))
PY_FILES = $(shell $(LS) -- '*.py' $(EXCL) | ($(EXISTS)))
TSCONFIGS = $(shell $(LS) -- ':(glob)**/tsconfig.json' $(EXCL) | ($(EXISTS)))
MD_FILES = $(shell $(LS) -- '*.md' $(EXCL_MD) | ($(EXISTS)))
ALL_FILES = $(shell $(LS) $(EXCL) | ($(EXISTS)))
SHFMT := $(RUN) shfmt -i 2 -ci

.DEFAULT_GOAL := _usage
_usage:
	@echo "Sosho targets: setup, test, test-fast, cov, fix, up, down, logs, worker, worker-install, worker-uninstall, worker-logs."
	@echo "make setup: install mise, the pinned tools, and dependencies. Link the pi and yue2-music launchers."
	@echo "make test: run every non-mutating check and test. Vale prints warnings only."
	@echo "  Integration tests skip a service that does not answer. Run make up first."
	@echo "  LIVE_STRICT=1 fails on a missing service. Tests call only local models."
	@echo "make test-fast: run every check and pytest -m 'not integration'. No model, no GPU, no live stack."
	@echo "  The pre-push hook runs it. Skip the outdated dependency report."
	@echo "make cov: run only the pytest tests with coverage. make test COV=1 adds coverage to the full run."
	@echo "make fix: apply safe auto-fixes (format and lint fixes)."
	@echo "make up: start the Docker services. Print the service URLs."
	@echo "make down: stop all Docker services, music profile included."
	@echo "make logs: follow Docker logs for all services. Use S=<service> for one service."
	@echo "make worker: run the host worker for pi sessions in the foreground."
	@echo "make worker-install: install and start the systemd user service sosho-worker."
	@echo "make worker-uninstall: stop and remove the service. make worker-logs: follow its log."
	@echo "Music profile: docker compose -p sosho --profile music up -d"
	@echo "Override variables in local.mk (gitignored) or on the command line."

setup:
	@if [ ! -x "$(MISE)" ]; then \
		echo "mise not found. Installing to $$HOME/.local/bin/mise."; \
		curl -fsSL https://mise.run | sh; \
	fi
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
	@./bin/ensure-secrets.sh
	@mkdir -p "$$HOME/.local/bin"
	@b="$$HOME/.local/bin"; t="$(CURDIR)/bin/pi-launcher.sh"; \
	if [ -e "$$b/pi" ] && [ ! -L "$$b/pi" ]; then \
		if [ -e "$$b/pi.bak" ]; then echo "STOP: $$b/pi.bak exists. Move $$b/pi aside by hand."; exit 1; fi; \
		mv "$$b/pi" "$$b/pi.bak"; echo "Moved $$b/pi to $$b/pi.bak"; \
	fi; \
	ln -sf "$$t" "$$b/pi"; echo "Linked $$b/pi to $$t"
	@b="$$HOME/.local/bin"; t="$(CURDIR)/packages/yue2/generate.sh"; \
	if [ -e "$$b/yue2-music" ] && [ ! -L "$$b/yue2-music" ]; then \
		if [ -e "$$b/yue2-music.bak" ]; then echo "STOP: $$b/yue2-music.bak exists. Move $$b/yue2-music aside by hand."; exit 1; fi; \
		mv "$$b/yue2-music" "$$b/yue2-music.bak"; echo "Moved $$b/yue2-music to $$b/yue2-music.bak"; \
	fi; \
	ln -sf "$$t" "$$b/yue2-music"; echo "Linked $$b/yue2-music to $$t"
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
	@if [ -f pnpm-workspace.yaml ] && grep -q '^  - ' pnpm-workspace.yaml; then PATH="$(NODE_BIN):$$PATH" $(RUN) pnpm install; fi

COVFLAG := $(if $(COV),--cov)
LEGACY_TS_TESTS := packages/memory/test .pi/extensions/subagents/src

test: PYTEST_SELECT :=
test-fast: PYTEST_SELECT := -m "not integration"
test-fast: FAST := 1
test test-fast:
	@rc=0; \
	echo "== agent docs"; ./bin/check-agent-docs.sh || rc=1; \
	echo "== comments"; $(RUN) uv run python bin/check-comments.py $(ALL_FILES) || rc=1; \
	echo "== file length"; $(RUN) uv run python bin/check-file-length.py $(ALL_FILES) || rc=1; \
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
	echo "== legacy tsx tests"; \
	for d in $(LEGACY_TS_TESTS); do pkg=$$(dirname "$$d"); for f in $$d/*.test.ts; do \
		if out=$$(PATH="$(NODE_BIN):$$PATH" $(RUN) pnpm --dir "$$pkg" exec tsx "$${f#"$$pkg"/}" 2>&1); then echo "ok   $$f"; \
		else echo "FAIL $$f"; printf '%s\n' "$$out" | grep -m3 -E 'Error|assert' || true; rc=1; fi; \
	done; done; \
	echo "== pytest"; \
	$(RUN) uv run pytest -q -rs $(PYTEST_SELECT) $(COVFLAG); t=$$?; \
	if [ $$t -eq 5 ]; then echo "NOTE: no pytest tests found. Skip."; elif [ $$t -ne 0 ]; then rc=1; fi; \
	echo "== pytest (yue2 gateway)"; \
	$(RUN) uv run pytest -q -p no:cacheprovider packages/yue2/gateway/test_gateway.py || rc=1; \
	if [ -z "$(FAST)" ]; then \
		echo "== outdated dependencies (warnings only)"; \
		$(RUN) pnpm outdated -r || true; \
		$(RUN) uv pip list --outdated || true; \
	fi; \
	echo "== vale (warnings only)"; \
	if [ -z "$(MD_FILES)" ]; then echo "NOTE: no in-scope Markdown file. Skip Vale."; \
	else $(RUN) vale --config .config/vale/vale.ini --no-exit $(MD_FILES) || true; fi; \
	exit $$rc

cov:
	$(RUN) uv run pytest -q -rs --cov

fix:
	$(RUN) pnpm exec biome check --write --no-errors-on-unmatched .
	$(RUN) uv run ruff format .
	$(RUN) uv run ruff check --fix .
	@if [ -n "$(SH_FILES)" ]; then $(SHFMT) -w $(SH_FILES); fi
	@if [ -n "$(TOML_FILES)" ]; then $(RUN) taplo fmt $(TOML_FILES); fi

up:
	$(RUN) $(COMPOSE) up -d
	@./bin/worker-service.sh restart
	@echo "Langfuse:    http://127.0.0.1:3001"
	@echo "LiteLLM:     http://127.0.0.1:4000"

down:
	$(RUN) $(COMPOSE) --profile music down

logs:
	$(RUN) $(COMPOSE) --profile music logs -f $(S)

worker:
	./bin/worker-service.sh run

worker-install:
	PATH="$(NODE_BIN):$$PATH" ./bin/worker-service.sh install

worker-uninstall:
	./bin/worker-service.sh uninstall

worker-logs:
	./bin/worker-service.sh logs
