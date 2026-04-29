SHELL := /bin/bash
DEFAULT_GOAL := help

COMPOSE := docker compose -f docker-compose.yml
PYTHON ?= python3
TEST_PYTHON ?= $(shell for candidate in python3 python3.13 python3.12 python3.11 python; do \
	if command -v $$candidate >/dev/null 2>&1 && $$candidate -c "import pytest" >/dev/null 2>&1; then \
		echo $$candidate; \
		exit 0; \
	fi; \
done; \
echo python3)

.PHONY: help up down restart logs ps build config test

help:
	@echo "Available targets:"
	@echo "  build         Build backend + nginx images"
	@echo "  up            Start the stack in background"
	@echo "  down          Stop and remove containers"
	@echo "  restart       Restart all services"
	@echo "  logs          Follow logs for all services"
	@echo "  ps            Show container status"
	@echo "  config        Validate and print resolved compose config"
	@echo "  install-dev   Install backend runtime + test dependencies into the selected Python env"
	@echo "  test          Run backend tests (requires dev dependencies)"

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

restart: down up

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

config:
	$(COMPOSE) config

install-dev:
	$(PYTHON) -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt

test:
	@$(TEST_PYTHON) -c "import pytest" >/dev/null 2>&1 || \
		(echo "pytest is not installed for $(TEST_PYTHON). Run 'make install-dev PYTHON=<python>' first." >&2; exit 2)
	$(TEST_PYTHON) -m pytest backend/tests
