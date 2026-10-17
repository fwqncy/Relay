.PHONY: run dev web build bench vet services reset

# Vite needs Node 20+. Prefer a Homebrew node@22 if the default node is older.
NODE_BIN := $(shell [ -x /opt/homebrew/opt/node@22/bin/node ] && echo /opt/homebrew/opt/node@22/bin)
export PATH := $(if $(NODE_BIN),$(NODE_BIN):,)$(PATH)
GOFLAGS := -buildvcs=false

# Build the web app (first run installs dependencies), then start the server.
run: web
	go run $(GOFLAGS) ./cmd/relay

web:
	cd web && ([ -d node_modules ] || npm ci) && npm run build

# Live-reloading UI on :5173 that proxies /api to a server on :8080.
dev:
	cd web && npm run dev

build: web
	go build $(GOFLAGS) -o bin/relay ./cmd/relay

bench:
	go run $(GOFLAGS) ./cmd/bench -jobs 12000

vet:
	go vet $(GOFLAGS) ./...
	cd web && npx tsc

services:
	brew services start postgresql@17
	brew services start redis

# Drops the database and stream; the next start re-creates and re-seeds them.
reset:
	dropdb --if-exists relay
	redis-cli del relay:jobs
