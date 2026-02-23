SHELL := /bin/bash
DEFAULT_GOAL := help

COMPOSE := docker compose -f docker-compose.yml

.PHONY: help up down restart logs ps build config

help:
	@echo "Available targets:"
	@echo "  build         Build backend + nginx images"
	@echo "  up            Start the stack in background"
	@echo "  down          Stop and remove containers"
	@echo "  restart       Restart all services"
	@echo "  logs          Follow logs for all services"
	@echo "  ps            Show container status"
	@echo "  config        Validate and print resolved compose config"

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

