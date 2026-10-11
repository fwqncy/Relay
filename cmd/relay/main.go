// Command relay runs the job runtime and serves the web app.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"

	"relay/internal/jobs"
	"relay/internal/server"
	"relay/internal/store"
	"relay/relay"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return fallback
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(log); err != nil {
		log.Error("relay stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := env("DATABASE_URL", "postgres://localhost:5432/relay?sslmode=disable")
	st, err := openStore(ctx, dbURL, log)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := st.Seed(ctx, time.Now()); err != nil {
		return fmt.Errorf("seed: %w", err)
	}

	opts, err := redis.ParseURL(env("REDIS_URL", "redis://localhost:6379/0"))
	if err != nil {
		return fmt.Errorf("parse REDIS_URL: %w", err)
	}
	opts.PoolSize = 64
	rdb := redis.NewClient(opts)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("connect to redis at %s: %w", opts.Addr, err)
	}

	rt := relay.New(rdb, st, jobs.Handlers(st), relay.Config{
		Workers:  envInt("RELAY_WORKERS", 8),
		Prefetch: envInt("RELAY_PREFETCH", 32),
		Mode:     relay.Mode(env("RELAY_MODE", string(relay.ModeStealing))),
	}, log)
	companies, err := st.CompanyIDs(ctx)
	if err != nil {
		return err
	}
	rt.Metrics.Track(companies...)
	if queued, err := st.QueuedCounts(ctx); err == nil {
		rt.Metrics.SetQueued(queued)
	}
	rt.Metrics.OnRunDone = func(res relay.RunResult) {
		log.Info("load run finished", "company", res.Company, "mode", res.Mode, "jobs", res.Jobs,
			"p95_ms", fmt.Sprintf("%.0f", res.P95), "jobs_per_sec", fmt.Sprintf("%.0f", res.Throughput))
		if err := st.SaveRun(context.Background(), res); err != nil {
			log.Error("save load run", "err", err)
		}
	}
	if err := rt.Start(ctx); err != nil {
		return err
	}

	if env("RELAY_AMBIENT", "on") != "off" {
		go ambient(ctx, rt, companies, log)
	}
	go housekeeping(ctx, st, log)

	addr := env("RELAY_ADDR", "localhost:8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           server.New(st, rt, log),
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("relay is running", "url", "http://"+addr, "workers", rt.Config().Workers, "mode", rt.Mode())

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	rt.Wait()
	return nil
}

// openStore connects to Postgres, creating the database on first run.
func openStore(ctx context.Context, url string, log *slog.Logger) (*store.Store, error) {
	st, err := store.Open(ctx, url)
	var pgErr *pgconn.PgError
	if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "3D000" {
		return st, err
	}
	cfg, perr := pgx.ParseConfig(url)
	if perr != nil {
		return nil, perr
	}
	name := cfg.Database
	cfg.Database = "postgres"
	conn, cerr := pgx.ConnectConfig(ctx, cfg)
	if cerr != nil {
		return nil, fmt.Errorf("database %q is missing and could not be created: %w", name, cerr)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		return nil, fmt.Errorf("create database %q: %w", name, err)
	}
	log.Info("created database", "name", name)
	return store.Open(ctx, url)
}

// ambient keeps a trickle of everyday jobs flowing so dashboards are live.
func ambient(ctx context.Context, rt *relay.Runtime, companies []string, log *slog.Logger) {
	r := rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 1))
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			var batch []relay.NewJob
			for _, c := range companies {
				batch = append(batch, jobs.Ambient(c, r)...)
			}
			if _, err := rt.Enqueue(ctx, batch); err != nil && ctx.Err() == nil {
				log.Warn("ambient enqueue failed", "err", err)
			}
		}
	}
}

// housekeeping prunes old jobs and keeps the seeded schedule current.
func housekeeping(ctx context.Context, st *store.Store, log *slog.Logger) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			if err := st.Prune(ctx); err != nil && ctx.Err() == nil {
				log.Warn("prune failed", "err", err)
			}
			if now.Minute()%10 == 0 {
				if err := st.Seed(ctx, now); err != nil && ctx.Err() == nil {
					log.Warn("schedule refresh failed", "err", err)
				}
			}
		}
	}
}
