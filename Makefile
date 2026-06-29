# Gopher — local-first verification entrypoint (EP-0004).
# Plain commands, no cloud CI, no external account. Each stage is independently runnable.
# Flutter is resolved from PATH, falling back to ~/flutter/bin (see docs/development.md).

SHELL := /usr/bin/env bash
BUN ?= bun
FLUTTER ?= $(shell command -v flutter 2>/dev/null || echo $(HOME)/flutter/bin/flutter)
SERVER := src/server
CLIENT := src/client
INFRA := src/infra
COMPOSE := docker compose -f $(INFRA)/docker-compose.yml

.DEFAULT_GOAL := help

.PHONY: help verify check test build migrate \
        server-check server-deps server-typecheck server-lint server-test \
        client-check client-deps client-analyze client-test \
        build-api build-web up down

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## ---- aggregate ----
verify: server-check client-check build ## FULL entrypoint: checks + API image + web build
check: server-check client-check ## Fast verification (deps, types, lint, tests; no builds)
test: server-test client-test ## Run all tests
build: build-api build-web ## Build API image + web bundle

## ---- server ----
server-check: server-deps server-typecheck server-lint server-test ## Server: deps, types, lint, tests

server-deps:
	cd $(SERVER) && $(BUN) install --frozen-lockfile

server-typecheck:
	cd $(SERVER) && $(BUN) run typecheck

server-lint:
	cd $(SERVER) && $(BUN) run check

server-test:
	cd $(SERVER) && $(BUN) test

## ---- client ----
client-check: client-deps client-analyze client-test ## Client: deps, analyze, tests

client-deps:
	cd $(CLIENT) && $(FLUTTER) pub get

client-analyze:
	cd $(CLIENT) && $(FLUTTER) analyze

client-test:
	cd $(CLIENT) && $(FLUTTER) test

## ---- build ----
build-api: ## Build the API Docker image
	$(COMPOSE) build api

build-web: ## Build the Flutter web release bundle
	cd $(CLIENT) && $(FLUTTER) build web --release

## ---- db ----
migrate: ## Apply Drizzle migrations to a disposable local Postgres (EP-0007+)
	@if [ -f $(SERVER)/drizzle.config.ts ]; then \
	  echo "Running migrations against $$DATABASE_URL"; \
	  cd $(SERVER) && $(BUN) run db:migrate; \
	else \
	  echo "No migrations yet (drizzle.config.ts arrives in EP-0007) — skipping."; \
	fi

## ---- stack helpers ----
up: ## Start the local stack (base compose; no override)
	$(COMPOSE) up -d

down: ## Stop the local stack (keep volumes)
	$(COMPOSE) down
