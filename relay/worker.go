// worker.go: steal from peers when idle
package relay

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Worker owns a local deque that it fills from the stream. When the deque
// runs dry it steals jobs that have sat idle in a peer's pending list.
type Worker struct {
	id    string
	rdb   *redis.Client
	rt    *Runtime
	local *deque
	wake  chan struct{}

	processed    atomic.Int64
	steals       atomic.Int64
	busyNanos    atomic.Int64
	runningSince atomic.Int64
}

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

func (w *Worker) steal(ctx context.Context) (Job, bool) {
	res, _, err := w.rdb.XAutoClaim(ctx,
		&redis.XAutoClaimArgs{
			Stream: "relay:jobs", Group: "workers",
			Consumer: w.id, MinIdle: 2 * time.Second,
			Start: "0-0", Count: 1,
		}).Result()
	if err != nil || len(res) == 0 {
		return Job{}, false
	}
	job, err := decode(res[0])
	if err != nil {
		w.rt.log.Warn("dropping undecodable message", "worker", w.id, "err", err)
		w.rt.ack(ctx, res[0].ID)
		return Job{}, false
	}
	job.Stolen = true
	w.steals.Add(1)
	return job, true
}

// park sleeps until the fill loop has new work, the timeout passes, or the
// runtime shuts down.
func (w *Worker) park(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-w.wake:
	case <-t.C:
	}
}

// exec claims the job in Postgres and runs it. Losing the claim means a
// peer stole the job while it waited in this worker's deque.
func (w *Worker) exec(ctx context.Context, job Job) {
	start := time.Now()
	attempt, won, err := w.rt.store.Claim(ctx, job.ID, w.id, job.Stolen, start)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			w.rt.log.Warn("claim failed", "worker", w.id, "job", job.ID, "err", err)
		}
		return // still pending in the stream, so a peer will reclaim it
	}
	if !won {
		w.rt.ack(ctx, job.MsgID)
		return
	}
	job.Attempt = attempt
	w.process(ctx, job, start)
}

// process runs a claimed job. A mode switch cancels ctx, but a job that
// has started is always allowed to finish.
func (w *Worker) process(ctx context.Context, job Job, start time.Time) {
	w.runningSince.Store(start.UnixNano())
	jctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	result, herr := w.rt.handle(jctx, job)
	cancel()
	end := time.Now()
	w.runningSince.Store(0)
	w.busyNanos.Add(int64(end.Sub(start)))
	w.processed.Add(1)
	w.rt.finish(job, w.id, start, end, result, herr)
}

// fill keeps the local deque topped up from the stream, reading only
// messages that no consumer has seen yet.
func (w *Worker) fill(ctx context.Context) {
	prefetch := w.rt.cfg.Prefetch
	for ctx.Err() == nil {
		if w.local.Len() > w.local.low {
			select {
			case <-ctx.Done():
				return
			case <-w.local.hungry:
			}
			continue
		}
		streams, err := w.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group: GroupName, Consumer: w.id,
			Streams: []string{StreamKey, ">"},
			Count:   int64(prefetch - w.local.Len()),
			Block:   250 * time.Millisecond,
		}).Result()
		if err != nil {
			if !errors.Is(err, redis.Nil) && ctx.Err() == nil {
				w.rt.log.Warn("fill failed", "worker", w.id, "err", err)
				w.park(ctx, 500*time.Millisecond)
			}
			continue
		}
		for _, s := range streams {
			for _, msg := range s.Messages {
				job, err := decode(msg)
				if err != nil {
					w.rt.ack(ctx, msg.ID)
					continue
				}
				w.local.Push(job)
			}
		}
		select {
		case w.wake <- struct{}{}:
		default:
		}
	}
}

// WorkerStats is a point-in-time view of one worker.
type WorkerStats struct {
	ID          string  `json:"id"`
	Utilization float64 `json:"utilization"`
	Processed   int64   `json:"processed"`
	Steals      int64   `json:"steals"`
	Local       int     `json:"local"`
	Busy        bool    `json:"busy"`
}

func (w *Worker) busyTotal(now time.Time) int64 {
	total := w.busyNanos.Load()
	if since := w.runningSince.Load(); since != 0 {
		total += now.UnixNano() - since
	}
	return total
}
