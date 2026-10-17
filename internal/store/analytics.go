package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type DayVolume struct {
	Day  time.Time `json:"day"`
	Sea  int       `json:"sea"`
	Road int       `json:"road"`
	Rail int       `json:"rail"`
	Air  int       `json:"air"`
}

type ModeStats struct {
	Mode         string   `json:"mode"`
	Delivered    int      `json:"delivered"`
	OnTimePct    *float64 `json:"onTimePct"`
	AvgTransitHr *float64 `json:"avgTransitHours"`
	Active       int      `json:"active"`
}

type CarrierStats struct {
	Carrier      string   `json:"carrier"`
	Mode         string   `json:"mode"`
	Delivered    int      `json:"delivered"`
	OnTimePct    *float64 `json:"onTimePct"`
	AvgTransitHr *float64 `json:"avgTransitHours"`
	Delayed      int      `json:"delayed"`
}

type Analytics struct {
	Days       int            `json:"days"`
	Delivered  int            `json:"delivered"`
	OnTimePct  *float64       `json:"onTimePct"`
	PrevOnTime *float64       `json:"prevOnTimePct"`
	Delayed    int            `json:"delayed"`
	Active     int            `json:"active"`
	WeightKg   int64          `json:"weightKg"`
	Volume     []DayVolume    `json:"volume"`
	Modes      []ModeStats    `json:"modes"`
	Carriers   []CarrierStats `json:"carriers"`
	LowStock   int            `json:"lowStock"`
	PendingPTO int            `json:"pendingTimeOff"`
}

func (s *Store) Analytics(ctx context.Context, company string, days int, tz string) (Analytics, error) {
	a := Analytics{Days: days}
	since := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	prevSince := since.Add(-time.Duration(days) * 24 * time.Hour)
	err := s.pool.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE delivered_at >= $2),
		(100.0 * count(*) FILTER (WHERE delivered_at >= $2 AND delivered_at <= eta) / nullif(count(*) FILTER (WHERE delivered_at >= $2), 0))::float8,
		(100.0 * count(*) FILTER (WHERE delivered_at >= $3 AND delivered_at < $2 AND delivered_at <= eta) /
		    nullif(count(*) FILTER (WHERE delivered_at >= $3 AND delivered_at < $2), 0))::float8,
		count(*) FILTER (WHERE status = 'delayed'),
		count(*) FILTER (WHERE status IN ('booked', 'in_transit', 'delayed')),
		coalesce(sum(weight_kg) FILTER (WHERE delivered_at >= $2), 0)
		FROM shipments WHERE company_id = $1`, company, since, prevSince).
		Scan(&a.Delivered, &a.OnTimePct, &a.PrevOnTime, &a.Delayed, &a.Active, &a.WeightKg)
	if err != nil {
		return a, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT d::date,
		       count(s.*) FILTER (WHERE s.mode = 'sea'), count(s.*) FILTER (WHERE s.mode = 'road'),
		       count(s.*) FILTER (WHERE s.mode = 'rail'), count(s.*) FILTER (WHERE s.mode = 'air')
		FROM generate_series(date_trunc('day', now() AT TIME ZONE $3) - ($2::int - 1) * interval '1 day',
		                     date_trunc('day', now() AT TIME ZONE $3), interval '1 day') d
		LEFT JOIN shipments s ON s.company_id = $1 AND date_trunc('day', s.delivered_at AT TIME ZONE $3) = d
		GROUP BY d ORDER BY d`, company, days, tz)
	if err != nil {
		return a, err
	}
	if a.Volume, err = pgx.CollectRows(rows, pgx.RowToStructByPos[DayVolume]); err != nil {
		return a, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT m.mode,
		       count(s.*) FILTER (WHERE s.delivered_at >= $2),
		       (100.0 * count(s.*) FILTER (WHERE s.delivered_at >= $2 AND s.delivered_at <= s.eta) / nullif(count(s.*) FILTER (WHERE s.delivered_at >= $2), 0))::float8,
		       (avg(extract(epoch FROM s.delivered_at - s.departed_at) / 3600) FILTER (WHERE s.delivered_at >= $2))::float8,
		       count(s.*) FILTER (WHERE s.status IN ('booked', 'in_transit', 'delayed'))
		FROM unnest(ARRAY['sea', 'road', 'rail', 'air']) WITH ORDINALITY AS m(mode, ord)
		LEFT JOIN shipments s ON s.company_id = $1 AND s.mode = m.mode
		GROUP BY m.mode, m.ord ORDER BY m.ord`, company, since)
	if err != nil {
		return a, err
	}
	if a.Modes, err = pgx.CollectRows(rows, pgx.RowToStructByPos[ModeStats]); err != nil {
		return a, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT carrier, min(mode),
		       count(*) FILTER (WHERE delivered_at >= $2),
		       (100.0 * count(*) FILTER (WHERE delivered_at >= $2 AND delivered_at <= eta) / nullif(count(*) FILTER (WHERE delivered_at >= $2), 0))::float8,
		       (avg(extract(epoch FROM delivered_at - departed_at) / 3600) FILTER (WHERE delivered_at >= $2))::float8,
		       count(*) FILTER (WHERE status = 'delayed')
		FROM shipments WHERE company_id = $1 GROUP BY carrier
		HAVING count(*) FILTER (WHERE delivered_at >= $2) > 0 OR count(*) FILTER (WHERE status = 'delayed') > 0
		ORDER BY 3 DESC`, company, since)
	if err != nil {
		return a, err
	}
	if a.Carriers, err = pgx.CollectRows(rows, pgx.RowToStructByPos[CarrierStats]); err != nil {
		return a, err
	}
	err = s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM inventory_items WHERE company_id = $1 AND on_hand - reserved <= reorder_point),
		(SELECT count(*) FROM time_off_requests WHERE company_id = $1 AND status = 'pending')`, company).
		Scan(&a.LowStock, &a.PendingPTO)
	return a, err
}

// ---- search ----

type SearchHit struct {
	Kind     string `json:"kind"`
	ID       int64  `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Link     string `json:"link"`
}

func (s *Store) Search(ctx context.Context, company string, userID int64, manager bool, q string) ([]SearchHit, error) {
	like := "%" + q + "%"
	var submitter *int64
	if !manager {
		submitter = &userID
	}
	rows, err := s.pool.Query(ctx, `
		(SELECT 'shipment', id, reference, customer || ' · ' || origin || ' → ' || destination, '/shipments/' || id
		 FROM shipments WHERE company_id = $1 AND (reference ILIKE $2 OR customer ILIKE $2 OR destination ILIKE $2 OR origin ILIKE $2)
		 ORDER BY id DESC LIMIT 6)
		UNION ALL
		(SELECT 'item', id, name, sku || ' · ' || location, '/inventory?q=' || sku
		 FROM inventory_items WHERE company_id = $1 AND (sku ILIKE $2 OR name ILIKE $2) ORDER BY sku LIMIT 5)
		UNION ALL
		(SELECT 'person', id, name, title, '/shifts'
		 FROM users WHERE company_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 5)
		UNION ALL
		(SELECT 'appointment', a.id, a.carrier || ' · ' || a.reference, d.name || ' · ' || to_char(a.starts_at, 'Dy DD Mon HH24:MI'),
		        '/docks?date=' || to_char(a.starts_at, 'YYYY-MM-DD')
		 FROM appointments a JOIN docks d ON d.id = a.dock_id
		 WHERE a.company_id = $1 AND (a.reference ILIKE $2 OR a.carrier ILIKE $2)
		 ORDER BY abs(extract(epoch FROM a.starts_at - now())) LIMIT 5)
		UNION ALL
		(SELECT 'job', id, '#' || id || ' ' || type, status, '/jobs?job=' || id
		 FROM jobs WHERE company_id = $1 AND run_id IS NULL AND ($3::bigint IS NULL OR submitted_by = $3)
		   AND (id::text = $4 OR type ILIKE $2) ORDER BY id DESC LIMIT 5)`,
		company, like, submitter, q)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[SearchHit])
}
