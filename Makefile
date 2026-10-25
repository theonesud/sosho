.PHONY: help autotune up down restart status logs logs-llm logs-langfuse logs-music music-up music-down clean install-cli

# Default target: display help
help:
	@echo "Sosho Management Commands:"
	@echo "  make autotune      - Auto-tune config to max out any CPU/GPU/RAM"
	@echo "  make up            - Start llama.cpp and Langfuse stack"
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

down:
	docker compose --profile music --profile agent down

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
	cp bin/pi-launcher.sh ~/.local/bin/pi
	cp bin/yue2-generate.sh ~/.local/bin/yue2-music
	chmod +x ~/.local/bin/pi ~/.local/bin/yue2-music
	@echo "Installed ~/.local/bin/pi and ~/.local/bin/yue2-music"
