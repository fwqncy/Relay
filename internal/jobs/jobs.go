// Package jobs defines the logistics job types Relay runs and their handlers.
package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"relay/internal/store"
	"relay/relay"
)

// Kind describes a job type for the UI. Submit says who may enqueue it by
// hand: "all", "manager", or "system" for jobs only the app creates.
type Kind struct {
	Type        string `json:"type"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Submit      string `json:"submit"`
}

var Catalog = []Kind{
	{"eta.recompute", "Recompute ETAs", "Recalculates arrival times along a driver’s route.", "all"},
	{"label.print", "Print shipping label", "Renders a ZPL label for a parcel.", "all"},
	{"notify.driver", "Notify driver", "Sends a dispatch message through the SMS gateway.", "all"},
	{"pod.upload", "Upload proof of delivery", "Fingerprints and stores a delivery photo.", "all"},
	{"route.optimize", "Optimize route", "Reorders stops with nearest-neighbour and 2-opt.", "manager"},
	{"invoice.sync", "Sync freight invoice", "Pushes an invoice to the ERP. Retries on upstream errors.", "manager"},
	{"dock.confirm", "Confirm dock appointment", "Confirms a requested slot with the carrier portal.", "system"},
	{"dock.checkin", "Check in carrier", "Records a carrier’s arrival at the dock.", "system"},
	{"shift.publish", "Publish shift", "Publishes a draft shift and notifies the employee.", "system"},
}

func Lookup(typ string) (Kind, bool) {
	for _, k := range Catalog {
		if k.Type == typ {
			return k, true
		}
	}
	return Kind{}, false
}

type point [2]float64 // lat, lng

var hubs = map[string]point{
	"harborline": {32.0809, -81.0912},
	"meridian":   {51.9244, 4.4777},
	"kestrel":    {53.8008, -1.5491},
}

// Handlers returns the handler for every job type.
func Handlers(st *store.Store) map[string]relay.Handler {
	return map[string]relay.Handler{
		"route.optimize": routeOptimize,
		"eta.recompute":  etaRecompute,
		"label.print":    labelPrint,
		"notify.driver":  notifyDriver,
		"pod.upload":     podUpload,
		"invoice.sync":   invoiceSync,
		"dock.confirm":   advance(st, "requested", "confirmed", 15, 40),
		"dock.checkin":   advance(st, "confirmed", "checked_in", 5, 15),
		"shift.publish":  shiftPublish(st),
	}
}

func decode[T any](job relay.Job) (T, error) {
	var v T
	if err := json.Unmarshal(job.Payload, &v); err != nil {
		return v, fmt.Errorf("invalid payload: %w", err)
	}
	return v, nil
}

// sleep stands in for a call to an external system.
func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func jitter(lo, hi int) time.Duration {
	return time.Duration(lo+rand.IntN(hi-lo+1)) * time.Millisecond
}

// ---- routing ----

func haversine(a, b point) float64 {
	const r = 6371.0
	lat1, lat2 := a[0]*math.Pi/180, b[0]*math.Pi/180
	dlat, dlng := lat2-lat1, (b[1]-a[1])*math.Pi/180
	h := math.Sin(dlat/2)*math.Sin(dlat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dlng/2)*math.Sin(dlng/2)
	return 2 * r * math.Asin(math.Sqrt(h))
}

func tourLength(depot point, stops []point, order []int) float64 {
	d, prev := 0.0, depot
	for _, i := range order {
		d += haversine(prev, stops[i])
		prev = stops[i]
	}
	return d + haversine(prev, depot)
}

type routePayload struct {
	Route    string  `json:"route"`
	Depot    point   `json:"depot"`
	Stops    []point `json:"stops"`
	SpeedKph float64 `json:"speedKph,omitempty"`
}

func routeOptimize(ctx context.Context, job relay.Job) (any, error) {
	p, err := decode[routePayload](job)
	if err != nil {
		return nil, err
	}
	n := len(p.Stops)
	if n < 2 {
		return nil, errors.New("route needs at least two stops")
	}
	given := make([]int, n)
	for i := range given {
		given[i] = i
	}
	baseline := tourLength(p.Depot, p.Stops, given)

	// Nearest neighbour from the depot.
	order := make([]int, 0, n)
	used := make([]bool, n)
	cur := p.Depot
	for range n {
		best, bestD := -1, math.Inf(1)
		for i, s := range p.Stops {
			if d := haversine(cur, s); !used[i] && d < bestD {
				best, bestD = i, d
			}
		}
		used[best] = true
		order = append(order, best)
		cur = p.Stops[best]
	}

	// 2-opt until no segment reversal shortens the tour.
	at := func(i int) point {
		if i < 0 || i >= n {
			return p.Depot
		}
		return p.Stops[order[i]]
	}
	for improved, pass := true, 0; improved && pass < 50; pass++ {
		improved = false
		for i := 0; i < n-1; i++ {
			for k := i + 1; k < n; k++ {
				before := haversine(at(i-1), at(i)) + haversine(at(k), at(k+1))
				after := haversine(at(i-1), at(k)) + haversine(at(i), at(k+1))
				if after < before-1e-9 {
					for l, r := i, k; l < r; l, r = l+1, r-1 {
						order[l], order[r] = order[r], order[l]
					}
					improved = true
				}
			}
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	optimized := tourLength(p.Depot, p.Stops, order)
	return map[string]any{
		"route":      p.Route,
		"stops":      n,
		"baselineKm": round(baseline, 1),
		"distanceKm": round(optimized, 1),
		"savedPct":   round(100*(baseline-optimized)/baseline, 1),
		"order":      order,
	}, nil
}

func etaRecompute(_ context.Context, job relay.Job) (any, error) {
	p, err := decode[routePayload](job)
	if err != nil {
		return nil, err
	}
	speed := p.SpeedKph
	if speed <= 0 {
		speed = 38
	}
	const dwell = 4.0 // minutes per stop
	km, minutes, prev := 0.0, 0.0, p.Depot
	etas := make([]float64, len(p.Stops))
	for i, s := range p.Stops {
		leg := haversine(prev, s)
		km += leg
		minutes += leg/speed*60 + dwell
		etas[i] = round(minutes, 1)
		prev = s
	}
	return map[string]any{"route": p.Route, "stops": len(p.Stops), "distanceKm": round(km, 1),
		"durationMin": round(minutes, 0), "etaMin": etas}, nil
}

func round(v float64, places int) float64 {
	f := math.Pow(10, float64(places))
	return math.Round(v*f) / f
}

// ---- parcels ----

type labelPayload struct {
	Tracking string  `json:"tracking"`
	Service  string  `json:"service"`
	WeightKg float64 `json:"weightKg"`
	To       struct {
		Name     string `json:"name"`
		City     string `json:"city"`
		Postcode string `json:"postcode"`
	} `json:"to"`
}

func labelPrint(_ context.Context, job relay.Job) (any, error) {
	p, err := decode[labelPayload](job)
	if err != nil {
		return nil, err
	}
	if p.Tracking == "" {
		return nil, errors.New("label needs a tracking number")
	}
	var b strings.Builder
	b.WriteString("^XA^CI28^PW812^LL1218\n")
	fmt.Fprintf(&b, "^FO40,40^A0N,36,36^FD%s^FS\n", strings.ToUpper(p.Service))
	fmt.Fprintf(&b, "^FO40,110^A0N,60,60^FD%s^FS\n", p.To.Name)
	fmt.Fprintf(&b, "^FO40,190^A0N,48,48^FD%s %s^FS\n", p.To.Postcode, p.To.City)
	fmt.Fprintf(&b, "^FO40,280^A0N,32,32^FD%.1f kg^FS\n", p.WeightKg)
	fmt.Fprintf(&b, "^FO60,360^BY4^BCN,260,Y,N,N^FD%s^FS\n", p.Tracking)
	b.WriteString("^XZ\n")
	zpl := b.String()
	return map[string]any{"tracking": p.Tracking, "format": "ZPL II", "bytes": len(zpl),
		"crc32": fmt.Sprintf("%08x", crc32.ChecksumIEEE([]byte(zpl)))}, nil
}

func podUpload(_ context.Context, job relay.Job) (any, error) {
	p, err := decode[struct {
		Tracking string `json:"tracking"`
		PhotoKB  int    `json:"photoKb"`
	}](job)
	if err != nil {
		return nil, err
	}
	// Stand-in for the photo the driver app uploads: deterministic bytes
	// per tracking number, hashed the same way the real blob would be.
	h := crc32.ChecksumIEEE([]byte(p.Tracking))
	r := rand.New(rand.NewPCG(uint64(h), uint64(p.PhotoKB)))
	blob := make([]byte, p.PhotoKB*1024)
	for i := 0; i+8 <= len(blob); i += 8 {
		v := r.Uint64()
		for k := range 8 {
			blob[i+k] = byte(v >> (8 * k))
		}
	}
	sum := sha256.Sum256(blob)
	return map[string]any{"tracking": p.Tracking, "bytes": len(blob), "sha256": hex.EncodeToString(sum[:])}, nil
}

// ---- external systems (simulated) ----

func notifyDriver(ctx context.Context, job relay.Job) (any, error) {
	p, err := decode[struct {
		Driver string `json:"driver"`
		Route  string `json:"route"`
	}](job)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx, jitter(1, 3)); err != nil {
		return nil, err
	}
	return map[string]any{"channel": "sms", "driver": p.Driver, "route": p.Route,
		"messageId": fmt.Sprintf("SM%08x", rand.Uint32())}, nil
}

func invoiceSync(ctx context.Context, job relay.Job) (any, error) {
	p, err := decode[struct {
		Invoice  string  `json:"invoice"`
		Amount   float64 `json:"amount"`
		Currency string  `json:"currency"`
	}](job)
	if err != nil {
		return nil, err
	}
	d := jitter(5, 20)
	if rand.IntN(200) == 0 {
		d = 2500 * time.Millisecond // the ERP occasionally hangs; peers steal this worker's backlog
	}
	if err := sleep(ctx, d); err != nil {
		return nil, err
	}
	if rand.IntN(100) < 4 {
		return nil, errors.New("erp: 503 upstream unavailable")
	}
	return map[string]any{"invoice": p.Invoice, "erpId": fmt.Sprintf("ERP-%06d", rand.IntN(1_000_000)),
		"amount": p.Amount, "currency": p.Currency}, nil
}

// ---- domain jobs ----

func advance(st *store.Store, from, to string, lo, hi int) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[struct {
			AppointmentID int64 `json:"appointmentId"`
		}](job)
		if err != nil {
			return nil, err
		}
		if err := sleep(ctx, jitter(lo, hi)); err != nil {
			return nil, err
		}
		ok, err := st.AdvanceAppointment(ctx, job.Company, p.AppointmentID, from, to)
		if err != nil {
			return nil, err
		}
		if !ok {
			return map[string]any{"appointmentId": p.AppointmentID, "skipped": true,
				"reason": "appointment was not " + strings.ReplaceAll(from, "_", " ")}, nil
		}
		return map[string]any{"appointmentId": p.AppointmentID, "status": to}, nil
	}
}

func shiftPublish(st *store.Store) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[struct {
			ShiftID int64 `json:"shiftId"`
		}](job)
		if err != nil {
			return nil, err
		}
		name, ok, err := st.PublishShift(ctx, job.Company, p.ShiftID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return map[string]any{"shiftId": p.ShiftID, "skipped": true, "reason": "already published"}, nil
		}
		if err := sleep(ctx, jitter(2, 6)); err != nil {
			return nil, err
		}
		return map[string]any{"shiftId": p.ShiftID, "notified": name}, nil
	}
}
