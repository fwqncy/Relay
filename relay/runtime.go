package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Mode selects how jobs reach workers.
type Mode string

const (
	// ModeStealing gives every worker its own prefetching deque and lets
	// idle workers claim jobs that stalled in a peer's pending list.
	ModeStealing Mode = "work-stealing"
	// ModeSingle is the baseline Relay replaced: one poller reads the
	// stream, claims each job, and hands it to a shared worker pool.
	ModeSingle Mode = "single-queue"
)

func (m Mode) Valid() bool { return m == ModeStealing || m == ModeSingle }

type Config struct {
	Workers  int
	Prefetch int
	Mode     Mode
}

type ModeChange struct {
	At   time.Time `json:"at"`
	Mode Mode      `json:"mode"`
}

type Runtime struct {
	cfg      Config
	rdb      *redis.Client
	store    Store
	handlers map[string]Handler
	log      *slog.Logger
	Metrics  *Metrics

	workers  []*Worker
	outcomes chan Outcome
	root     context.Context

	mu      sync.Mutex
	mode    Mode
	changes []ModeChange
	cancel  context.CancelFunc
	wg      sync.WaitGroup

	statMu  sync.Mutex
	wstats  []WorkerStats
	lastBusy []int64
	lastAt  time.Time
}

func New(rdb *redis.Client, store Store, handlers map[string]Handler, cfg Config, log *slog.Logger) *Runtime {
	if cfg.Workers <= 0 {
		cfg.Workers = 8
	}
	if cfg.Prefetch <= 0 {
		cfg.Prefetch = 32
	}
	if !cfg.Mode.Valid() {
		cfg.Mode = ModeStealing
	}
	rt := &Runtime{
		cfg: cfg, rdb: rdb, store: store, handlers: handlers, log: log,
		Metrics:  NewMetrics(),
		outcomes: make(chan Outcome, 8192),
		lastBusy: make([]int64, cfg.Workers),
	}
	for i := range cfg.Workers {
		rt.workers = append(rt.workers, &Worker{
			id:    fmt.Sprintf("w%d", i+1),
			rdb:   rdb,
			rt:    rt,
			local: newDeque(cfg.Prefetch / 4),
			wake:  make(chan struct{}, 1),
		})
	}
	return rt
}

// Start creates the consumer group if needed and launches the workers.
// The runtime stops when ctx is cancelled.
func (rt *Runtime) Start(ctx context.Context) error {
	err := rt.rdb.XGroupCreateMkStream(ctx, StreamKey, GroupName, "0").Err()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		return fmt.Errorf("create consumer group: %w", err)
	}
	rt.root = ctx
	rt.lastAt = time.Now()
	go rt.flush(ctx)
	go rt.sample(ctx)
	rt.mu.Lock()
	rt.mode = rt.cfg.Mode
	rt.changes = append(rt.changes, ModeChange{At: time.Now(), Mode: rt.mode})
	rt.launch(rt.mode)
	rt.mu.Unlock()
	return nil
}

// Wait blocks until every worker goroutine has exited.
func (rt *Runtime) Wait() { rt.wg.Wait() }

func (rt *Runtime) Mode() Mode {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return rt.mode
}

func (rt *Runtime) ModeChanges() []ModeChange {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return append([]ModeChange(nil), rt.changes...)
}

func (rt *Runtime) Config() Config { return rt.cfg }

// SetMode drains the running workers and restarts them in the new mode.
// Jobs left in local deques stay pending in the stream and are reclaimed
// once idle.
func (rt *Runtime) SetMode(mode Mode) error {
	if !mode.Valid() {
		return fmt.Errorf("unknown mode %q", mode)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if mode == rt.mode {
		return nil
	}
	rt.cancel()
	rt.wg.Wait()
	for _, w := range rt.workers {
		w.local.Drop()
	}
	rt.mode = mode
	rt.changes = append(rt.changes, ModeChange{At: time.Now(), Mode: mode})
	if len(rt.changes) > 20 {
		rt.changes = rt.changes[len(rt.changes)-20:]
	}
	rt.launch(mode)
	rt.log.Info("runtime mode changed", "mode", mode)
	return nil
}

func (rt *Runtime) launch(mode Mode) {
	ctx, cancel := context.WithCancel(rt.root)
	rt.cancel = cancel
	if mode == ModeStealing {
		for _, w := range rt.workers {
			rt.wg.Add(2)
			go func() { defer rt.wg.Done(); w.fill(ctx) }()
			go func() { defer rt.wg.Done(); w.Run(ctx) }()
		}
		return
	}
	pool := make(chan Job)
	rt.wg.Add(1)
	go func() {
		defer rt.wg.Done()
		defer close(pool)
		rt.dispatch(ctx, pool)
	}()
	for _, w := range rt.workers {
		rt.wg.Add(1)
		go func() {
			defer rt.wg.Done()
			for job := range pool {
				w.process(ctx, job, time.Now())
			}
		}()
	}
}

// dispatch is the single-queue baseline: every job passes through one
// goroutine that reads and claims it before any worker can start.
func (rt *Runtime) dispatch(ctx context.Context, pool chan<- Job) {
	const consumer = "dispatcher"
	for n := 1; ctx.Err() == nil; n++ {
		var msgs []redis.XMessage
		if n%64 == 0 {
			msgs = rt.reclaim(ctx, consumer)
		}
		if len(msgs) == 0 {
			streams, err := rt.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
				Group: GroupName, Consumer: consumer,
				Streams: []string{StreamKey, ">"},
				Count:   1, Block: 250 * time.Millisecond,
			}).Result()
			switch {
			case errors.Is(err, redis.Nil):
				msgs = rt.reclaim(ctx, consumer)
			case err != nil:
				if ctx.Err() == nil {
					rt.log.Warn("dispatch read failed", "err", err)
					time.Sleep(500 * time.Millisecond)
				}
				continue
			default:
				msgs = streams[0].Messages
			}
		}
		for _, msg := range msgs {
			job, err := decode(msg)
			if err != nil {
				rt.ack(ctx, msg.ID)
				continue
			}
			attempt, won, err := rt.store.Claim(ctx, job.ID, consumer, false, time.Now())
			if err != nil {
				continue
			}
			if !won {
				rt.ack(ctx, msg.ID)
				continue
			}
			job.Attempt = attempt
			select {
			case pool <- job:
			case <-ctx.Done():
				// Claimed but never handed off: put it back for whoever runs next.
				_ = rt.store.Requeue(context.WithoutCancel(ctx), job.ID, "")
				return
			}
		}
	}
}

func (rt *Runtime) reclaim(ctx context.Context, consumer string) []redis.XMessage {
	res, _, err := rt.rdb.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream: StreamKey, Group: GroupName, Consumer: consumer,
		MinIdle: 2 * time.Second, Start: "0-0", Count: 1,
	}).Result()
	if err != nil {
		return nil
	}
	return res
}

func (rt *Runtime) handle(ctx context.Context, job Job) (result any, err error) {
	h, ok := rt.handlers[job.Type]
	if !ok {
		return nil, fmt.Errorf("no handler registered for %q", job.Type)
	}
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("handler panicked: %v", r)
		}
	}()
	rt.Metrics.Started(job.Company)
	return h(ctx, job)
}

func (rt *Runtime) finish(job Job, worker string, start, end time.Time, result any, herr error) {
	if herr != nil && job.Attempt < MaxAttempts {
		rt.retry(job, herr)
		return
	}
	o := Outcome{
		ID: job.ID, MsgID: job.MsgID, Worker: worker, Stolen: job.Stolen,
		StartedAt: start, FinishedAt: end, Status: "succeeded",
	}
	if herr != nil {
		o.Status, o.Error = "failed", herr.Error()
	} else if result != nil {
		o.Result, _ = json.Marshal(result)
	}
	rt.Metrics.Record(job.Company, job.Run, start.Sub(job.EnqueuedAt), end)
	rt.outcomes <- o
}

// retry puts a failed attempt back on the stream after a short backoff.
func (rt *Runtime) retry(job Job, herr error) {
	ctx := context.WithoutCancel(rt.root)
	rt.ack(ctx, job.MsgID)
	if err := rt.store.Requeue(ctx, job.ID, herr.Error()); err != nil {
		rt.log.Error("requeue failed", "job", job.ID, "err", err)
		return
	}
	backoff := time.Duration(job.Attempt) * 400 * time.Millisecond
	time.AfterFunc(backoff, func() {
		job.EnqueuedAt, job.Stolen = time.Now(), false
		if err := rt.rdb.XAdd(ctx, xaddArgs(job)).Err(); err != nil {
			rt.log.Error("retry enqueue failed", "job", job.ID, "err", err)
			return
		}
		rt.Metrics.Enqueued(job.Company, 1)
	})
}

func (rt *Runtime) ack(ctx context.Context, ids ...string) {
	if err := rt.rdb.XAck(context.WithoutCancel(ctx), StreamKey, GroupName, ids...).Err(); err != nil {
		rt.log.Warn("ack failed", "err", err)
	}
}

// flush writes outcomes to Postgres in batches, then acks them.
func (rt *Runtime) flush(ctx context.Context) {
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	batch := make([]Outcome, 0, 512)
	send := func() {
		if len(batch) == 0 {
			return
		}
		fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		var err error
		for try := range 3 {
			if err = rt.store.Finish(fctx, batch); err == nil {
				break
			}
			time.Sleep(time.Duration(try+1) * 100 * time.Millisecond)
		}
		if err != nil {
			rt.log.Error("persisting outcomes failed", "count", len(batch), "err", err)
		} else {
			ids := make([]string, 0, len(batch))
			for _, o := range batch {
				if o.MsgID != "" {
					ids = append(ids, o.MsgID)
				}
			}
			rt.ack(fctx, ids...)
		}
		batch = batch[:0]
	}
	for {
		select {
		case o := <-rt.outcomes:
			batch = append(batch, o)
			if len(batch) >= 512 {
				send()
			}
		case <-tick.C:
			send()
		case <-ctx.Done():
			for {
				select {
				case o := <-rt.outcomes:
					batch = append(batch, o)
				default:
					send()
					return
				}
			}
		}
	}
}

// Enqueue persists jobs and appends them to the stream.
func (rt *Runtime) Enqueue(ctx context.Context, jobs []NewJob) ([]int64, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	at := time.Now()
	for i := range jobs {
		if len(jobs[i].Payload) == 0 {
			jobs[i].Payload = json.RawMessage("{}")
		}
	}
	ids, err := rt.store.InsertJobs(ctx, jobs, at)
	if err != nil {
		return nil, fmt.Errorf("insert jobs: %w", err)
	}
	counts := map[string]int64{}
	for start := 0; start < len(jobs); start += 2000 {
		pipe := rt.rdb.Pipeline()
		for i := start; i < min(start+2000, len(jobs)); i++ {
			nj := jobs[i]
			pipe.XAdd(ctx, xaddArgs(Job{
				ID: ids[i], Company: nj.Company, Type: nj.Type,
				Payload: nj.Payload, EnqueuedAt: at, Run: nj.Run,
			}))
			counts[nj.Company]++
		}
		if _, err := pipe.Exec(ctx); err != nil {
			return ids, fmt.Errorf("append to stream: %w", err)
		}
	}
	for company, n := range counts {
		rt.Metrics.Enqueued(company, n)
	}
	return ids, nil
}

// Requeue appends an already-persisted job to the stream again.
func (rt *Runtime) Requeue(ctx context.Context, j Job) error {
	if err := rt.rdb.XAdd(ctx, xaddArgs(j)).Err(); err != nil {
		return err
	}
	rt.Metrics.Enqueued(j.Company, 1)
	return nil
}

func xaddArgs(j Job) *redis.XAddArgs {
	return &redis.XAddArgs{Stream: StreamKey, MaxLen: 250_000, Approx: true, Values: j.values()}
}

// Workers returns the most recent per-worker sample.
func (rt *Runtime) Workers() []WorkerStats {
	rt.statMu.Lock()
	defer rt.statMu.Unlock()
	return append([]WorkerStats(nil), rt.wstats...)
}

func (rt *Runtime) sample(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			rt.sampleWorkers(now)
			rt.Metrics.Sample(now, rt.Mode())
		}
	}
}

func (rt *Runtime) sampleWorkers(now time.Time) {
	rt.statMu.Lock()
	defer rt.statMu.Unlock()
	elapsed := now.Sub(rt.lastAt).Nanoseconds()
	rt.lastAt = now
	stats := make([]WorkerStats, len(rt.workers))
	for i, w := range rt.workers {
		busy := w.busyTotal(now)
		util := 0.0
		if elapsed > 0 {
			util = float64(busy-rt.lastBusy[i]) / float64(elapsed)
		}
		rt.lastBusy[i] = busy
		stats[i] = WorkerStats{
			ID:          w.id,
			Utilization: max(0, min(1, util)),
			Processed:   w.processed.Load(),
			Steals:      w.steals.Load(),
			Local:       w.local.Len(),
			Busy:        w.runningSince.Load() != 0,
		}
	}
	rt.wstats = stats
}
