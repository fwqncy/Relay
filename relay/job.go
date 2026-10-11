package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// StreamKey is the Redis stream every job is appended to.
	StreamKey = "relay:jobs"
	// GroupName is the consumer group shared by all workers.
	GroupName = "workers"
	// MaxAttempts bounds automatic retries for a failing job.
	MaxAttempts = 3
)

// Job is a unit of work as it travels through the stream.
type Job struct {
	ID         int64
	MsgID      string
	Company    string
	Type       string
	Payload    json.RawMessage
	EnqueuedAt time.Time
	Run        int64 // load run this job belongs to, 0 for regular traffic
	Stolen     bool
	Attempt    int
}

// NewJob is a job that has not been persisted yet.
type NewJob struct {
	Company     string
	Type        string
	Payload     json.RawMessage
	SubmittedBy *int64
	Run         int64
}

// Outcome is the final state of an attempt, flushed to Postgres in batches.
type Outcome struct {
	ID         int64
	MsgID      string
	Status     string // succeeded | failed
	Worker     string
	Stolen     bool
	StartedAt  time.Time
	FinishedAt time.Time
	Result     json.RawMessage
	Error      string
}

// Handler executes a single job type.
type Handler func(ctx context.Context, job Job) (any, error)

// Store is the persistence the runtime needs. Postgres is the source of
// truth for job state; the stream only carries delivery.
type Store interface {
	InsertJobs(ctx context.Context, jobs []NewJob, at time.Time) ([]int64, error)
	// Claim moves a job from queued to running. It reports false when
	// another worker already owns it, which happens after a steal.
	Claim(ctx context.Context, id int64, worker string, stolen bool, at time.Time) (attempt int, won bool, err error)
	Requeue(ctx context.Context, id int64, errMsg string) error
	Finish(ctx context.Context, outcomes []Outcome) error
}

func (j Job) values() map[string]any {
	return map[string]any{
		"id":          j.ID,
		"company":     j.Company,
		"type":        j.Type,
		"payload":     string(j.Payload),
		"enqueued_at": j.EnqueuedAt.UnixNano(),
		"run":         j.Run,
	}
}

func decode(msg redis.XMessage) (Job, error) {
	str := func(k string) string { s, _ := msg.Values[k].(string); return s }
	id, err := strconv.ParseInt(str("id"), 10, 64)
	if err != nil {
		return Job{}, fmt.Errorf("decode %s: bad id: %w", msg.ID, err)
	}
	at, err := strconv.ParseInt(str("enqueued_at"), 10, 64)
	if err != nil {
		return Job{}, fmt.Errorf("decode %s: bad enqueued_at: %w", msg.ID, err)
	}
	run, _ := strconv.ParseInt(str("run"), 10, 64)
	return Job{
		ID:         id,
		MsgID:      msg.ID,
		Company:    str("company"),
		Type:       str("type"),
		Payload:    json.RawMessage(str("payload")),
		EnqueuedAt: time.Unix(0, at),
		Run:        run,
	}, nil
}
