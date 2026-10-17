package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"relay/internal/realm"
)

type ModeProgress struct {
	XP    int
	Level int
}

func (s *Store) RealmProgress(ctx context.Context, company string) (map[string]ModeProgress, error) {
	out := map[string]ModeProgress{}
	for _, m := range realm.Modes {
		out[m] = ModeProgress{Level: 1}
	}
	rows, err := s.pool.Query(ctx, `SELECT mode, xp, level FROM realm_progress WHERE company_id = $1`, company)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m string
		var p ModeProgress
		if err := rows.Scan(&m, &p.XP, &p.Level); err != nil {
			return nil, err
		}
		out[m] = p
	}
	return out, rows.Err()
}

func (s *Store) Milestones(ctx context.Context, company string) (map[string]time.Time, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, unlocked_at FROM milestones WHERE company_id = $1`, company)
	if err != nil {
		return nil, err
	}
	out := map[string]time.Time{}
	for rows.Next() {
		var k string
		var t time.Time
		if err := rows.Scan(&k, &t); err != nil {
			return nil, err
		}
		out[k] = t
	}
	return out, rows.Err()
}

// RealmCounts are the things the map's town grows from.
type RealmCounts struct {
	Staff      int `json:"staff"`
	Docks      int `json:"docks"`
	SKUs       int `json:"skus"`
	Delivered  int `json:"delivered"`
	Delayed    int `json:"delayed"`
	ActiveRoad int `json:"-"`
}

func (s *Store) RealmCounts(ctx context.Context, company string) (RealmCounts, error) {
	var c RealmCounts
	err := s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM users WHERE company_id = $1),
		(SELECT count(*) FROM docks WHERE company_id = $1),
		(SELECT count(*) FROM inventory_items WHERE company_id = $1),
		(SELECT coalesce(sum(xp), 0) FROM realm_progress WHERE company_id = $1),
		(SELECT count(*) FROM shipments WHERE company_id = $1 AND status = 'delayed')`, company).
		Scan(&c.Staff, &c.Docks, &c.SKUs, &c.Delivered, &c.Delayed)
	return c, err
}

// ActiveByMode returns moving and booked shipments for the map, newest
// departures first.
func (s *Store) ActiveByMode(ctx context.Context, company string) (map[string][]Shipment, map[string]int, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+shipCols+shipFrom+`
		WHERE s.company_id = $1 AND s.status = ANY($2) ORDER BY s.departs_at`, company, activeStatuses)
	if err != nil {
		return nil, nil, err
	}
	list, err := pgx.CollectRows(rows, scanShipment)
	if err != nil {
		return nil, nil, err
	}
	byMode := map[string][]Shipment{}
	counts := map[string]int{}
	for _, m := range realm.Modes {
		byMode[m] = []Shipment{}
	}
	for _, sh := range list {
		byMode[sh.Mode] = append(byMode[sh.Mode], sh)
		counts[sh.Mode]++
	}
	return byMode, counts, nil
}

// SetProgress seeds a mode's XP and unlocks the milestones it implies.
func (s *Store) SetProgress(ctx context.Context, company, mode string, xp int) error {
	level := realm.Level(xp)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO realm_progress (company_id, mode, xp, level) VALUES ($1, $2, $3, $4)
			ON CONFLICT (company_id, mode) DO UPDATE SET xp = $3, level = $4`, company, mode, xp, level); err != nil {
			return err
		}
		for lvl := 2; lvl <= level; lvl++ {
			if _, _, err := unlock(ctx, tx, company, realm.LevelMilestone(mode, lvl)); err != nil {
				return err
			}
		}
		return nil
	})
}

// UnlockDeliveryMilestones backfills delivery-count milestones.
func (s *Store) UnlockDeliveryMilestones(ctx context.Context, company string) error {
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(xp), 0) FROM realm_progress WHERE company_id = $1`, company).Scan(&total); err != nil {
		return err
	}
	for _, d := range realm.DeliveryMilestones {
		if total >= d.At {
			if _, _, err := unlock(ctx, s.pool, company, d.Milestone); err != nil {
				return err
			}
		}
	}
	return nil
}
