CREATE TABLE IF NOT EXISTS companies (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    initials     text NOT NULL,
    hub          text NOT NULL,
    accent_light text NOT NULL,
    accent_dark  text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            bigserial PRIMARY KEY,
    company_id    text NOT NULL REFERENCES companies (id),
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    title         text NOT NULL,
    role          text NOT NULL CHECK (role IN ('manager', 'employee')),
    password_hash text NOT NULL,
    demo          boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
    token      text PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id           bigserial PRIMARY KEY,
    company_id   text NOT NULL,
    type         text NOT NULL,
    payload      jsonb NOT NULL DEFAULT '{}',
    status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempts     int NOT NULL DEFAULT 0,
    submitted_by bigint,
    run_id       bigint,
    enqueued_at  timestamptz NOT NULL,
    started_at   timestamptz,
    finished_at  timestamptz,
    worker       text,
    stolen       boolean NOT NULL DEFAULT false,
    result       jsonb,
    error        text
);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company_id, id DESC);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (company_id, status, id DESC);
CREATE INDEX IF NOT EXISTS jobs_submitter_idx ON jobs (submitted_by, id DESC) WHERE submitted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_finished_idx ON jobs (finished_at) WHERE finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS load_runs (
    id          bigint PRIMARY KEY,
    company_id  text NOT NULL,
    mode        text NOT NULL,
    jobs        int NOT NULL,
    p50_ms      double precision NOT NULL,
    p95_ms      double precision NOT NULL,
    p99_ms      double precision NOT NULL,
    throughput  double precision NOT NULL,
    started_at  timestamptz NOT NULL,
    finished_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS docks (
    id         bigserial PRIMARY KEY,
    company_id text NOT NULL REFERENCES companies (id),
    name       text NOT NULL,
    kind       text NOT NULL,
    position   int NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
    id            bigserial PRIMARY KEY,
    company_id    text NOT NULL REFERENCES companies (id),
    dock_id       bigint NOT NULL REFERENCES docks (id) ON DELETE CASCADE,
    carrier       text NOT NULL,
    reference     text NOT NULL,
    direction     text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    pallets       int NOT NULL,
    starts_at     timestamptz NOT NULL,
    ends_at       timestamptz NOT NULL,
    status        text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'confirmed', 'checked_in', 'completed')),
    assigned_to   bigint REFERENCES users (id) ON DELETE SET NULL,
    checked_in_at timestamptz
);
CREATE INDEX IF NOT EXISTS appointments_day_idx ON appointments (company_id, starts_at);

CREATE TABLE IF NOT EXISTS shifts (
    id         bigserial PRIMARY KEY,
    company_id text NOT NULL REFERENCES companies (id),
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL,
    position   text NOT NULL,
    location   text NOT NULL,
    published  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS shifts_week_idx ON shifts (company_id, starts_at);
