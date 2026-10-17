package store

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- time-off requests ----

type TimeOff struct {
	ID        int64      `json:"id"`
	UserID    int64      `json:"userId"`
	Name      string     `json:"name"`
	Kind      string     `json:"kind"`
	StartsOn  time.Time  `json:"startsOn"`
	EndsOn    time.Time  `json:"endsOn"`
	Reason    string     `json:"reason"`
	Status    string     `json:"status"`
	DecidedBy *string    `json:"decidedBy"`
	DecidedAt *time.Time `json:"decidedAt"`
	Note      string     `json:"note"`
	CreatedAt time.Time  `json:"createdAt"`
	Days      int        `json:"days"`
}

const timeOffCols = `r.id, r.user_id, u.name, r.kind, r.starts_on, r.ends_on, r.reason, r.status, d.name, r.decided_at, r.note, r.created_at,
	(r.ends_on - r.starts_on + 1)`

const timeOffFrom = ` FROM time_off_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by `

type TimeOffFilter struct {
	Company string
	UserID  int64
	Status  string
	From    time.Time // overlapping a range, when set
	To      time.Time
}

func (s *Store) TimeOff(ctx context.Context, f TimeOffFilter) ([]TimeOff, error) {
	args := []any{f.Company}
	add := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	w := "r.company_id = $1"
	if f.UserID != 0 {
		w += " AND r.user_id = " + add(f.UserID)
	}
	if f.Status != "" {
		w += " AND r.status = " + add(f.Status)
	}
	if !f.From.IsZero() {
		w += " AND r.ends_on >= " + add(f.From) + "::date AND r.starts_on < " + add(f.To) + "::date"
	}
	rows, err := s.pool.Query(ctx, `SELECT `+timeOffCols+timeOffFrom+`WHERE `+w+`
		ORDER BY (r.status = 'pending') DESC, r.starts_on DESC, r.id DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[TimeOff])
}

type NewTimeOff struct {
	Kind     string `json:"kind"`
	StartsOn string `json:"startsOn"`
	EndsOn   string `json:"endsOn"`
	Reason   string `json:"reason"`
}

func (s *Store) CreateTimeOff(ctx context.Context, company string, userID int64, n NewTimeOff) (int64, error) {
	var overlap bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM time_off_requests WHERE user_id = $1
		AND status IN ('pending', 'approved') AND starts_on <= $3::date AND ends_on >= $2::date)`,
		userID, n.StartsOn, n.EndsOn).Scan(&overlap); err != nil {
		return 0, err
	}
	if overlap {
		return 0, ErrConflict
	}
	var id int64
	err := s.pool.QueryRow(ctx, `INSERT INTO time_off_requests (company_id, user_id, kind, starts_on, ends_on, reason)
		VALUES ($1, $2, $3, $4::date, $5::date, $6) RETURNING id`, company, userID, n.Kind, n.StartsOn, n.EndsOn, n.Reason).Scan(&id)
	return id, err
}

// DecideTimeOff approves or denies a pending request.
func (s *Store) DecideTimeOff(ctx context.Context, company string, id, managerID int64, decision, note string) (TimeOff, error) {
	// A manager can't decide their own request; another manager has to.
	tag, err := s.pool.Exec(ctx, `UPDATE time_off_requests SET status = $4, decided_by = $3, decided_at = now(), note = $5
		WHERE company_id = $1 AND id = $2 AND status = 'pending' AND user_id <> $3`, company, id, managerID, decision, note)
	if err != nil {
		return TimeOff{}, err
	}
	if tag.RowsAffected() == 0 {
		return TimeOff{}, ErrConflict
	}
	return s.timeOffByID(ctx, company, id)
}

func (s *Store) WithdrawTimeOff(ctx context.Context, company string, id, userID int64) error {
	tag, err := s.pool.Exec(ctx, `UPDATE time_off_requests SET status = 'withdrawn'
		WHERE company_id = $1 AND id = $2 AND user_id = $3 AND status = 'pending'`, company, id, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return err
}

func (s *Store) timeOffByID(ctx context.Context, company string, id int64) (TimeOff, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+timeOffCols+timeOffFrom+`WHERE r.company_id = $1 AND r.id = $2`, company, id)
	if err != nil {
		return TimeOff{}, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[TimeOff])
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	return t, err
}

func (s *Store) PendingTimeOff(ctx context.Context, company string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM time_off_requests WHERE company_id = $1 AND status = 'pending'`, company).Scan(&n)
	return n, err
}

// ---- inventory ----

type Item struct {
	ID           int64     `json:"id"`
	SKU          string    `json:"sku"`
	Name         string    `json:"name"`
	Category     string    `json:"category"`
	Location     string    `json:"location"`
	Unit         string    `json:"unit"`
	OnHand       int       `json:"onHand"`
	Reserved     int       `json:"reserved"`
	Available    int       `json:"available"`
	ReorderPoint int       `json:"reorderPoint"`
	ReorderQty   int       `json:"reorderQty"`
	Inbound      int       `json:"inbound"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

const itemCols = `i.id, i.sku, i.name, i.category, i.location, i.unit, i.on_hand, i.reserved, i.on_hand - i.reserved,
	i.reorder_point, i.reorder_qty,
	coalesce((SELECT sum(quantity) FROM shipments s WHERE s.item_id = i.id AND s.status IN ('booked', 'in_transit', 'delayed')), 0)::int,
	i.updated_at`

type ItemFilter struct {
	Company  string
	Query    string
	Category string
	Low      bool
}

func (s *Store) Inventory(ctx context.Context, f ItemFilter) ([]Item, error) {
	args := []any{f.Company}
	add := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	w := "i.company_id = $1"
	if f.Query != "" {
		p := add("%" + f.Query + "%")
		w += " AND (i.sku ILIKE " + p + " OR i.name ILIKE " + p + " OR i.location ILIKE " + p + ")"
	}
	if f.Category != "" {
		w += " AND i.category = " + add(f.Category)
	}
	if f.Low {
		w += " AND i.on_hand - i.reserved <= i.reorder_point"
	}
	rows, err := s.pool.Query(ctx, `SELECT `+itemCols+` FROM inventory_items i WHERE `+w+` ORDER BY i.sku`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Item])
}

func (s *Store) Item(ctx context.Context, company string, id int64) (Item, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+itemCols+` FROM inventory_items i WHERE i.company_id = $1 AND i.id = $2`, company, id)
	if err != nil {
		return Item{}, err
	}
	it, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Item])
	if errors.Is(err, pgx.ErrNoRows) {
		return it, ErrNotFound
	}
	return it, err
}

// AdjustStock changes on-hand stock by delta (clamped at zero when
// clamp is set). It reports whether the item crossed its reorder point.
func (s *Store) AdjustStock(ctx context.Context, company string, id int64, delta int, clamp bool) (Item, bool, error) {
	var before, after, rp int
	err := s.pool.QueryRow(ctx, `
		WITH old AS (SELECT on_hand - reserved AS avail FROM inventory_items WHERE company_id = $1 AND id = $2 FOR UPDATE)
		UPDATE inventory_items i SET on_hand = CASE WHEN $4 THEN greatest(0, i.on_hand + $3) ELSE i.on_hand + $3 END, updated_at = now()
		FROM old WHERE i.company_id = $1 AND i.id = $2
		RETURNING old.avail, i.on_hand - i.reserved, i.reorder_point`, company, id, delta, clamp).Scan(&before, &after, &rp)
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, false, ErrNotFound
	}
	if err != nil {
		var pgErr interface{ SQLState() string }
		if errors.As(err, &pgErr) && pgErr.SQLState() == "23514" {
			return Item{}, false, ErrConflict
		}
		return Item{}, false, err
	}
	it, err := s.Item(ctx, company, id)
	return it, before > rp && after <= rp, err
}

func (s *Store) ItemIDs(ctx context.Context, company string) ([]int64, error) {
	rows, _ := s.pool.Query(ctx, `SELECT id FROM inventory_items WHERE company_id = $1`, company)
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

// StockedOut lists items with nothing available and no replenishment on the way.
func (s *Store) StockedOut(ctx context.Context, company string) ([]int64, error) {
	rows, _ := s.pool.Query(ctx, `SELECT i.id FROM inventory_items i WHERE i.company_id = $1 AND i.on_hand - i.reserved <= 0
		AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.item_id = i.id AND s.status IN ('booked', 'in_transit', 'delayed'))`, company)
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

func (s *Store) Categories(ctx context.Context, company string) ([]string, error) {
	rows, _ := s.pool.Query(ctx, `SELECT DISTINCT category FROM inventory_items WHERE company_id = $1 ORDER BY 1`, company)
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
