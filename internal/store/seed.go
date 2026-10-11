package store

import (
	"context"
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// DemoPassword is shared by every seeded account.
const DemoPassword = "relay-demo"

type seedPerson struct {
	first, last, title, role string
	demo                     bool
}

type seedCompany struct {
	Company
	domain    string
	docks     []Dock
	people    []seedPerson
	positions []string
	locations []string
}

var seedCompanies = []seedCompany{
	{
		Company: Company{ID: "harborline", Name: "Harborline Freight", Initials: "HF",
			Hub: "Savannah cross-dock", AccentLight: "#0d7a6f", AccentDark: "#3ad6bf"},
		domain: "harborline.example",
		docks: []Dock{{Name: "Door 1", Kind: "dry"}, {Name: "Door 2", Kind: "dry"}, {Name: "Door 3", Kind: "dry"},
			{Name: "Door 4", Kind: "dry"}, {Name: "Door 5", Kind: "flatbed"}, {Name: "Door 6", Kind: "flatbed"}},
		people: []seedPerson{
			{"Maya", "Okafor", "Operations manager", "manager", true},
			{"Luis", "Ortega", "Dock lead", "employee", true},
			{"Jordan", "Lee", "Forklift operator", "employee", false},
			{"Aaliyah", "Brooks", "Receiving clerk", "employee", false},
			{"Ben", "Carter", "Loader", "employee", false},
			{"Nina", "Park", "Yard driver", "employee", false},
			{"Omar", "Haddad", "Inventory control", "employee", false},
		},
		positions: []string{"Receiving", "Loading", "Yard", "Inventory"},
		locations: []string{"Doors 1–3", "Doors 4–6", "Yard", "Aisle C"},
	},
	{
		Company: Company{ID: "meridian", Name: "Meridian Cold Chain", Initials: "MC",
			Hub: "Rotterdam reefer hub", AccentLight: "#2856d8", AccentDark: "#86a8ff"},
		domain: "meridian.example",
		docks: []Dock{{Name: "Reefer 1", Kind: "reefer"}, {Name: "Reefer 2", Kind: "reefer"}, {Name: "Reefer 3", Kind: "reefer"},
			{Name: "Reefer 4", Kind: "reefer"}, {Name: "Dry 5", Kind: "dry"}},
		people: []seedPerson{
			{"Priya", "Raman", "Site manager", "manager", true},
			{"Tom", "Becker", "Reefer technician", "employee", true},
			{"Eva", "Jansen", "Cold store picker", "employee", false},
			{"Sven", "de Vries", "Reach truck driver", "employee", false},
			{"Fatima", "Zahra", "QA inspector", "employee", false},
			{"Lucas", "Meyer", "Dispatcher", "employee", false},
			{"Iris", "Bakker", "Cold store picker", "employee", false},
		},
		positions: []string{"Cold store", "QA", "Dispatch", "Reefer checks"},
		locations: []string{"Chamber −25 °C", "Chamber +4 °C", "Dock office", "Reefer bays"},
	},
	{
		Company: Company{ID: "kestrel", Name: "Kestrel Parcel", Initials: "KP",
			Hub: "Leeds sortation centre", AccentLight: "#c2410c", AccentDark: "#ff9a5c"},
		domain: "kestrel.example",
		docks: []Dock{{Name: "Bay A", Kind: "parcel"}, {Name: "Bay B", Kind: "parcel"}, {Name: "Bay C", Kind: "parcel"},
			{Name: "Bay D", Kind: "parcel"}, {Name: "Bay E", Kind: "linehaul"}, {Name: "Bay F", Kind: "linehaul"}},
		people: []seedPerson{
			{"Aiko", "Tanaka", "Hub manager", "manager", true},
			{"Sam", "Rivera", "Sortation associate", "employee", true},
			{"Chloe", "Evans", "Induct operator", "employee", false},
			{"Harry", "Patel", "Linehaul loader", "employee", false},
			{"Grace", "Wilson", "Exceptions desk", "employee", false},
			{"Daniel", "Murphy", "Van loader", "employee", false},
			{"Zoe", "Hughes", "Induct operator", "employee", false},
		},
		positions: []string{"Induct", "Sortation", "Linehaul", "Exceptions"},
		locations: []string{"Induct line 1", "Sorter deck", "Bays E–F", "Exceptions cage"},
	},
}

var carriers = []string{
	"Blue Ridge Haulage", "Coastline Carriers", "Summit Transport", "Delta Line Trucking",
	"Ironbridge Logistics", "Prairie Express", "Northgate Freight", "Lakeshore Cartage",
}

// Seed creates the demo companies and accounts if they are missing, and
// makes sure there are appointments and shifts around today.
func (s *Store) Seed(ctx context.Context, now time.Time) error {
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM companies`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if err := s.seedAccounts(ctx); err != nil {
			return fmt.Errorf("seed accounts: %w", err)
		}
	}
	for _, c := range seedCompanies {
		if err := s.seedSchedule(ctx, c, now); err != nil {
			return fmt.Errorf("seed schedule for %s: %w", c.ID, err)
		}
	}
	return nil
}

func (s *Store) seedAccounts(ctx context.Context) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(DemoPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, c := range seedCompanies {
			if _, err := tx.Exec(ctx, `INSERT INTO companies (id, name, initials, hub, accent_light, accent_dark)
				VALUES ($1, $2, $3, $4, $5, $6)`, c.ID, c.Name, c.Initials, c.Hub, c.AccentLight, c.AccentDark); err != nil {
				return err
			}
			for i, d := range c.docks {
				if _, err := tx.Exec(ctx, `INSERT INTO docks (company_id, name, kind, position) VALUES ($1, $2, $3, $4)`,
					c.ID, d.Name, d.Kind, i); err != nil {
					return err
				}
			}
			for _, p := range c.people {
				email := fmt.Sprintf("%s@%s", lower(p.first), c.domain)
				if _, err := tx.Exec(ctx, `INSERT INTO users (company_id, email, name, title, role, password_hash, demo)
					VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					c.ID, email, p.first+" "+p.last, p.title, p.role, string(hash), p.demo); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func dayStart(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func weekStart(t time.Time) time.Time {
	d := dayStart(t)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

func seededRand(parts ...string) *rand.Rand {
	h := fnv.New64a()
	for _, p := range parts {
		h.Write([]byte(p))
	}
	return rand.New(rand.NewPCG(h.Sum64(), 0x5eed))
}

func (s *Store) seedSchedule(ctx context.Context, c seedCompany, now time.Time) error {
	docks, err := s.Docks(ctx, c.ID)
	if err != nil {
		return err
	}
	staff, err := s.Staff(ctx, c.ID)
	if err != nil {
		return err
	}
	var employees []Staff
	var demoEmployee int64
	for _, p := range staff {
		if p.Role == "employee" {
			employees = append(employees, p)
		}
	}
	if err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1 AND demo AND role = 'employee'`, c.ID).
		Scan(&demoEmployee); err != nil {
		return err
	}

	today := dayStart(now)
	for offset := -2; offset <= 6; offset++ {
		day := today.AddDate(0, 0, offset)
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM appointments
			WHERE company_id = $1 AND starts_at >= $2 AND starts_at < $3)`, c.ID, day, day.AddDate(0, 0, 1)).
			Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if err := s.seedDay(ctx, c, docks, employees, demoEmployee, day, now); err != nil {
				return err
			}
		}
	}

	for _, week := range []time.Time{weekStart(now), weekStart(now).AddDate(0, 0, 7)} {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM shifts
			WHERE company_id = $1 AND starts_at >= $2 AND starts_at < $3)`, c.ID, week, week.AddDate(0, 0, 7)).
			Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if err := s.seedWeek(ctx, c, staff, week, now); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) seedDay(ctx context.Context, c seedCompany, docks []Dock, employees []Staff, demoEmployee int64, day, now time.Time) error {
	r := seededRand(c.ID, day.Format(time.DateOnly))
	batch := &pgx.Batch{}
	demoAssigned := 0
	for _, d := range docks {
		cursor := day.Add(6*time.Hour + time.Duration(r.IntN(4))*30*time.Minute)
		end := day.Add(20 * time.Hour)
		for {
			length := time.Duration(2+r.IntN(4)) * 30 * time.Minute
			if cursor.Add(length).After(end) {
				break
			}
			status := "confirmed"
			switch {
			case cursor.Add(length).Before(now):
				status = "completed"
			case cursor.Before(now):
				status = "checked_in"
			case r.IntN(5) == 0:
				status = "requested"
			}
			assignee := employees[r.IntN(len(employees))].ID
			if !day.Before(dayStart(now)) && status == "confirmed" && demoAssigned < 3 && r.IntN(3) == 0 {
				assignee = demoEmployee
				demoAssigned++
			}
			var checkedIn *time.Time
			if status == "checked_in" || status == "completed" {
				t := cursor.Add(time.Duration(r.IntN(10)) * time.Minute)
				checkedIn = &t
			}
			dir := "inbound"
			if r.IntN(5) < 2 {
				dir = "outbound"
			}
			ref := fmt.Sprintf("%s-%d", map[string]string{"inbound": "PO", "outbound": "SO"}[dir], 40000+r.IntN(59999))
			batch.Queue(`INSERT INTO appointments (company_id, dock_id, carrier, reference, direction, pallets,
				starts_at, ends_at, status, assigned_to, checked_in_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				c.ID, d.ID, carriers[r.IntN(len(carriers))], ref, dir, 4+r.IntN(30),
				cursor, cursor.Add(length), status, assignee, checkedIn)
			cursor = cursor.Add(length + time.Duration(r.IntN(4))*30*time.Minute)
		}
	}
	return s.pool.SendBatch(ctx, batch).Close()
}

type shiftTemplate struct {
	start, end time.Duration
}

var templates = []shiftTemplate{
	{6 * time.Hour, 14 * time.Hour},
	{8 * time.Hour, 16*time.Hour + 30*time.Minute},
	{14 * time.Hour, 22 * time.Hour},
}

func (s *Store) seedWeek(ctx context.Context, c seedCompany, staff []Staff, week, now time.Time) error {
	r := seededRand(c.ID, "week", week.Format(time.DateOnly))
	published := !week.After(now)
	batch := &pgx.Batch{}
	for i, p := range staff {
		off := r.IntN(7)
		off2 := (off + 1 + r.IntN(2)) % 7
		tpl := templates[i%len(templates)]
		pos := i % len(c.positions)
		if p.Role == "manager" {
			tpl, off, off2 = templates[1], 5, 6
		}
		for d := range 7 {
			if d == off || d == off2 {
				continue
			}
			day := week.AddDate(0, 0, d)
			batch.Queue(`INSERT INTO shifts (company_id, user_id, starts_at, ends_at, position, location, published)
				VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				c.ID, p.ID, day.Add(tpl.start), day.Add(tpl.end), c.positions[pos], c.locations[pos],
				published || r.IntN(3) == 0)
		}
	}
	return s.pool.SendBatch(ctx, batch).Close()
}
