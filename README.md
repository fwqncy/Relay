# Relay

**Concurrent job runtime.** A work-stealing scheduler for a logistics platform, replacing a single-queue worker pool that stalled under burst traffic.

Built with **Go**, **Postgres** and **Redis Streams**. The web app (embedded in the Go binary, no build step) gives managers a live view of the runtime and gives employees their day: dock appointments, shifts and jobs.

## Run it

You need Go 1.24+, Postgres and Redis running locally.

```sh
brew install postgresql@17 redis      # if you don't have them
brew services start postgresql@17
brew services start redis

go run ./cmd/relay                    # or: make run
```

Open <http://localhost:8080>. On first start Relay creates the `relay` database, its schema, and the demo data.

With Docker instead: `docker compose up --build`.

### Demo accounts

Every account uses the password **`relay-demo`**. Each company has its own accent colour, and the app re-themes to it after sign-in.

| Company | Accent | Manager | Employee |
|---|---|---|---|
| Harborline Freight · Savannah cross-dock | teal | `maya@harborline.example` | `luis@harborline.example` |
| Meridian Cold Chain · Rotterdam reefer hub | blue | `priya@meridian.example` | `tom@meridian.example` |
| Kestrel Parcel · Leeds sortation centre | orange | `aiko@kestrel.example` | `sam@kestrel.example` |

The login page lists all six accounts; one click signs you in. The theme menu (System / Light / Dark) is on the login page and at the bottom of the sidebar.

## What's in the app

| | Manager | Employee |
|---|---|---|
| **Overview** | *Runtime*: live p95 queue latency, throughput, backlog, steals, per-worker utilisation. Switch between work-stealing and the single-queue baseline, and fire bursts to compare them. | *My day*: today's shift, upcoming dock appointments with one-tap check-in, quick actions, recent jobs. |
| **Jobs** | Every job for the company: filter by status/type, search, open payload and result, retry failures. Filters live in the URL. | Jobs they started. |
| **Dock schedule** | Door × time grid. Book slots (confirmed by a `dock.confirm` job), confirm, check in, complete. | Same grid with their appointments outlined. Check in assigned carriers. |
| **Shifts** | Weekly team grid. Add draft shifts and publish the week (one `shift.publish` job per draft). | Their published shifts and weekly hours. |

## How the runtime works

```
enqueue ──► Postgres (job row, status=queued)
        └─► XADD relay:jobs ──► consumer group "workers"
                                   │
           ┌───────────────────────┼───────────────────────┐
         w1: fill ─► local deque  w2 …                    w8
             Run: Pop ─► (empty) steal: XAUTOCLAIM idle ≥ 2s ─► (nothing) park 50ms
             exec: claim in Postgres (queued → running) ─► handler ─► batched finish + XACK
```

The worker loop in [`relay/worker.go`](relay/worker.go) is the core:

```go
func (w *Worker) Run(ctx context.Context) {
	for ctx.Err() == nil {
		job, ok := w.local.Pop()
		if !ok {
			job, ok = w.steal(ctx)
		}
		if !ok {
			w.park(ctx, 50*time.Millisecond)
			continue
		}
		w.exec(ctx, job)
	}
}
```

- **Local deques.** Each worker's `fill` goroutine prefetches from the stream with `XREADGROUP` into its own deque, so workers never contend on one queue.
- **Stealing.** A message that sits in a worker's pending list for 2 s (the worker is stuck on a slow ERP call, or crashed) is claimed by an idle peer with `XAUTOCLAIM`.
- **Exactly one execution.** Postgres is the source of truth. `exec` moves a job `queued → running` with a conditional `UPDATE`. If a peer stole the job first, the original owner loses that claim and only acks. Failed attempts retry with backoff, up to 3 attempts.
- **Batched completion.** Outcomes are flushed to Postgres and acked in batches of up to 512 every 50 ms.
- **Single-queue baseline** (`ModeSingle` in [`relay/runtime.go`](relay/runtime.go)): one poller reads and claims every job before handing it to a shared pool. This is the shape of the pool Relay replaced. Its throughput is capped by that one goroutine's round trips, so bursts back up.

Handlers in [`internal/jobs`](internal/jobs/jobs.go) do real work: nearest-neighbour + 2-opt route optimisation, haversine ETAs, ZPL label rendering, and SHA-256 photo fingerprints. Dock and shift jobs update Postgres. Only the external systems are simulated with short sleeps: the SMS gateway and the ERP, which fails about 4% of the time and hangs about 0.5% of the time, so retries and steals actually happen.

A small stream of everyday jobs runs constantly so the dashboards have live data. Set `RELAY_AMBIENT=off` to disable it.

## Load test

With the server running:

```sh
go run ./cmd/bench -jobs 12000      # or: make bench
```

This switches the runtime to each mode, enqueues the same burst, and prints the queue-latency percentiles. You can do the same from the Runtime page with **Run burst…**. On the machine this was built on (Apple Silicon, local Postgres 17 and Redis 8), a 12,000-job burst gave:

```
         mode    jobs     p50     p95     p99   jobs/s
 single-queue   12000  843 ms  1.36 s  1.40 s     8186
work-stealing   12000  469 ms  672 ms  692 ms    15864
```

Your numbers will vary with hardware. Queue latency here is measured from the moment the burst is submitted, so it includes the time to write all 12k rows and stream entries.

## Configuration

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/relay?sslmode=disable` |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `RELAY_ADDR` | `localhost:8080` |
| `RELAY_WORKERS` | `8` |
| `RELAY_PREFETCH` | `32` jobs per worker deque |
| `RELAY_MODE` | `work-stealing` (or `single-queue`) |
| `RELAY_AMBIENT` | `on` |

Jobs connections use `synchronous_commit = off`. Job state can be rebuilt from the stream, so a few milliseconds of commit durability is traded for throughput. Finished jobs are pruned after 2 hours, and load-test jobs after 20 minutes.

## Layout

```
cmd/relay        server entrypoint (DB bootstrap, seed, runtime, HTTP)
cmd/bench        burst comparison against a running server
relay/           the runtime: worker.go, deque, modes, metrics
internal/jobs    job types, handlers, payload generators
internal/store   Postgres schema, queries, demo seed data
internal/server  HTTP API, SSE metrics stream, embedded web app
```
