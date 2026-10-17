package store

import (
	"context"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"

	"relay/internal/realm"
)

// Starting XP per mode. Each company has a different shape, and some modes
// sit just under a level so a fast-forward shows a level-up.
var seedXP = map[string]map[string]int{
	"harborline": {"sea": 520, "road": 180, "rail": 62, "air": 47},
	"meridian":   {"sea": 393, "road": 450, "rail": 170, "air": 72},
	"kestrel":    {"sea": 18, "road": 1180, "rail": 146, "air": 420},
}

type seedItem struct {
	sku, name, category, unit string
	onHand, rp, qty           int
}

var seedItems = map[string][]seedItem{
	"harborline": {
		{"HF-PAL-120", "Euro pallet 120×80", "Packaging", "ea", 340, 120, 400},
		{"HF-STR-50", "Stretch wrap 50 cm", "Packaging", "roll", 46, 30, 60},
		{"HF-CNR-01", "Corner boards", "Packaging", "box", 18, 20, 40},
		{"HF-COF-25", "Arabica beans 25 kg", "Coffee", "sack", 212, 80, 240},
		{"HF-COF-12", "Robusta beans 12 kg", "Coffee", "sack", 95, 60, 160},
		{"HF-CTN-BL", "Cotton bales", "Textiles", "bale", 64, 40, 80},
		{"HF-TYR-22", "Truck tyres 22.5\"", "Fleet parts", "ea", 12, 16, 24},
		{"HF-FLT-OIL", "Hydraulic oil 20 L", "Fleet parts", "drum", 30, 12, 24},
		{"HF-LBL-4X6", "Thermal labels 4×6", "Consumables", "roll", 140, 60, 200},
		{"HF-SEAL-HB", "High-security seals", "Consumables", "box", 22, 10, 30},
		{"HF-TMB-PN", "Pine lumber bundles", "Timber", "bundle", 48, 20, 40},
		{"HF-RSN-25", "Resin pellets 25 kg", "Chemicals", "bag", 380, 150, 300},
	},
	"meridian": {
		{"MC-BER-FZ", "Frozen berries 10 kg", "Frozen", "case", 520, 200, 600},
		{"MC-FSH-CD", "Cod fillets 5 kg", "Frozen", "case", 180, 120, 240},
		{"MC-ICE-CR", "Ice cream tubs", "Frozen", "case", 96, 100, 300},
		{"MC-TUL-BL", "Tulip bulbs", "Horticulture", "crate", 240, 80, 200},
		{"MC-ROS-ST", "Cut roses", "Horticulture", "bucket", 75, 60, 150},
		{"MC-VAC-2C", "Vaccines 2–8 °C", "Pharma", "carton", 42, 30, 60},
		{"MC-INS-2C", "Insulin pens", "Pharma", "carton", 66, 40, 80},
		{"MC-DRY-GL", "Dry ice pellets", "Consumables", "kg", 900, 400, 1000},
		{"MC-LGR-TM", "Temperature loggers", "Consumables", "ea", 34, 40, 100},
		{"MC-CHS-GD", "Gouda wheels", "Chilled", "wheel", 150, 70, 160},
		{"MC-BTR-CH", "Butter blocks", "Chilled", "case", 210, 90, 200},
	},
	"kestrel": {
		{"KP-BOX-S", "Mailer box small", "Packaging", "ea", 4200, 1500, 5000},
		{"KP-BOX-M", "Mailer box medium", "Packaging", "ea", 2600, 1200, 4000},
		{"KP-BOX-L", "Mailer box large", "Packaging", "ea", 900, 1000, 2500},
		{"KP-BAG-PL", "Poly mailers", "Packaging", "ea", 7800, 3000, 8000},
		{"KP-TPE-48", "Packing tape 48 mm", "Consumables", "roll", 360, 200, 600},
		{"KP-LBL-A6", "Shipping labels A6", "Consumables", "roll", 410, 150, 500},
		{"KP-SCN-HH", "Handheld scanners", "Equipment", "ea", 38, 20, 20},
		{"KP-CAG-RL", "Roll cages", "Equipment", "ea", 140, 60, 80},
		{"KP-TOT-BL", "Blue totes", "Equipment", "ea", 950, 400, 600},
		{"KP-HVZ-L", "Hi-vis vests (L)", "Workwear", "ea", 54, 40, 100},
		{"KP-GLV-M", "Work gloves (M)", "Workwear", "pair", 120, 80, 200},
		{"KP-BAT-AA", "AA batteries", "Consumables", "pack", 22, 30, 80},
	},
}

var seedLocations = []string{"A-01-02", "A-03-01", "A-07-04", "B-02-03", "B-05-01", "B-09-02", "C-01-01", "C-04-03", "D-02-02", "D-06-01", "E-01-04", "E-03-02", "F-02-01"}

// seedOperations fills shipments, inventory, realm progress and requests
// for a company that has none yet.
func (s *Store) seedOperations(ctx context.Context, c seedCompany, now time.Time) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM inventory_items WHERE company_id = $1)`, c.ID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	r := seededRand(c.ID, "ops")
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for i, it := range seedItems[c.ID] {
			if _, err := tx.Exec(ctx, `INSERT INTO inventory_items (company_id, sku, name, category, location, unit, on_hand, reserved, reorder_point, reorder_qty)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				c.ID, it.sku, it.name, it.category, seedLocations[i%len(seedLocations)], it.unit,
				it.onHand, it.onHand/20, it.rp, it.qty); err != nil {
				return err
			}
		}

		// Thirty days of delivered history for analytics.
		for day := 30; day >= 1; day-- {
			for _, mode := range realm.Modes {
				n := realm.TargetActive(c.ID, mode, 2) / 2
				n = max(0, n+r.IntN(3)-1)
				for range n {
					arrive := dayStart(now).AddDate(0, 0, -day).Add(time.Duration(6+r.IntN(14)) * time.Hour)
					nb := seedBooking(c.ID, mode, r, arrive)
					nb.Delivered = true
					if _, err := createShipment(ctx, tx, c.ID, nb); err != nil {
						return err
					}
				}
			}
		}

		// Shipments in motion right now.
		for _, mode := range realm.Modes {
			target := realm.TargetActive(c.ID, mode, realm.Level(seedXP[c.ID][mode]))
			for i := range target {
				lo, hi := realm.TransitRange(mode)
				transit := lo + time.Duration(r.Int64N(int64(hi-lo)))
				var departs time.Time
				switch {
				case i%5 == 4: // still booked
					departs = now.Add(time.Duration(10+r.IntN(180)) * time.Minute)
				default:
					departs = now.Add(-time.Duration(float64(transit) * (0.05 + r.Float64()*0.8)))
				}
				nb := bookingWithTransit(c.ID, mode, r, departs, transit)
				if i == 1 { // one late shipment per mode keeps the exceptions list honest
					nb.ETA = now.Add(-time.Duration(20+r.IntN(90)) * time.Minute)
					nb.ArrivesAt = now.Add(time.Duration(1+r.IntN(4)) * time.Hour)
				}
				id, err := createShipment(ctx, tx, c.ID, nb)
				if err != nil {
					return err
				}
				if departs.Before(now) {
					status := "in_transit"
					if nb.ETA.Before(now) {
						status = "delayed"
					}
					if _, err := tx.Exec(ctx, `UPDATE shipments SET status = $2, departed_at = departs_at WHERE id = $1`, id, status); err != nil {
						return err
					}
					if _, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location) VALUES ($1, $2, 'departed', $3)`,
						id, departs, nb.Origin); err != nil {
						return err
					}
					if status == "delayed" {
						if _, err := tx.Exec(ctx, `INSERT INTO shipment_events (shipment_id, at, kind, location, note) VALUES ($1, $2, 'delayed', $3, 'Carrier reported a delay; revised ETA pending')`,
							id, nb.ETA, "En route to "+nb.Destination); err != nil {
							return err
						}
					}
				}
			}
		}

		// Time-off requests in each state.
		rows, _ := tx.Query(ctx, `SELECT id FROM users WHERE company_id = $1 AND role = 'employee' ORDER BY id`, c.ID)
		emps, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return err
		}
		var manager int64
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1 AND role = 'manager' LIMIT 1`, c.ID).Scan(&manager); err != nil {
			return err
		}
		reqs := []struct {
			who          int
			kind, reason string
			from, days   int
			status       string
		}{
			{0, "vacation", "Family wedding in Porto", 12, 3, "pending"},
			{2, "personal", "Moving house", 5, 1, "pending"},
			{3, "vacation", "Hiking trip", 20, 5, "approved"},
			{4, "sick", "Dentist recovery", -2, 1, "approved"},
			{5, "vacation", "Long weekend", 9, 2, "denied"},
		}
		for _, q := range reqs {
			if q.who >= len(emps) {
				continue
			}
			start := dayStart(now).AddDate(0, 0, q.from)
			var decidedBy *int64
			var decidedAt *time.Time
			note := ""
			if q.status != "pending" {
				decidedBy, decidedAt = &manager, &now
				if q.status == "denied" {
					note = "Peak week — can we look at the following weekend?"
				}
			}
			if _, err := tx.Exec(ctx, `INSERT INTO time_off_requests (company_id, user_id, kind, starts_on, ends_on, reason, status, decided_by, decided_at, note, created_at)
				VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)`,
				c.ID, emps[q.who], q.kind, start.Format(time.DateOnly), start.AddDate(0, 0, q.days-1).Format(time.DateOnly),
				q.reason, q.status, decidedBy, decidedAt, note, now.Add(-time.Duration(2+r.IntN(40))*time.Hour)); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, body, link)
			SELECT id, 'info', 'Welcome to Relay', 'Your logistics realm is ready. Explore the map to see your fleet.', '/realm'
			FROM users WHERE company_id = $1`, c.ID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO notifications (user_id, kind, title, body, link)
			SELECT id, 'request', 'Time-off requests waiting', 'Two requests need a decision.', '/requests'
			FROM users WHERE company_id = $1 AND role = 'manager'`, c.ID)
		return err
	})
	if err != nil {
		return err
	}
	for mode, xp := range seedXP[c.ID] {
		if err := s.SetProgress(ctx, c.ID, mode, xp); err != nil {
			return err
		}
	}
	return s.UnlockDeliveryMilestones(ctx, c.ID)
}

// seedBooking builds a historical shipment that arrived at arrive.
func seedBooking(company, mode string, r *rand.Rand, arrive time.Time) NewShipment {
	lo, hi := realm.TransitRange(mode)
	transit := lo + time.Duration(r.Int64N(int64(hi-lo)))
	n := bookingWithTransit(company, mode, r, arrive.Add(-transit), transit)
	n.ArrivesAt = arrive
	// Carriers differ: the first carrier in each list is the most reliable.
	late := 6
	for i, name := range realm.Carriers[mode] {
		if name == n.Carrier {
			late = 4 + i*3
		}
	}
	if r.IntN(100) < late {
		n.ETA = arrive.Add(-time.Duration(30+r.IntN(300)) * time.Minute)
	} else {
		n.ETA = arrive.Add(time.Duration(10+r.IntN(240)) * time.Minute)
	}
	return n
}

func bookingWithTransit(company, mode string, r *rand.Rand, departs time.Time, transit time.Duration) NewShipment {
	places := realm.Places[company]
	hub := places["hub"][0]
	other := places[mode][r.IntN(len(places[mode]))]
	origin, dest := hub, other
	if r.IntN(2) == 0 {
		origin, dest = other, hub
	}
	weight := map[string]int{"sea": 18000, "road": 6000, "rail": 22000, "air": 900}[mode]
	priority := "standard"
	if mode == "air" || r.IntN(6) == 0 {
		priority = "express"
	}
	return NewShipment{
		Mode: mode, Customer: realm.Customers[r.IntN(len(realm.Customers))],
		Carrier: realm.Carriers[mode][r.IntN(len(realm.Carriers[mode]))],
		Origin:  origin, Destination: dest,
		WeightKg: weight/4 + r.IntN(weight), Pieces: 1 + r.IntN(40), Priority: priority,
		BookedAt:  departs.Add(-time.Duration(2+r.IntN(48)) * time.Hour),
		DepartsAt: departs, ETA: departs.Add(transit),
		ArrivesAt: departs.Add(time.Duration(float64(transit) * (0.85 + r.Float64()*0.13))),
	}
}
