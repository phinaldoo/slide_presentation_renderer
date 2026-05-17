DEFAULT_GOAL := help

COMPOSE := docker compose -f docker-compose.yml

ifeq ($(OS),Windows_NT)
SHELL := powershell.exe
.SHELLFLAGS := -NoProfile -ExecutionPolicy Bypass -Command
SETUP_COMMAND := .\setup.ps1
SETUP_QUIET_REDIRECT := > $$null
else
SHELL := /bin/bash
SETUP_COMMAND := bash ./setup.sh
SETUP_QUIET_REDIRECT := > /dev/null
endif

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
	@$(SETUP_COMMAND)
else
	@$(SETUP_COMMAND) $(SETUP_QUIET_REDIRECT)
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
