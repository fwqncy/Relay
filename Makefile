.PHONY: run build bench vet services reset

run:
	go run ./cmd/relay

build:
	go build -o bin/relay ./cmd/relay

bench:
	go run ./cmd/bench -jobs 12000

vet:
	go vet ./...

services:
	brew services start postgresql@17
	brew services start redis

# Drops the database and stream; the next start re-creates and re-seeds them.
reset:
	dropdb --if-exists relay
	redis-cli del relay:jobs
