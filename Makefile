.PHONY: help autotune doctor test up down restart status logs logs-llm logs-langfuse logs-music music-up music-down decision-up embed-up studio-api studio-ui test-memory clean install-cli

# Default target: display help
help:
	@echo "Sosho Management Commands:"
	@echo "  make autotune      - Auto-tune config to max out any CPU/GPU/RAM"
	@echo "  make up            - Start all on-demand services + Sosho Studio (:3000 & :4101)"
	@echo "  make decision-up   - Start local CPU decision model (:8081, 0 GPU VRAM)"
	@echo "  make embed-up      - Start local CPU embeddinggemma model (:8082, 0 GPU VRAM)"
	@echo "  make studio-api    - Start Sosho Studio API, SQLite DAG engine & SSE server (:4101)"
	@echo "  make studio-ui     - Start Sosho Studio Next.js UI (:3000)"
	@echo "  make test-memory   - Run two-tier memory unit tests"
	@echo "  make down          - Stop all running Sosho services"
	@echo "  make restart       - Restart core services"
	@echo "  make status        - Display service and container status"
	@echo "  make logs          - Tail logs for all core services"
	@echo "  make logs-llm      - Tail logs for llama-cpp"
	@echo "  make logs-music    - Tail logs for YuE2 audio engine & gateway"
	@echo "  make music-up      - Start YuE2 music generation services"
	@echo "  make music-down    - Stop YuE2 music services"
	@echo "  make install-cli   - Install pi & yue2-music launchers into ~/.local/bin"

up:
	docker compose --profile decision --profile embed --profile music up -d
	@mkdir -p .pi
	@if ! ss -ltn 2>/dev/null | grep -q ':4101 '; then \
		nohup npm --prefix apps/studio run dev:api > .pi/studio-api.log 2>&1 & echo $$! > .pi/studio-api.pid; \
	fi
	@if ! ss -ltn 2>/dev/null | grep -q ':3000 '; then \
		nohup npm --prefix apps/studio run dev:ui > .pi/studio-ui.log 2>&1 & echo $$! > .pi/studio-ui.pid; \
	fi
	@echo ""
	@echo "Sosho is starting (models load on demand):"
	@echo "  Studio UI:  http://127.0.0.1:3000"
	@echo "  API Docs:   http://127.0.0.1:4101/api/docs"
	@echo "  Langfuse:   http://127.0.0.1:3001"
	@echo "  Main LLM:   http://127.0.0.1:8080"
	@echo "  Decision:   http://127.0.0.1:8081"
	@echo "  Embed:      http://127.0.0.1:8082"
	@echo "  YuE2 Audio: http://127.0.0.1:8021/docs"

decision-up:
	docker compose --profile decision up -d

embed-up:
	docker compose --profile embed up -d

studio-api:
	cd apps/studio && npm run dev:api

studio-ui:
	cd apps/studio && npm run dev:ui

test-memory:
	cd packages/memory && npx tsx test/memory.test.ts && npx tsx test/capture.test.ts

down:
	@for f in .pi/studio-ui.pid .pi/studio-api.pid; do \
		if [ -f "$$f" ]; then kill "$$(cat "$$f")" 2>/dev/null || true; rm -f "$$f"; fi; \
	done
	docker compose --profile music --profile agent --profile decision --profile embed down

restart:
	docker compose restart llama-cpp

status:
	docker compose ps

logs:
	docker compose logs -f

logs-llm:
	docker compose logs -f llama-cpp

logs-langfuse:
	docker compose -f docker/compose.langfuse.yaml logs -f

music-up:
	docker compose --profile music up -d

music-down:
	docker compose stop yue2-gateway yue2-engine

logs-music:
	docker compose logs -f yue2-gateway yue2-engine

autotune:
	./bin/autotune.sh

doctor:
	./bin/doctor.sh

test:
	./tests/run_tests.sh

clean-cache:
	@echo "Cleaning local Pi agent cache and temporary logs..."
	rm -rf .pi/.cache .pi/sessions/
	@echo "Cleaned."

prune:
	docker system prune -f

install-cli:
	mkdir -p ~/.local/bin
	chmod +x "$(CURDIR)/bin/pi-launcher.sh" "$(CURDIR)/yue2/generate.sh"
	ln -sf "$(CURDIR)/bin/pi-launcher.sh" ~/.local/bin/pi
	ln -sf "$(CURDIR)/yue2/generate.sh" ~/.local/bin/yue2-music
	@echo "Installed ~/.local/bin/pi and ~/.local/bin/yue2-music"

