package jobs

import (
	"context"
	"fmt"
	"math/rand/v2"
	"time"

	"relay/internal/realm"
	"relay/internal/store"
	"relay/relay"
)

// Booking builds a realistic new shipment for a mode. The hub is one end
// of the lane; roughly one in ten shipments will arrive late.
func Booking(company, mode string, r *rand.Rand, departs time.Time) store.NewShipment {
	places := realm.Places[company]
	if places == nil {
		places = realm.Places["harborline"]
	}
	hub := places["hub"][0]
	other := pick(r, places[mode])
	origin, dest := hub, other
	if r.IntN(2) == 0 {
		origin, dest = other, hub
	}
	lo, hi := realm.TransitRange(mode)
	transit := lo + time.Duration(r.Int64N(int64(hi-lo)))
	eta := departs.Add(transit)
	arrives := departs.Add(time.Duration(float64(transit) * (0.82 + r.Float64()*0.16)))
	if r.IntN(10) == 0 {
		arrives = eta.Add(time.Duration(float64(transit) * (0.08 + r.Float64()*0.3)))
	}
	weight := map[string]int{"sea": 18000, "road": 6000, "rail": 22000, "air": 900}[mode]
	priority := "standard"
	if mode == "air" || r.IntN(6) == 0 {
		priority = "express"
	}
	return store.NewShipment{
		Mode: mode, Customer: pick(r, realm.Customers), Carrier: pick(r, realm.Carriers[mode]),
		Origin: origin, Destination: dest,
		WeightKg: weight/4 + r.IntN(weight), Pieces: 1 + r.IntN(40), Priority: priority,
		BookedAt:  departs.Add(-time.Duration(30+r.IntN(240)) * time.Minute),
		DepartsAt: departs, ETA: eta, ArrivesAt: arrives,
	}
}

type shipmentRef struct {
	ShipmentID int64 `json:"shipmentId"`
}

func shipmentBook(st *store.Store) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[shipmentRef](job)
		if err != nil {
			return nil, err
		}
		sh, err := st.Shipment(ctx, job.Company, p.ShipmentID)
		if err != nil {
			return nil, err
		}
		// Stand-in for the carrier's booking API.
		if err := sleep(ctx, jitter(8, 30)); err != nil {
			return nil, err
		}
		if err := st.AddShipmentEvent(ctx, sh.ID, "confirmed", sh.Origin, "Booking confirmed by "+sh.Carrier); err != nil {
			return nil, err
		}
		return map[string]any{"reference": sh.Reference, "carrier": sh.Carrier, "eta": sh.ETA}, nil
	}
}

func trackingSync(st *store.Store) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[shipmentRef](job)
		if err != nil {
			return nil, err
		}
		res, err := st.SyncShipment(ctx, job.Company, p.ShipmentID, time.Now())
		if err != nil {
			return nil, err
		}
		link := fmt.Sprintf("/shipments/%d", p.ShipmentID)
		if res.Delayed {
			_ = st.Notify(ctx, store.NotifyTarget{Company: job.Company, Role: "manager"}, "delay",
				res.Reference+" is delayed", "The carrier missed the promised ETA.", link)
		}
		if res.Delivered && res.LevelAfter > res.LevelBefore {
			tier := realm.Tiers[res.Mode][res.LevelAfter-1]
			_ = st.Notify(ctx, store.NotifyTarget{Company: job.Company}, "level",
				fmt.Sprintf("%s reached level %d", realm.ModeName(res.Mode), res.LevelAfter),
				fmt.Sprintf("%s unlocked — %s", tier.Vehicle, tier.Description), "/realm")
		}
		for _, m := range res.Unlocked {
			if m.Mode != "" {
				continue // covered by the level notification
			}
			_ = st.Notify(ctx, store.NotifyTarget{Company: job.Company}, "milestone", "Milestone: "+m.Title, m.Description, "/realm")
		}
		return res, nil
	}
}

func inventoryPick(st *store.Store) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[struct {
			ItemID int64 `json:"itemId"`
			Qty    int   `json:"qty"`
		}](job)
		if err != nil {
			return nil, err
		}
		it, crossed, err := st.AdjustStock(ctx, job.Company, p.ItemID, -p.Qty, true)
		if err != nil {
			return nil, err
		}
		if crossed {
			_ = st.Notify(ctx, store.NotifyTarget{Company: job.Company, Role: "manager"}, "stock",
				it.Name+" is low on stock", fmt.Sprintf("%d %s available, reorder point %d.", it.Available, it.Unit, it.ReorderPoint),
				"/inventory?low=1")
		}
		return map[string]any{"sku": it.SKU, "picked": p.Qty, "available": it.Available}, nil
	}
}

func inventoryReorder(st *store.Store) relay.Handler {
	return func(ctx context.Context, job relay.Job) (any, error) {
		p, err := decode[struct {
			ItemID int64 `json:"itemId"`
		}](job)
		if err != nil {
			return nil, err
		}
		it, err := st.Item(ctx, job.Company, p.ItemID)
		if err != nil {
			return nil, err
		}
		if it.Inbound > 0 {
			return map[string]any{"sku": it.SKU, "skipped": true, "reason": "a replenishment is already on the way"}, nil
		}
		r := rand.New(rand.NewPCG(uint64(job.ID), uint64(p.ItemID)))
		nb := Booking(job.Company, "road", r, time.Now().Add(time.Duration(10+r.IntN(50))*time.Minute))
		hub := realm.Places[job.Company]["hub"][0]
		nb.Destination, nb.Customer = hub, "Replenishment · "+it.SKU
		if nb.Origin == hub {
			nb.Origin = pick(r, realm.Places[job.Company]["road"])
		}
		qty := it.ReorderQty
		nb.ItemID, nb.Quantity = &it.ID, &qty
		sh, err := st.CreateShipment(ctx, job.Company, nb)
		if err != nil {
			return nil, err
		}
		_ = st.Notify(ctx, store.NotifyTarget{Company: job.Company, Role: "manager"}, "stock",
			"Reorder placed for "+it.Name, fmt.Sprintf("%d %s inbound on %s.", qty, it.Unit, sh.Reference), fmt.Sprintf("/shipments/%d", sh.ID))
		return map[string]any{"sku": it.SKU, "quantity": qty, "shipment": sh.Reference}, nil
	}
}
