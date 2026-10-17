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

CREATE TABLE IF NOT EXISTS user_settings (
    user_id      bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    mode         text NOT NULL DEFAULT 'system' CHECK (mode IN ('system', 'light', 'dark')),
    scheme       text NOT NULL DEFAULT 'moss' CHECK (scheme IN ('moss', 'burgundy', 'navy', 'company', 'custom')),
    custom_color text NOT NULL DEFAULT '#6f8f5e',
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id            bigserial PRIMARY KEY,
    company_id    text NOT NULL REFERENCES companies (id),
    sku           text NOT NULL,
    name          text NOT NULL,
    category      text NOT NULL,
    location      text NOT NULL,
    unit          text NOT NULL,
    on_hand       int NOT NULL CHECK (on_hand >= 0),
    reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    reorder_point int NOT NULL,
    reorder_qty   int NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS shipments (
    id           bigserial PRIMARY KEY,
    company_id   text NOT NULL REFERENCES companies (id),
    reference    text NOT NULL,
    mode         text NOT NULL CHECK (mode IN ('sea', 'road', 'rail', 'air')),
    status       text NOT NULL DEFAULT 'booked'
                 CHECK (status IN ('booked', 'in_transit', 'delayed', 'delivered', 'cancelled')),
    customer     text NOT NULL,
    carrier      text NOT NULL,
    origin       text NOT NULL,
    destination  text NOT NULL,
    weight_kg    int NOT NULL,
    pieces       int NOT NULL,
    priority     text NOT NULL DEFAULT 'standard' CHECK (priority IN ('standard', 'express')),
    booked_at    timestamptz NOT NULL DEFAULT now(),
    departs_at   timestamptz NOT NULL,
    eta          timestamptz NOT NULL,
    -- Simulated actual arrival. It can be later than the promised eta.
    arrives_at   timestamptz NOT NULL,
    departed_at  timestamptz,
    delivered_at timestamptz,
    checkpoint   boolean NOT NULL DEFAULT false,
    item_id      bigint REFERENCES inventory_items (id) ON DELETE SET NULL,
    quantity     int,
    created_by   bigint REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE (company_id, reference)
);
CREATE INDEX IF NOT EXISTS shipments_list_idx ON shipments (company_id, id DESC);
CREATE INDEX IF NOT EXISTS shipments_status_idx ON shipments (company_id, status);
CREATE INDEX IF NOT EXISTS shipments_delivered_idx ON shipments (company_id, delivered_at) WHERE delivered_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS shipment_events (
    id          bigserial PRIMARY KEY,
    shipment_id bigint NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
    at          timestamptz NOT NULL,
    kind        text NOT NULL,
    location    text NOT NULL,
    note        text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shipment_events_idx ON shipment_events (shipment_id, at);

CREATE TABLE IF NOT EXISTS realm_progress (
    company_id text NOT NULL REFERENCES companies (id),
    mode       text NOT NULL,
    xp         int NOT NULL DEFAULT 0,
    level      int NOT NULL DEFAULT 1,
    PRIMARY KEY (company_id, mode)
);

CREATE TABLE IF NOT EXISTS milestones (
    company_id  text NOT NULL REFERENCES companies (id),
    key         text NOT NULL,
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, key)
);

CREATE TABLE IF NOT EXISTS notifications (
    id         bigserial PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text NOT NULL,
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    link       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
    id         bigserial PRIMARY KEY,
    company_id text NOT NULL REFERENCES companies (id),
    user_id    bigint REFERENCES users (id) ON DELETE SET NULL,
    action     text NOT NULL,
    target     text NOT NULL DEFAULT '',
    detail     text NOT NULL DEFAULT '',
    at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_company_idx ON audit_log (company_id, id DESC);

CREATE TABLE IF NOT EXISTS time_off_requests (
    id          bigserial PRIMARY KEY,
    company_id  text NOT NULL REFERENCES companies (id),
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('vacation', 'sick', 'personal')),
    starts_on   date NOT NULL,
    ends_on     date NOT NULL,
    reason      text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
    decided_by  bigint REFERENCES users (id) ON DELETE SET NULL,
    decided_at  timestamptz,
    note        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS time_off_company_idx ON time_off_requests (company_id, starts_on);
