package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"relay/internal/realm"
)

// querier is satisfied by both the pool and a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

var activeStatuses = []string{"booked", "in_transit", "delayed"}

type Shipment struct {
	ID          int64      `json:"id"`
	Reference   string     `json:"reference"`
	Mode        string     `json:"mode"`
	Status      string     `json:"status"`
	Customer    string     `json:"customer"`
	Carrier     string     `json:"carrier"`
	Origin      string     `json:"origin"`
	Destination string     `json:"destination"`
	WeightKg    int        `json:"weightKg"`
	Pieces      int        `json:"pieces"`
	Priority    string     `json:"priority"`
	BookedAt    time.Time  `json:"bookedAt"`
	DepartsAt   time.Time  `json:"departsAt"`
	ETA         time.Time  `json:"eta"`
	DepartedAt  *time.Time `json:"departedAt"`
	DeliveredAt *time.Time `json:"deliveredAt"`
	ItemID      *int64     `json:"itemId"`
	ItemName    *string    `json:"itemName"`
	Quantity    *int       `json:"quantity"`
	Progress    float64    `json:"progress"`
	OnTime      *bool      `json:"onTime"`
}

const shipCols = `s.id, s.reference, s.mode, s.status, s.customer, s.carrier, s.origin, s.destination,
	s.weight_kg, s.pieces, s.priority, s.booked_at, s.departs_at, s.eta, s.departed_at, s.delivered_at,
	s.item_id, i.name, s.quantity,
	CASE WHEN s.status = 'delivered' THEN 1
	     WHEN s.departed_at IS NULL OR s.status = 'cancelled' THEN 0
	     ELSE greatest(0, least(0.99, extract(epoch FROM now() - s.departed_at) /
	          greatest(1, extract(epoch FROM s.arrives_at - s.departed_at)))) END::float8,
	CASE WHEN s.status = 'delivered' THEN s.delivered_at <= s.eta END`

const shipFrom = ` FROM shipments s LEFT JOIN inventory_items i ON i.id = s.item_id `

func scanShipment(r pgx.CollectableRow) (Shipment, error) {
	var s Shipment
	err := r.Scan(&s.ID, &s.Reference, &s.Mode, &s.Status, &s.Customer, &s.Carrier, &s.Origin, &s.Destination,
		&s.WeightKg, &s.Pieces, &s.Priority, &s.BookedAt, &s.DepartsAt, &s.ETA, &s.DepartedAt, &s.DeliveredAt,
		&s.ItemID, &s.ItemName, &s.Quantity, &s.Progress, &s.OnTime)
	return s, err
}

type NewShipment struct {
	Mode        string
	Customer    string
	Carrier     string
	Origin      string
	Destination string
	WeightKg    int
	Pieces      int
	Priority    string
	BookedAt    time.Time
	DepartsAt   time.Time
	ETA         time.Time
	ArrivesAt   time.Time
	ItemID      *int64
	Quantity    *int
	CreatedBy   *int64
	// Delivered pre-fills a historical shipment (used by the seed).
	Delivered bool
}

func (s *Store) CreateShipment(ctx context.Context, company string, n NewShipment) (Shipment, error) {
	var out Shipment
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		id, err := createShipment(ctx, tx, company, n)
		if err != nil {
			return err
		}
		out, err = shipmentByID(ctx, tx, company, id)
		return err
	})
	return out, err
}

func createShipment(ctx context.Context, q querier, company string, n NewShipment) (int64, error) {
	var id int64
	if err := q.QueryRow(ctx, `SELECT nextval('shipments_id_seq')`).Scan(&id); err != nil {
		return 0, err
	}
	status := "booked"
	var departed, delivered *time.Time
	if n.Delivered {
		status, departed, delivered = "delivered", &n.DepartsAt, &n.ArrivesAt
	}
	ref := fmt.Sprintf("SHP-%06d", 100000+id)
	_, err := q.Exec(ctx, `
		INSERT INTO shipments (id, company_id, reference, mode, status, customer, carrier, origin, destination,
			weight_kg, pieces, priority, booked_at, departs_at, eta, arrives_at, departed_at, delivered_at,
			checkpoint, item_id, quantity, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
		id, company, ref, n.Mode, status, n.Customer, n.Carrier, n.Origin, n.Destination,
		n.WeightKg, n.Pieces, n.Priority, n.BookedAt, n.DepartsAt, n.ETA, n.ArrivesAt, departed, delivered,
		n.Delivered, n.ItemID, n.Quantity, n.CreatedBy)
	if err != nil {
		return 0, err
	}
	events := [][3]any{{n.BookedAt, "booked", n.Origin}}
	if n.Delivered {
		events = append(events, [3]any{n.DepartsAt, "departed", n.Origin}, [3]any{n.ArrivesAt, "delivered", n.Destination})
	}
	for _, e := range events {
		if _, err := q.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location) VALUES ($1, $2, $3, $4)`,
			id, e[0], e[1], e[2]); err != nil {
			return 0, err
		}
	}
	return id, nil
}

func shipmentByID(ctx context.Context, q querier, company string, id int64) (Shipment, error) {
	rows, err := q.Query(ctx, `SELECT `+shipCols+shipFrom+`WHERE s.company_id = $1 AND s.id = $2`, company, id)
	if err != nil {
		return Shipment{}, err
	}
	sh, err := pgx.CollectExactlyOneRow(rows, scanShipment)
	if errors.Is(err, pgx.ErrNoRows) {
		return sh, ErrNotFound
	}
	return sh, err
}

func (s *Store) Shipment(ctx context.Context, company string, id int64) (Shipment, error) {
	return shipmentByID(ctx, s.pool, company, id)
}

type ShipmentEvent struct {
	At       time.Time `json:"at"`
	Kind     string    `json:"kind"`
	Location string    `json:"location"`
	Note     string    `json:"note"`
}

func (s *Store) ShipmentEvents(ctx context.Context, id int64) ([]ShipmentEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT at, kind, location, note FROM shipment_events WHERE shipment_id = $1 ORDER BY at, id`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ShipmentEvent])
}

type ShipmentFilter struct {
	Company string
	Status  string // a status, or "active"
	Mode    string
	Query   string
	Before  int64
	Limit   int
}

func (f ShipmentFilter) where(args *[]any, withStatus bool) string {
	add := func(v any) string { *args = append(*args, v); return "$" + strconv.Itoa(len(*args)) }
	w := "s.company_id = " + add(f.Company)
	if f.Mode != "" {
		w += " AND s.mode = " + add(f.Mode)
	}
	if withStatus {
		switch f.Status {
		case "":
		case "active":
			w += " AND s.status = ANY(" + add(activeStatuses) + ")"
		default:
			w += " AND s.status = " + add(f.Status)
		}
	}
	if f.Query != "" {
		p := add("%" + f.Query + "%")
		w += " AND (s.reference ILIKE " + p + " OR s.customer ILIKE " + p + " OR s.origin ILIKE " + p +
			" OR s.destination ILIKE " + p + " OR s.carrier ILIKE " + p + ")"
	}
	if f.Before > 0 {
		w += " AND s.id < " + add(f.Before)
	}
	return w
}

func (s *Store) ListShipments(ctx context.Context, f ShipmentFilter) ([]Shipment, error) {
	var args []any
	w := f.where(&args, true)
	args = append(args, max(1, min(f.Limit, 10000)))
	rows, err := s.pool.Query(ctx, `SELECT `+shipCols+shipFrom+`WHERE `+w+` ORDER BY s.id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanShipment)
}

func (s *Store) ShipmentCounts(ctx context.Context, f ShipmentFilter) (map[string]int64, error) {
	f.Before = 0
	var args []any
	w := f.where(&args, false)
	rows, err := s.pool.Query(ctx, `SELECT s.status, count(*) FROM shipments s WHERE `+w+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	out := map[string]int64{"booked": 0, "in_transit": 0, "delayed": 0, "delivered": 0, "cancelled": 0}
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

func (s *Store) CancelShipment(ctx context.Context, company string, id int64) (Shipment, error) {
	var out Shipment
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var origin string
		err := tx.QueryRow(ctx, `UPDATE shipments SET status = 'cancelled' WHERE company_id = $1 AND id = $2 AND status = 'booked'
			RETURNING origin`, company, id).Scan(&origin)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location, note) VALUES ($1, now(), 'cancelled', $2, 'Booking cancelled')`, id, origin); err != nil {
			return err
		}
		out, err = shipmentByID(ctx, tx, company, id)
		return err
	})
	return out, err
}

func (s *Store) AddShipmentEvent(ctx context.Context, id int64, kind, location, note string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location, note) VALUES ($1, now(), $2, $3, $4)`,
		id, kind, location, note)
	return err
}

type ActiveShipment struct {
	ID   int64
	Mode string
}

func (s *Store) ActiveShipments(ctx context.Context, company string) ([]ActiveShipment, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, mode FROM shipments WHERE company_id = $1 AND status = ANY($2)`, company, activeStatuses)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ActiveShipment])
}

// AdvanceClock moves every active shipment's timeline d into the past, as
// if d had elapsed. Used by the realm's fast-forward.
func (s *Store) AdvanceClock(ctx context.Context, company string, d time.Duration) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE shipment_events e SET at = e.at - $3::interval FROM shipments s
			WHERE e.shipment_id = s.id AND s.company_id = $1 AND s.status = ANY($2)`, company, activeStatuses, d); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE shipments SET booked_at = booked_at - $3::interval, departs_at = departs_at - $3::interval,
			       eta = eta - $3::interval, arrives_at = arrives_at - $3::interval, departed_at = departed_at - $3::interval
			WHERE company_id = $1 AND status = ANY($2)`, company, activeStatuses, d)
		n = tag.RowsAffected()
		return err
	})
	return n, err
}

// SyncResult reports what a tracking sync changed.
type SyncResult struct {
	Reference   string            `json:"reference"`
	Mode        string            `json:"mode"`
	Status      string            `json:"status"`
	Changed     bool              `json:"changed"`
	Departed    bool              `json:"departed,omitempty"`
	Delayed     bool              `json:"delayed,omitempty"`
	Delivered   bool              `json:"delivered,omitempty"`
	OnTime      bool              `json:"onTime,omitempty"`
	XP          int               `json:"xp,omitempty"`
	LevelBefore int               `json:"levelBefore,omitempty"`
	LevelAfter  int               `json:"levelAfter,omitempty"`
	Unlocked    []realm.Milestone `json:"unlocked,omitempty"`
	Restocked   string            `json:"restocked,omitempty"`
	Quantity    int               `json:"quantity,omitempty"`
}

// SyncShipment advances a shipment to match the clock: departure, a
// mid-route checkpoint, delay, and delivery. Delivery awards realm XP.
func (s *Store) SyncShipment(ctx context.Context, company string, id int64, now time.Time) (SyncResult, error) {
	var res SyncResult
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			status, mode, origin, dest, ref string
			departsAt, eta, arrivesAt       time.Time
			departedAt                      *time.Time
			checkpoint                      bool
			itemID                          *int64
			qty                             *int
		)
		err := tx.QueryRow(ctx, `
			SELECT status, mode, origin, destination, reference, departs_at, eta, arrives_at, departed_at, checkpoint, item_id, quantity
			FROM shipments WHERE company_id = $1 AND id = $2 FOR UPDATE`, company, id).
			Scan(&status, &mode, &origin, &dest, &ref, &departsAt, &eta, &arrivesAt, &departedAt, &checkpoint, &itemID, &qty)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		res.Reference, res.Mode, res.Status = ref, mode, status
		if status == "delivered" || status == "cancelled" {
			return nil
		}
		event := func(at time.Time, kind, loc, note string) error {
			_, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location, note) VALUES ($1, $2, $3, $4, $5)`,
				id, at, kind, loc, note)
			return err
		}
		if status == "booked" {
			if now.Before(departsAt) {
				return nil
			}
			status, departedAt = "in_transit", &departsAt
			res.Departed, res.Changed = true, true
			if _, err := tx.Exec(ctx, `UPDATE shipments SET status = 'in_transit', departed_at = departs_at WHERE id = $1`, id); err != nil {
				return err
			}
			if err := event(departsAt, "departed", origin, ""); err != nil {
				return err
			}
		}
		span := arrivesAt.Sub(*departedAt)
		if !checkpoint && span > 0 && now.Sub(*departedAt) >= span/2 {
			mid := departedAt.Add(span / 2)
			if _, err := tx.Exec(ctx, `UPDATE shipments SET checkpoint = true WHERE id = $1`, id); err != nil {
				return err
			}
			kind, note := "checkpoint", "Scanned at the midway hub"
			if mode == "sea" || mode == "air" {
				kind, note = "customs", "Cleared customs"
			}
			if err := event(mid, kind, "En route to "+dest, note); err != nil {
				return err
			}
			res.Changed = true
		}
		if !now.Before(arrivesAt) {
			return s.deliver(ctx, tx, company, id, mode, dest, arrivesAt, eta, itemID, qty, &res)
		}
		if now.After(eta) && status == "in_transit" {
			if _, err := tx.Exec(ctx, `UPDATE shipments SET status = 'delayed' WHERE id = $1`, id); err != nil {
				return err
			}
			if err := event(eta, "delayed", "En route to "+dest, "Carrier reported a delay; revised ETA pending"); err != nil {
				return err
			}
			res.Status, res.Delayed, res.Changed = "delayed", true, true
			return nil
		}
		res.Status = status
		return nil
	})
	return res, err
}

func (s *Store) deliver(ctx context.Context, tx pgx.Tx, company string, id int64, mode, dest string,
	arrivesAt, eta time.Time, itemID *int64, qty *int, res *SyncResult) error {
	if _, err := tx.Exec(ctx, `UPDATE shipments SET status = 'delivered', delivered_at = arrives_at WHERE id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location) VALUES ($1, $2, 'delivered', $3)`,
		id, arrivesAt, dest); err != nil {
		return err
	}
	res.Status, res.Delivered, res.Changed, res.OnTime = "delivered", true, true, !arrivesAt.After(eta)

	if itemID != nil && qty != nil {
		if err := tx.QueryRow(ctx, `UPDATE inventory_items SET on_hand = on_hand + $2, updated_at = now() WHERE id = $1 RETURNING name`,
			*itemID, *qty).Scan(&res.Restocked); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		res.Quantity = *qty
	}

	var xp, level int
	err := tx.QueryRow(ctx, `
		INSERT INTO realm_progress (company_id, mode, xp, level) VALUES ($1, $2, 1, 1)
		ON CONFLICT (company_id, mode) DO UPDATE SET xp = realm_progress.xp + 1
		RETURNING xp, level`, company, mode).Scan(&xp, &level)
	if err != nil {
		return err
	}
	res.XP, res.LevelBefore, res.LevelAfter = xp, level, realm.Level(xp)
	if res.LevelAfter > level {
		if _, err := tx.Exec(ctx, `UPDATE realm_progress SET level = $3 WHERE company_id = $1 AND mode = $2`, company, mode, res.LevelAfter); err != nil {
			return err
		}
		for lvl := level + 1; lvl <= res.LevelAfter; lvl++ {
			if m, ok, err := unlock(ctx, tx, company, realm.LevelMilestone(mode, lvl)); err != nil {
				return err
			} else if ok {
				res.Unlocked = append(res.Unlocked, m)
			}
		}
	}
	var total int
	if err := tx.QueryRow(ctx, `SELECT coalesce(sum(xp), 0) FROM realm_progress WHERE company_id = $1`, company).Scan(&total); err != nil {
		return err
	}
	for _, d := range realm.DeliveryMilestones {
		if total == d.At {
			if m, ok, err := unlock(ctx, tx, company, d.Milestone); err != nil {
				return err
			} else if ok {
				res.Unlocked = append(res.Unlocked, m)
			}
		}
	}
	return nil
}

func unlock(ctx context.Context, q querier, company string, m realm.Milestone) (realm.Milestone, bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO milestones (company_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING`, company, m.Key)
	return m, err == nil && tag.RowsAffected() == 1, err
}
