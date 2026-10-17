package store

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- notifications ----

type Notification struct {
	ID        int64      `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      string     `json:"link"`
	CreatedAt time.Time  `json:"createdAt"`
	ReadAt    *time.Time `json:"readAt"`
}

type NotifyTarget struct {
	Company string
	Role    string  // "" for everyone in the company
	UserIDs []int64 // overrides Company/Role when set
}

func (s *Store) Notify(ctx context.Context, t NotifyTarget, kind, title, body, link string) error {
	if len(t.UserIDs) > 0 {
		_, err := s.pool.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, body, link)
			SELECT unnest($1::bigint[]), $2, $3, $4, $5`, t.UserIDs, kind, title, body, link)
		return err
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, body, link)
		SELECT id, $3, $4, $5, $6 FROM users WHERE company_id = $1 AND ($2 = '' OR role = $2)`,
		t.Company, t.Role, kind, title, body, link)
	return err
}

func (s *Store) Notifications(ctx context.Context, userID int64, limit int) ([]Notification, int, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, kind, title, body, link, created_at, read_at FROM notifications
		WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Notification])
	if err != nil {
		return nil, 0, err
	}
	n, err := s.UnreadCount(ctx, userID)
	return list, n, err
}

func (s *Store) UnreadCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

// MarkRead marks the given notifications read, or all of them when ids is empty.
func (s *Store) MarkRead(ctx context.Context, userID int64, ids []int64) error {
	if len(ids) == 0 {
		_, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, userID, ids)
	return err
}

// ---- audit log ----

type AuditEntry struct {
	ID     int64     `json:"id"`
	Actor  *string   `json:"actor"`
	Action string    `json:"action"`
	Target string    `json:"target"`
	Detail string    `json:"detail"`
	At     time.Time `json:"at"`
}

func (s *Store) Audit(ctx context.Context, company string, userID *int64, action, target, detail string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO audit_log (company_id, user_id, action, target, detail) VALUES ($1, $2, $3, $4, $5)`,
		company, userID, action, target, detail)
	return err
}

func (s *Store) Activity(ctx context.Context, company, action string, before int64, limit int) ([]AuditEntry, error) {
	args := []any{company}
	w := "a.company_id = $1"
	if action != "" {
		args = append(args, action+"%")
		w += " AND a.action LIKE $" + strconv.Itoa(len(args))
	}
	if before > 0 {
		args = append(args, before)
		w += " AND a.id < $" + strconv.Itoa(len(args))
	}
	args = append(args, max(1, min(limit, 200)))
	rows, err := s.pool.Query(ctx, `SELECT a.id, u.name, a.action, a.target, a.detail, a.at
		FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE `+w+` ORDER BY a.id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[AuditEntry])
}

// ---- appearance settings ----

type Settings struct {
	Mode        string `json:"mode"`
	Scheme      string `json:"scheme"`
	CustomColor string `json:"customColor"`
}

var DefaultSettings = Settings{Mode: "system", Scheme: "moss", CustomColor: "#6f8f5e"}

func (s *Store) Settings(ctx context.Context, userID int64) (Settings, error) {
	st := DefaultSettings
	err := s.pool.QueryRow(ctx, `SELECT mode, scheme, custom_color FROM user_settings WHERE user_id = $1`, userID).
		Scan(&st.Mode, &st.Scheme, &st.CustomColor)
	if err == pgx.ErrNoRows {
		return DefaultSettings, nil
	}
	return st, err
}

func (s *Store) SaveSettings(ctx context.Context, userID int64, st Settings) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO user_settings (user_id, mode, scheme, custom_color, updated_at) VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET mode = $2, scheme = $3, custom_color = $4, updated_at = now()`,
		userID, st.Mode, st.Scheme, st.CustomColor)
	return err
}
