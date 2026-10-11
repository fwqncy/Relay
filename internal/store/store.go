// Package store is Relay's Postgres layer: job state, accounts and the
// logistics data (docks, appointments, shifts) that jobs act on.
package store

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"relay/relay"
)

//go:embed schema.sql
var schema string

var ErrNotFound = errors.New("not found")

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 32
	// Job state is re-derivable from the stream, so trading durability of
	// the last few milliseconds of commits for throughput is acceptable.
	cfg.ConnConfig.RuntimeParams["synchronous_commit"] = "off"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, schema)
	return err
}

// ---- accounts ----

type Company struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Initials    string `json:"initials"`
	Hub         string `json:"hub"`
	AccentLight string `json:"accentLight"`
	AccentDark  string `json:"accentDark"`
}

type User struct {
	ID           int64  `json:"id"`
	CompanyID    string `json:"companyId"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	Title        string `json:"title"`
	Role         string `json:"role"`
	PasswordHash string `json:"-"`
}

func (u User) IsManager() bool { return u.Role == "manager" }

const userCols = `id, company_id, email, name, title, role, password_hash`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.CompanyID, &u.Email, &u.Name, &u.Title, &u.Role, &u.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE lower(email) = lower($1)`, email))
}

func (s *Store) Company(ctx context.Context, id string) (Company, error) {
	var c Company
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, initials, hub, accent_light, accent_dark FROM companies WHERE id = $1`, id,
	).Scan(&c.ID, &c.Name, &c.Initials, &c.Hub, &c.AccentLight, &c.AccentDark)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (s *Store) CompanyIDs(ctx context.Context) ([]string, error) {
	rows, _ := s.pool.Query(ctx, `SELECT id FROM companies ORDER BY id`)
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type DemoAccount struct {
	Company Company `json:"company"`
	Name    string  `json:"name"`
	Title   string  `json:"title"`
	Email   string  `json:"email"`
	Role    string  `json:"role"`
}

func (s *Store) DemoAccounts(ctx context.Context) ([]DemoAccount, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, c.initials, c.hub, c.accent_light, c.accent_dark, u.name, u.title, u.email, u.role
		FROM users u JOIN companies c ON c.id = u.company_id
		WHERE u.demo ORDER BY c.name, u.role DESC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DemoAccount, error) {
		var a DemoAccount
		c := &a.Company
		err := r.Scan(&c.ID, &c.Name, &c.Initials, &c.Hub, &c.AccentLight, &c.AccentDark, &a.Name, &a.Title, &a.Email, &a.Role)
		return a, err
	})
}

func (s *Store) CreateSession(ctx context.Context, userID int64, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
		token, userID, time.Now().Add(ttl))
	return token, err
}

func (s *Store) SessionUser(ctx context.Context, token string) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `
		SELECT u.id, u.company_id, u.email, u.name, u.title, u.role, u.password_hash
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token = $1 AND s.expires_at > now()`, token))
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
	return err
}

type Staff struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Title string `json:"title"`
	Role  string `json:"role"`
}

func (s *Store) Staff(ctx context.Context, company string) ([]Staff, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, title, role FROM users WHERE company_id = $1 ORDER BY role DESC, name`, company)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Staff])
}

// ---- jobs (implements relay.Store) ----

func (s *Store) InsertJobs(ctx context.Context, jobs []relay.NewJob, at time.Time) ([]int64, error) {
	rows, _ := s.pool.Query(ctx, `SELECT nextval('jobs_id_seq') FROM generate_series(1, $1)`, len(jobs))
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	_, err = s.pool.CopyFrom(ctx, pgx.Identifier{"jobs"},
		[]string{"id", "company_id", "type", "payload", "submitted_by", "run_id", "enqueued_at"},
		pgx.CopyFromSlice(len(jobs), func(i int) ([]any, error) {
			j := jobs[i]
			var run *int64
			if j.Run != 0 {
				run = &j.Run
			}
			return []any{ids[i], j.Company, j.Type, string(j.Payload), j.SubmittedBy, run, at}, nil
		}))
	return ids, err
}

func (s *Store) Claim(ctx context.Context, id int64, worker string, stolen bool, at time.Time) (int, bool, error) {
	var attempts int
	err := s.pool.QueryRow(ctx, `
		UPDATE jobs SET status = 'running', worker = $2, stolen = $3, started_at = $4, attempts = attempts + 1
		WHERE id = $1 AND status = 'queued' RETURNING attempts`, id, worker, stolen, at).Scan(&attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return attempts, err == nil, err
}

// Requeue returns a running job to the queue. An empty errMsg means the
// attempt never ran, so it is not counted.
func (s *Store) Requeue(ctx context.Context, id int64, errMsg string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE jobs SET status = 'queued', worker = NULL,
		       attempts = CASE WHEN $2 = '' THEN greatest(attempts - 1, 0) ELSE attempts END,
		       error = coalesce(nullif($2, ''), error)
		WHERE id = $1`, id, errMsg)
	return err
}

func (s *Store) Finish(ctx context.Context, outcomes []relay.Outcome) error {
	n := len(outcomes)
	ids, statuses, workers := make([]int64, n), make([]string, n), make([]string, n)
	stolen := make([]bool, n)
	started, finished := make([]time.Time, n), make([]time.Time, n)
	results, errs := make([]*string, n), make([]*string, n)
	for i, o := range outcomes {
		ids[i], statuses[i], workers[i], stolen[i] = o.ID, o.Status, o.Worker, o.Stolen
		started[i], finished[i] = o.StartedAt, o.FinishedAt
		if len(o.Result) > 0 {
			r := string(o.Result)
			results[i] = &r
		}
		if o.Error != "" {
			e := o.Error
			errs[i] = &e
		}
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE jobs j SET status = u.status, worker = u.worker, stolen = u.stolen,
		       started_at = u.started, finished_at = u.finished, result = u.result::jsonb,
		       error = coalesce(u.error, CASE WHEN u.status = 'succeeded' THEN NULL ELSE j.error END)
		FROM unnest($1::bigint[], $2::text[], $3::text[], $4::bool[], $5::timestamptz[], $6::timestamptz[], $7::text[], $8::text[])
		     AS u(id, status, worker, stolen, started, finished, result, error)
		WHERE j.id = u.id`,
		ids, statuses, workers, stolen, started, finished, results, errs)
	return err
}

type JobRow struct {
	ID          int64           `json:"id"`
	Type        string          `json:"type"`
	Status      string          `json:"status"`
	Attempts    int             `json:"attempts"`
	Payload     json.RawMessage `json:"payload"`
	SubmittedBy *string         `json:"submittedBy"`
	RunID       *int64          `json:"runId"`
	EnqueuedAt  time.Time       `json:"enqueuedAt"`
	StartedAt   *time.Time      `json:"startedAt"`
	FinishedAt  *time.Time      `json:"finishedAt"`
	Worker      *string         `json:"worker"`
	Stolen      bool            `json:"stolen"`
	Result      json.RawMessage `json:"result"`
	Error       *string         `json:"error"`
	QueueMs     *float64        `json:"queueMs"`
	DurationMs  *float64        `json:"durationMs"`
}

type JobFilter struct {
	Company     string
	Status      string
	Type        string
	Query       string
	SubmittedBy int64
	IncludeLoad bool
	Before      int64
	Limit       int
}

const jobCols = `j.id, j.type, j.status, j.attempts, j.payload, u.name, j.run_id, j.enqueued_at,
	j.started_at, j.finished_at, j.worker, j.stolen, j.result, j.error,
	extract(epoch FROM j.started_at - j.enqueued_at) * 1000,
	extract(epoch FROM j.finished_at - j.started_at) * 1000`

func scanJob(r pgx.CollectableRow) (JobRow, error) {
	var j JobRow
	err := r.Scan(&j.ID, &j.Type, &j.Status, &j.Attempts, &j.Payload, &j.SubmittedBy, &j.RunID,
		&j.EnqueuedAt, &j.StartedAt, &j.FinishedAt, &j.Worker, &j.Stolen, &j.Result, &j.Error,
		&j.QueueMs, &j.DurationMs)
	return j, err
}

func (f JobFilter) where(args *[]any) string {
	add := func(v any) string { *args = append(*args, v); return "$" + strconv.Itoa(len(*args)) }
	w := "j.company_id = " + add(f.Company)
	if f.Type != "" {
		w += " AND j.type = " + add(f.Type)
	}
	if f.SubmittedBy != 0 {
		w += " AND j.submitted_by = " + add(f.SubmittedBy)
	}
	if !f.IncludeLoad {
		w += " AND j.run_id IS NULL"
	}
	if f.Query != "" {
		if id, err := strconv.ParseInt(f.Query, 10, 64); err == nil {
			w += " AND j.id = " + add(id)
		} else {
			p := add("%" + f.Query + "%")
			w += " AND (j.type ILIKE " + p + " OR j.payload::text ILIKE " + p + " OR j.error ILIKE " + p + ")"
		}
	}
	return w
}

func (s *Store) ListJobs(ctx context.Context, f JobFilter) ([]JobRow, error) {
	var args []any
	w := f.where(&args)
	if f.Status != "" {
		args = append(args, f.Status)
		w += " AND j.status = $" + strconv.Itoa(len(args))
	}
	if f.Before > 0 {
		args = append(args, f.Before)
		w += " AND j.id < $" + strconv.Itoa(len(args))
	}
	args = append(args, max(1, min(f.Limit, 200)))
	rows, err := s.pool.Query(ctx, `SELECT `+jobCols+` FROM jobs j LEFT JOIN users u ON u.id = j.submitted_by
		WHERE `+w+` ORDER BY j.id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanJob)
}

// JobCounts counts jobs per status for the same filter, ignoring status.
func (s *Store) JobCounts(ctx context.Context, f JobFilter) (map[string]int64, error) {
	var args []any
	w := f.where(&args)
	rows, err := s.pool.Query(ctx, `SELECT j.status, count(*) FROM jobs j WHERE `+w+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	counts := map[string]int64{"queued": 0, "running": 0, "succeeded": 0, "failed": 0}
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		counts[st] = n
	}
	return counts, rows.Err()
}

func (s *Store) Job(ctx context.Context, company string, id int64) (JobRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+jobCols+` FROM jobs j LEFT JOIN users u ON u.id = j.submitted_by
		WHERE j.company_id = $1 AND j.id = $2`, company, id)
	if err != nil {
		return JobRow{}, err
	}
	j, err := pgx.CollectExactlyOneRow(rows, scanJob)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	return j, err
}

// ResetFailed marks a failed job queued again with a fresh attempt budget.
func (s *Store) ResetFailed(ctx context.Context, company string, id int64) (relay.Job, error) {
	var j relay.Job
	var payload string
	var run *int64
	err := s.pool.QueryRow(ctx, `
		UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, worker = NULL,
		       started_at = NULL, finished_at = NULL, enqueued_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'failed'
		RETURNING id, company_id, type, payload::text, run_id, enqueued_at`, company, id,
	).Scan(&j.ID, &j.Company, &j.Type, &payload, &run, &j.EnqueuedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	j.Payload = json.RawMessage(payload)
	if run != nil {
		j.Run = *run
	}
	return j, err
}

// JobTypeStats summarises the last 15 minutes of operational traffic.
type JobTypeStats struct {
	Type       string   `json:"type"`
	Total      int64    `json:"total"`
	Failed     int64    `json:"failed"`
	AvgMs      *float64 `json:"avgMs"`
	StolenJobs int64    `json:"stolen"`
}

func (s *Store) JobTypeStats(ctx context.Context, company string) ([]JobTypeStats, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT type, count(*), count(*) FILTER (WHERE status = 'failed'),
		       avg(extract(epoch FROM finished_at - started_at) * 1000) FILTER (WHERE status = 'succeeded'),
		       count(*) FILTER (WHERE stolen)
		FROM jobs WHERE company_id = $1 AND run_id IS NULL AND enqueued_at > now() - interval '15 minutes'
		GROUP BY type ORDER BY count(*) DESC`, company)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[JobTypeStats])
}

func (s *Store) QueuedCounts(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT company_id, count(*) FROM jobs WHERE status = 'queued' GROUP BY 1`)
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	for rows.Next() {
		var c string
		var n int64
		if err := rows.Scan(&c, &n); err != nil {
			return nil, err
		}
		out[c] = n
	}
	return out, rows.Err()
}

// Prune deletes old finished jobs and expired sessions.
func (s *Store) Prune(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM jobs WHERE finished_at < now() - interval '2 hours'
		   OR (run_id IS NOT NULL AND finished_at < now() - interval '20 minutes')`)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`)
	return err
}

// ---- load runs ----

func (s *Store) SaveRun(ctx context.Context, r relay.RunResult) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO load_runs (id, company_id, mode, jobs, p50_ms, p95_ms, p99_ms, throughput, started_at, finished_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
		r.ID, r.Company, string(r.Mode), r.Jobs, r.P50, r.P95, r.P99, r.Throughput, r.StartedAt, r.FinishedAt)
	return err
}

func (s *Store) Runs(ctx context.Context, company string, limit int) ([]relay.RunResult, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, company_id, mode, jobs, p50_ms, p95_ms, p99_ms, throughput, started_at, finished_at
		FROM load_runs WHERE company_id = $1 ORDER BY id DESC LIMIT $2`, company, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (relay.RunResult, error) {
		var x relay.RunResult
		var mode string
		err := r.Scan(&x.ID, &x.Company, &mode, &x.Jobs, &x.P50, &x.P95, &x.P99, &x.Throughput, &x.StartedAt, &x.FinishedAt)
		x.Mode = relay.Mode(mode)
		return x, err
	})
}

// ---- docks & appointments ----

type Dock struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func (s *Store) Docks(ctx context.Context, company string) ([]Dock, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, kind FROM docks WHERE company_id = $1 ORDER BY position`, company)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Dock])
}

type Appointment struct {
	ID          int64      `json:"id"`
	DockID      int64      `json:"dockId"`
	Carrier     string     `json:"carrier"`
	Reference   string     `json:"reference"`
	Direction   string     `json:"direction"`
	Pallets     int        `json:"pallets"`
	StartsAt    time.Time  `json:"startsAt"`
	EndsAt      time.Time  `json:"endsAt"`
	Status      string     `json:"status"`
	AssignedTo  *int64     `json:"assignedTo"`
	Assignee    *string    `json:"assignee"`
	CheckedInAt *time.Time `json:"checkedInAt"`
}

const apptCols = `a.id, a.dock_id, a.carrier, a.reference, a.direction, a.pallets, a.starts_at, a.ends_at,
	a.status, a.assigned_to, u.name, a.checked_in_at`

func (s *Store) Appointments(ctx context.Context, company string, from, to time.Time) ([]Appointment, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+apptCols+` FROM appointments a LEFT JOIN users u ON u.id = a.assigned_to
		WHERE a.company_id = $1 AND a.starts_at < $3 AND a.ends_at > $2 ORDER BY a.starts_at`, company, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Appointment])
}

func (s *Store) Appointment(ctx context.Context, company string, id int64) (Appointment, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+apptCols+` FROM appointments a LEFT JOIN users u ON u.id = a.assigned_to
		WHERE a.company_id = $1 AND a.id = $2`, company, id)
	if err != nil {
		return Appointment{}, err
	}
	a, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Appointment])
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	return a, err
}

type NewAppointment struct {
	DockID     int64     `json:"dockId"`
	Carrier    string    `json:"carrier"`
	Reference  string    `json:"reference"`
	Direction  string    `json:"direction"`
	Pallets    int       `json:"pallets"`
	StartsAt   time.Time `json:"startsAt"`
	EndsAt     time.Time `json:"endsAt"`
	AssignedTo *int64    `json:"assignedTo"`
}

var ErrConflict = errors.New("conflict")

func (s *Store) CreateAppointment(ctx context.Context, company string, a NewAppointment) (int64, error) {
	var id int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var busy bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM appointments WHERE dock_id = $1 AND starts_at < $3 AND ends_at > $2)`,
			a.DockID, a.StartsAt, a.EndsAt).Scan(&busy); err != nil {
			return err
		}
		if busy {
			return ErrConflict
		}
		return tx.QueryRow(ctx, `
			INSERT INTO appointments (company_id, dock_id, carrier, reference, direction, pallets, starts_at, ends_at, assigned_to)
			SELECT $1, d.id, $3, $4, $5, $6, $7, $8, $9 FROM docks d WHERE d.id = $2 AND d.company_id = $1
			RETURNING id`, company, a.DockID, a.Carrier, a.Reference, a.Direction, a.Pallets, a.StartsAt, a.EndsAt, a.AssignedTo,
		).Scan(&id)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

// AdvanceAppointment moves an appointment from one status to the next and
// reports false if it was not in the expected state.
func (s *Store) AdvanceAppointment(ctx context.Context, company string, id int64, from, to string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE appointments SET status = $4,
		       checked_in_at = CASE WHEN $4 = 'checked_in' THEN now() ELSE checked_in_at END
		WHERE company_id = $1 AND id = $2 AND status = $3`, company, id, from, to)
	return tag.RowsAffected() == 1, err
}

// ---- shifts ----

type Shift struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	StartsAt  time.Time `json:"startsAt"`
	EndsAt    time.Time `json:"endsAt"`
	Position  string    `json:"position"`
	Location  string    `json:"location"`
	Published bool      `json:"published"`
}

func (s *Store) Shifts(ctx context.Context, company string, from, to time.Time) ([]Shift, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, user_id, starts_at, ends_at, position, location, published
		FROM shifts WHERE company_id = $1 AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at`, company, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Shift])
}

func (s *Store) CreateShift(ctx context.Context, company string, sh Shift) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO shifts (company_id, user_id, starts_at, ends_at, position, location)
		SELECT $1, u.id, $3, $4, $5, $6 FROM users u WHERE u.id = $2 AND u.company_id = $1
		RETURNING id`, company, sh.UserID, sh.StartsAt, sh.EndsAt, sh.Position, sh.Location).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

func (s *Store) DeleteShift(ctx context.Context, company string, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM shifts WHERE company_id = $1 AND id = $2`, company, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DraftShifts lists unpublished shift IDs in a range.
func (s *Store) DraftShifts(ctx context.Context, company string, from, to time.Time) ([]int64, error) {
	rows, _ := s.pool.Query(ctx, `SELECT id FROM shifts
		WHERE company_id = $1 AND NOT published AND starts_at >= $2 AND starts_at < $3`, company, from, to)
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

// PublishShift marks a shift published and returns who works it.
func (s *Store) PublishShift(ctx context.Context, company string, id int64) (string, bool, error) {
	var name string
	err := s.pool.QueryRow(ctx, `
		UPDATE shifts s SET published = true FROM users u
		WHERE s.company_id = $1 AND s.id = $2 AND u.id = s.user_id AND NOT s.published
		RETURNING u.name`, company, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return name, err == nil, err
}
