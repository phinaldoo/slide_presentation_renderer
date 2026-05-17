SHELL := /bin/bash
DEFAULT_GOAL := help

COMPOSE := docker compose -f docker-compose.yml

.PHONY: help setup up down restart logs ps

help:
	@echo "Available targets:"
	@echo "  setup         Prepare .env, certs directory, and required secrets"
	@echo "  up            Start the stack in background"
	@echo "  down          Stop and remove containers"
	@echo "  restart       Restart all services"
	@echo "  logs          Follow logs for all services"
	@echo "  ps            Show container status"

setup:
ifeq ($(filter setup,$(MAKECMDGOALS)),setup)
	@bash ./setup.sh
else
	@bash ./setup.sh > /dev/null
endif

up: setup
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

restart: down up

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps
