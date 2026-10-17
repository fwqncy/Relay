# Relay

**Concurrent job runtime.** A work-stealing scheduler for a logistics platform, replacing a single-queue worker pool that stalled under burst traffic. It ships with a full logistics workspace, plus a 3D realm map whose fleet grows from horse carts to container ships as you deliver.

Built with **Go**, **Postgres** and **Redis Streams** on the server. The web app is **React**, **React Three Fiber / three.js** and **GSAP**, built with Vite and embedded in the Go binary.

## Run it

You need Go 1.24+, Node 20+, Postgres and Redis.

```sh
brew install postgresql@17 redis node@22   # if you don't have them
make services                              # start Postgres and Redis
make run                                   # build the web app, then start the server
```

Open <http://localhost:8080>. On first start Relay creates the `relay` database, the schema and all the demo data.

`make dev` runs the UI with hot reload on :5173. It proxies the API to a server on :8080.

With Docker: `docker compose up --build`.

### Demo accounts

Every account uses the password **`relay-demo`**. The login page lists all six, and one click signs you in.

| Company | Manager | Employee | Realm |
|---|---|---|---|
| Harborline Freight · Savannah | `maya@harborline.example` | `luis@harborline.example` | Port operator: container cranes, steam freight, balloons |
| Meridian Cold Chain · Rotterdam | `priya@meridian.example` | `tom@meridian.example` | Reefer hub: steamships, semis, diesel freight |
| Kestrel Parcel · Leeds | `aiko@kestrel.example` | `sam@kestrel.example` | Parcel network: road trains, cargo jets, sailboats |

## Appearance

- **Mode:** System, Light or Dark, from a dropdown in the sidebar, on the login and landing pages, and in Settings.
- **Colour scheme:** **Moss** (grey stone and dark green, the default), **Burgundy**, **Navy**, **Company** (your company's brand colour) or **Custom**.
- **Custom:** pick any colour on a colour wheel, with a brightness slider and a hex field. Lightness is tuned per mode, so text keeps its contrast whatever you pick.
- **How schemes work:** each scheme is four numbers (neutral and accent hue and chroma). [`tokens.css`](web/src/styles/tokens.css) turns them into a full OKLCH palette for each mode.
- **Persistence:** appearance is saved to your account and applied before first paint, so there's no theme flash.

## The realm map

Every delivery earns XP for its mode. Each mode has five levels, and each level changes the vehicles on a living 3D map of your network:

| Level | Sea | Road | Rail | Air |
|---|---|---|---|---|
| 1 | Sailboat | Horse cart | Steam engine | Hot-air balloon |
| 2 | Galleon | Delivery van | Steam freight | Biplane |
| 3 | Steamship | Box truck | Diesel freight | Prop freighter |
| 4 | Coastal freighter | Semi truck | Intermodal freight | Cargo jet |
| 5 | Container ship | Road train | Maglev freight | Heavy-lift jet |

Levels unlock at 50, 150, 400 and 1,000 deliveries. The more you have, the more the map shows:

- **Vehicles:** every in-transit shipment is a vehicle, and the target number of shipments in motion rises with each level.
- **Town and port:** staff raise houses around the keep, dock doors become berths, and SKUs fill warehouses.
- **Infrastructure:** roads go from dirt to cobbles to asphalt, piers gain gantry cranes at sea level 4, and the runway is paved from air level 2.

Click any vehicle, or pick it from the list, to fly to it and see its shipment. Managers can **fast-forward** time: it runs a tracking sync for every active shipment through the job runtime, deliveries land, and level-ups play a banner and unlock milestones. Lighting follows your local time of day, and you can switch to Day, Dusk or Night. You can also pause all motion, which starts paused if your system asks for reduced motion.

## The workspace

- **Runtime:** live p95 queue latency, throughput, backlog and per-worker utilisation over SSE. Switch between work-stealing and the single-queue baseline, and fire bursts to compare them.
- **Shipments:** sea, road, rail and air bookings with a tracking timeline, progress and on-time status. Filters live in the URL, and lists export to CSV.
- **Dock schedule:** a door × time grid. Booking, confirmation and check-in each run as a job.
- **Inventory:** stock against reorder points. A reorder books an inbound truck, which restocks the item on delivery.
- **Shifts and time off:** a weekly grid with drafts and publishing. Requests show on the grid once approved.
- **Analytics** (managers): volume by mode, on-time rate against the previous period, transit times and a carrier scorecard.
- **Activity log** (managers): every sign-in, booking, decision and adjustment.
- **Notifications:** delays, low stock, level-ups and decisions, live in a bell with toasts for the important ones.
- **Command menu (⌘K):** search shipments, stock, people, appointments and jobs, or run any action. `g` + a letter jumps between pages, and `?` lists every shortcut.

A built-in simulation keeps each company's network moving. It books shipments, syncs tracking and picks stock, all as jobs on the runtime.

## How the runtime works

```
enqueue ──► Postgres (job row, status=queued)
        └─► XADD relay:jobs ──► consumer group "workers"
           w1: fill ─► local deque     w2 …     w8
               Run: Pop ─► (empty) steal: XAUTOCLAIM idle ≥ 2s ─► (nothing) park 50ms
               exec: claim in Postgres (queued → running) ─► handler ─► batched finish + XACK
```

The worker loop in [`relay/worker.go`](relay/worker.go):

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

- **Local deques:** each worker prefetches with `XREADGROUP` into its own deque.
- **Stealing:** a message idle for 2 s in a peer's pending list (a stuck ERP call, or a crash) is claimed with `XAUTOCLAIM`.
- **Exactly one execution:** a conditional `UPDATE` (queued → running) means a stolen job runs once. Failed attempts retry with backoff, up to 3 times.
- **Single-queue baseline:** one poller claims every job before handing it to a shared pool. It's the shape of the pool Relay replaced.

### Load test

With the server running, run `make bench`, or use **Run burst…** on the Runtime page. On an Apple Silicon laptop with local Postgres 17 and Redis 8, a 12,000-job burst gave:

```
         mode    jobs     p50     p95     p99   jobs/s
 single-queue   12000  843 ms  1.36 s  1.40 s     8186
work-stealing   12000  469 ms  672 ms  692 ms    15864
```

## Configuration

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/relay?sslmode=disable` |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `RELAY_ADDR` | `localhost:8080` |
| `RELAY_WORKERS` / `RELAY_PREFETCH` | `8` / `32` |
| `RELAY_MODE` | `work-stealing` (or `single-queue`) |
| `RELAY_AMBIENT` | `on`. Set to `off` to stop the background traffic and simulation |

`make reset` drops the database and the stream, and the next start re-seeds everything.

## Layout

```
cmd/relay         server: DB bootstrap, seed, runtime, simulation, HTTP
cmd/bench         burst comparison against a running server
relay/            the runtime: worker.go, deque, modes, metrics
internal/realm    levels, vehicle tiers, milestones, lanes and carriers
internal/sim      keeps each network moving through the runtime
internal/jobs     job types and handlers (routing, labels, tracking, stock…)
internal/store    Postgres schema, queries, demo seed
internal/server   HTTP API, SSE stream, CSV export, embedded web app
web/              React app: pages, components, three/ (landing + realm scenes)
```
