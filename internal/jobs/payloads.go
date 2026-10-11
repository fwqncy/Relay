package jobs

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"

	"relay/relay"
)

var (
	drivers   = []string{"D. Alvarez", "K. Mensah", "R. Novak", "J. Whitfield", "S. Iqbal", "M. Rossi", "T. Nguyen", "L. Fischer"}
	consignee = []string{"Greenleaf Grocers", "Atlas Hardware", "Bramble & Co", "Northside Pharmacy", "Copperline Electronics", "Hollow Oak Furniture"}
	cities    = map[string][]string{
		"harborline": {"Savannah", "Pooler", "Richmond Hill", "Hinesville", "Statesboro"},
		"meridian":   {"Rotterdam", "Delft", "Dordrecht", "Gouda", "Schiedam"},
		"kestrel":    {"Leeds", "Bradford", "Wakefield", "Harrogate", "York"},
	}
	currency = map[string]string{"harborline": "USD", "meridian": "EUR", "kestrel": "GBP"}
)

func stops(company string, r *rand.Rand, n int) (point, []point) {
	hub, ok := hubs[company]
	if !ok {
		hub = hubs["harborline"]
	}
	out := make([]point, n)
	for i := range out {
		out[i] = point{hub[0] + (r.Float64()-0.5)*0.5, hub[1] + (r.Float64()-0.5)*0.7}
	}
	return hub, out
}

func pick[T any](r *rand.Rand, s []T) T { return s[r.IntN(len(s))] }

// Payload builds a realistic payload for a job type. ref, when set, is
// used as the route, tracking or invoice number the user typed.
func Payload(company, typ, ref string, r *rand.Rand) json.RawMessage {
	var v any
	route := ref
	if route == "" {
		route = fmt.Sprintf("R-%04d", 1000+r.IntN(9000))
	}
	tracking := ref
	if tracking == "" {
		tracking = fmt.Sprintf("1Z%s%09d", company[:2], r.IntN(1_000_000_000))
	}
	switch typ {
	case "route.optimize":
		depot, s := stops(company, r, 12+r.IntN(24))
		v = routePayload{Route: route, Depot: depot, Stops: s}
	case "eta.recompute":
		depot, s := stops(company, r, 6+r.IntN(14))
		v = routePayload{Route: route, Depot: depot, Stops: s, SpeedKph: float64(30 + r.IntN(25))}
	case "label.print":
		p := labelPayload{Tracking: tracking, Service: pick(r, []string{"Next day", "Economy", "Pallet"}),
			WeightKg: float64(r.IntN(300))/10 + 0.4}
		p.To.Name = pick(r, consignee)
		p.To.City = pick(r, cities[company])
		p.To.Postcode = fmt.Sprintf("%d%03d", 1+r.IntN(9), r.IntN(1000))
		v = p
	case "notify.driver":
		v = map[string]any{"driver": pick(r, drivers), "route": route, "message": "Route updated — check the app for new stop order."}
	case "pod.upload":
		v = map[string]any{"tracking": tracking, "photoKb": 48 + r.IntN(160)}
	case "invoice.sync":
		inv := ref
		if inv == "" {
			inv = fmt.Sprintf("INV-%06d", r.IntN(1_000_000))
		}
		v = map[string]any{"invoice": inv, "amount": float64(20000+r.IntN(900000)) / 100, "currency": currency[company]}
	default:
		v = map[string]any{}
	}
	b, _ := json.Marshal(v)
	return b
}

// Burst returns n jobs shaped like a dispatch wave: mostly small ETA and
// label jobs with a few heavier route optimisations.
func Burst(company string, n int, run int64, r *rand.Rand) []relay.NewJob {
	out := make([]relay.NewJob, n)
	for i := range out {
		var typ string
		switch x := r.IntN(100); {
		case x < 70:
			typ = "eta.recompute"
		case x < 85:
			typ = "label.print"
		case x < 95:
			typ = "notify.driver"
		default:
			typ = "route.optimize"
		}
		out[i] = relay.NewJob{Company: company, Type: typ, Payload: Payload(company, typ, "", r), Run: run}
	}
	return out
}

// Ambient returns a few jobs of everyday operational traffic.
func Ambient(company string, r *rand.Rand) []relay.NewJob {
	weights := []struct {
		typ string
		w   int
	}{{"eta.recompute", 40}, {"label.print", 25}, {"notify.driver", 12}, {"pod.upload", 10}, {"invoice.sync", 8}, {"route.optimize", 5}}
	n := 1 + r.IntN(4)
	out := make([]relay.NewJob, 0, n)
	for range n {
		x := r.IntN(100)
		for _, w := range weights {
			if x < w.w {
				out = append(out, relay.NewJob{Company: company, Type: w.typ, Payload: Payload(company, w.typ, "", r)})
				break
			}
			x -= w.w
		}
	}
	return out
}
