SHELL := /bin/bash
DEFAULT_GOAL := help

COMPOSE := ./script/compose.sh -f docker-compose.yml
PYTHON ?= python3
TEST_PYTHON ?= $(shell for candidate in python3 python3.13 python3.12 python3.11 python; do \
	if command -v $$candidate >/dev/null 2>&1 && $$candidate -c "import pytest" >/dev/null 2>&1; then \
		echo $$candidate; \
		exit 0; \
	fi; \
done; \
echo python3)
BUILD ?= true
ifneq ($(filter true 1 yes on,$(BUILD)),)
COMPOSE_BUILD_FLAG := --build
else
COMPOSE_BUILD_FLAG :=
endif

.PHONY: help setup build up down restart logs ps config install-dev install-v2 test update

help:
	@echo "Available targets:"
	@echo "  setup         Create/sync .env and generate API_KEYS when needed"
	@echo "  build         Build backend + nginx images"
	@echo "  up            Start the stack in background"
	@echo "  down          Stop and remove containers"
	@echo "  restart       Restart all services"
	@echo "  logs          Follow logs for all services"
	@echo "  ps            Show container status"
	@echo "  config        Validate and print resolved compose config"
	@echo "  install-dev   Install backend Python deps and v2 Node deps for local development"
	@echo "  install-v2    Install v2 Node renderer dependencies"
	@echo "  test          Run backend tests (requires dev dependencies)"
	@echo "  update        Pull latest changes from git"
	@echo ""
	@echo "Set BUILD=false to skip image rebuilds during up/restart."

setup:
ifeq ($(filter setup,$(MAKECMDGOALS)),setup)
	@./setup.sh
else
	@./setup.sh > /dev/null
endif

build: setup
	$(COMPOSE) build

up: setup
	@$(COMPOSE) up -d $(COMPOSE_BUILD_FLAG) || { \
		status=$$?; \
		echo ""; \
		echo "up failed. Showing recent backend logs:"; \
		$(COMPOSE) logs --no-color --tail=120 backend || true; \
		echo ""; \
		echo "Tip: run 'make ps' and 'make logs' for more details."; \
		exit $$status; \
	}

down:
	$(COMPOSE) down --remove-orphans || true

restart: down up

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

config: setup
	$(COMPOSE) config

install-dev:
	$(PYTHON) -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
	npm --prefix v2 ci
	npm --prefix v2 run install-browsers

install-v2:
	npm --prefix v2 ci
	npm --prefix v2 run install-browsers

test:
	@$(TEST_PYTHON) -c "import pytest" >/dev/null 2>&1 || \
		(echo "pytest is not installed for $(TEST_PYTHON). Run 'make install-dev PYTHON=<python>' first." >&2; exit 2)
	$(TEST_PYTHON) -m pytest backend/tests

update:
	git pull --rebase --autostash
