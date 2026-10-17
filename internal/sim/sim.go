// Package sim keeps each company's logistics network moving: it books new
// shipments up to each mode's target, syncs tracking through the job
// runtime, and picks stock so inventory drains and gets reordered.
package sim

import (
	"context"
	"encoding/json"
	"log/slog"
	"math/rand/v2"
	"time"

	"relay/internal/jobs"
	"relay/internal/realm"
	"relay/internal/store"
	"relay/relay"
)

type Sim struct {
	st        *store.Store
	rt        *relay.Runtime
	log       *slog.Logger
	companies []string
	r         *rand.Rand
}

func New(st *store.Store, rt *relay.Runtime, log *slog.Logger, companies []string) *Sim {
	return &Sim{st: st, rt: rt, log: log, companies: companies,
		r: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 99))}
}

func (s *Sim) Run(ctx context.Context) {
	book := time.NewTicker(6 * time.Second)
	sync := time.NewTicker(12 * time.Second)
	pick := time.NewTicker(30 * time.Second)
	defer book.Stop()
	defer sync.Stop()
	defer pick.Stop()
	s.syncAll(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-book.C:
			for _, c := range s.companies {
				s.book(ctx, c)
			}
		case <-sync.C:
			s.syncAll(ctx)
		case <-pick.C:
			for _, c := range s.companies {
				s.pick(ctx, c)
			}
		}
	}
}

func payload(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// book tops each mode up towards its target, one booking per tick.
func (s *Sim) book(ctx context.Context, company string) {
	progress, err := s.st.RealmProgress(ctx, company)
	if err != nil {
		return
	}
	active, err := s.st.ActiveShipments(ctx, company)
	if err != nil {
		return
	}
	counts := map[string]int{}
	for _, a := range active {
		counts[a.Mode]++
	}
	var batch []relay.NewJob
	for _, mode := range realm.Modes {
		if counts[mode] >= realm.TargetActive(company, mode, progress[mode].Level) {
			continue
		}
		nb := jobs.Booking(company, mode, s.r, time.Now().Add(time.Duration(5+s.r.IntN(90))*time.Minute))
		sh, err := s.st.CreateShipment(ctx, company, nb)
		if err != nil {
			s.log.Warn("sim booking failed", "company", company, "err", err)
			continue
		}
		batch = append(batch, relay.NewJob{Company: company, Type: "shipment.book", Payload: payload(map[string]int64{"shipmentId": sh.ID})})
	}
	s.enqueue(ctx, batch)
}

// SyncCompany enqueues a tracking sync for every active shipment.
func (s *Sim) SyncCompany(ctx context.Context, company string) int {
	active, err := s.st.ActiveShipments(ctx, company)
	if err != nil {
		return 0
	}
	batch := make([]relay.NewJob, len(active))
	for i, a := range active {
		batch[i] = relay.NewJob{Company: company, Type: "tracking.sync", Payload: payload(map[string]int64{"shipmentId": a.ID})}
	}
	s.enqueue(ctx, batch)
	return len(batch)
}

func (s *Sim) syncAll(ctx context.Context) {
	for _, c := range s.companies {
		s.SyncCompany(ctx, c)
	}
}

func (s *Sim) pick(ctx context.Context, company string) {
	items, err := s.st.Inventory(ctx, store.ItemFilter{Company: company})
	if err != nil || len(items) == 0 {
		return
	}
	var batch []relay.NewJob
	for range 1 + s.r.IntN(2) {
		it := items[s.r.IntN(len(items))]
		// An order takes a small slice of a typical replenishment.
		qty := 1 + s.r.IntN(max(1, it.ReorderQty/30))
		batch = append(batch, relay.NewJob{Company: company, Type: "inventory.pick",
			Payload: payload(map[string]any{"itemId": it.ID, "qty": qty})})
	}
	// Anything fully stocked out gets an automatic replenishment.
	if out, err := s.st.StockedOut(ctx, company); err == nil {
		for _, id := range out {
			batch = append(batch, relay.NewJob{Company: company, Type: "inventory.reorder", Payload: payload(map[string]int64{"itemId": id})})
		}
	}
	s.enqueue(ctx, batch)
}

func (s *Sim) enqueue(ctx context.Context, batch []relay.NewJob) {
	if len(batch) == 0 {
		return
	}
	if _, err := s.rt.Enqueue(ctx, batch); err != nil && ctx.Err() == nil {
		s.log.Warn("sim enqueue failed", "err", err)
	}
}
