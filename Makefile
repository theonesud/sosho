.PHONY: help autotune up down restart status logs logs-llm logs-langfuse logs-music music-up music-down decision-up embed-up studio-api studio-ui test-memory clean install-cli

# Default target: display help
help:
	@echo "Sosho Management Commands:"
	@echo "  make autotune      - Auto-tune config to max out any CPU/GPU/RAM"
	@echo "  make up            - Start llama.cpp and Langfuse stack"
	@echo "  make decision-up   - Start local CPU decision model (:8081, 0 GPU VRAM)"
	@echo "  make embed-up      - Start local CPU embeddinggemma model (:8082, 0 GPU VRAM)"
	@echo "  make studio-api    - Start Sosho Studio API, SQLite DAG engine & SSE server (:4101)"
	@echo "  make studio-ui     - Start Sosho Studio React Flow canvas (:4100)"
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
	docker compose up -d

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

