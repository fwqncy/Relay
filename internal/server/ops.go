package server

import (
	"encoding/csv"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"relay/internal/jobs"
	"relay/internal/realm"
	"relay/internal/store"
)

func (s *Server) opsRoutes() {
	s.mux.HandleFunc("PUT /api/settings", s.auth(s.saveSettings))

	s.mux.HandleFunc("GET /api/shipments", s.auth(s.listShipments))
	s.mux.HandleFunc("GET /api/shipments/{id}", s.auth(s.getShipment))
	s.mux.HandleFunc("POST /api/shipments", s.manager(s.createShipment))
	s.mux.HandleFunc("POST /api/shipments/{id}/cancel", s.manager(s.cancelShipment))
	s.mux.HandleFunc("POST /api/shipments/{id}/sync", s.auth(s.syncShipment))

	s.mux.HandleFunc("GET /api/realm", s.auth(s.realm))
	s.mux.HandleFunc("POST /api/realm/advance", s.manager(s.advanceRealm))

	s.mux.HandleFunc("GET /api/notifications", s.auth(s.notifications))
	s.mux.HandleFunc("POST /api/notifications/read", s.auth(s.readNotifications))
	s.mux.HandleFunc("GET /api/activity", s.manager(s.activity))

	s.mux.HandleFunc("GET /api/requests", s.auth(s.listRequests))
	s.mux.HandleFunc("POST /api/requests", s.auth(s.createRequest))
	s.mux.HandleFunc("POST /api/requests/{id}/decide", s.manager(s.decideRequest))
	s.mux.HandleFunc("POST /api/requests/{id}/withdraw", s.auth(s.withdrawRequest))

	s.mux.HandleFunc("GET /api/inventory", s.auth(s.inventory))
	s.mux.HandleFunc("POST /api/inventory/{id}/adjust", s.auth(s.adjustInventory))
	s.mux.HandleFunc("POST /api/inventory/{id}/reorder", s.manager(s.reorderItem))

	s.mux.HandleFunc("GET /api/analytics", s.manager(s.analytics))
	s.mux.HandleFunc("GET /api/search", s.auth(s.search))
	s.mux.HandleFunc("GET /api/export/{kind}", s.auth(s.export))
}

func (s *Server) audit(r *http.Request, action, target, detail string) {
	u := userFrom(r)
	if err := s.st.Audit(r.Context(), u.CompanyID, &u.ID, action, target, detail); err != nil {
		s.log.Warn("audit write failed", "action", action, "err", err)
	}
}

// ---- settings ----

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var in store.Settings
	if !readJSON(w, r, &in) {
		return
	}
	switch {
	case in.Mode != "system" && in.Mode != "light" && in.Mode != "dark":
		fieldError(w, "mode", "Choose system, light or dark.")
	case !strings.Contains(" moss burgundy navy company custom ", " "+in.Scheme+" "):
		fieldError(w, "scheme", "Choose one of the colour schemes.")
	case !hexColor.MatchString(in.CustomColor):
		fieldError(w, "customColor", "Use a hex colour like #6f8f5e.")
	default:
		in.CustomColor = strings.ToLower(in.CustomColor)
		if err := s.st.SaveSettings(r.Context(), userFrom(r).ID, in); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, in)
	}
}

// ---- shipments ----

func (s *Server) shipmentFilter(r *http.Request) store.ShipmentFilter {
	q := r.URL.Query()
	f := store.ShipmentFilter{Company: userFrom(r).CompanyID, Query: strings.TrimSpace(q.Get("q")), Limit: 50}
	if realm.ValidMode(q.Get("mode")) {
		f.Mode = q.Get("mode")
	}
	switch st := q.Get("status"); st {
	case "active", "booked", "in_transit", "delayed", "delivered", "cancelled":
		f.Status = st
	}
	f.Before, _ = strconv.ParseInt(q.Get("before"), 10, 64)
	return f
}

func (s *Server) listShipments(w http.ResponseWriter, r *http.Request) {
	f := s.shipmentFilter(r)
	list, err := s.st.ListShipments(r.Context(), f)
	if err != nil {
		s.fail(w, err)
		return
	}
	out := map[string]any{"shipments": list}
	if f.Before == 0 {
		counts, err := s.st.ShipmentCounts(r.Context(), f)
		if err != nil {
			s.fail(w, err)
			return
		}
		out["counts"] = counts
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getShipment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	sh, err := s.st.Shipment(r.Context(), userFrom(r).CompanyID, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	events, err := s.st.ShipmentEvents(r.Context(), id)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shipment": sh, "events": events})
}

func (s *Server) createShipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode        string
		Customer    string
		Carrier     string
		Origin      string
		Destination string
		WeightKg    int
		Pieces      int
		Priority    string
		DepartsAt   time.Time
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Customer, in.Origin, in.Destination, in.Carrier = clean(in.Customer), clean(in.Origin), clean(in.Destination), clean(in.Carrier)
	now := time.Now()
	switch {
	case !realm.ValidMode(in.Mode):
		fieldError(w, "mode", "Choose sea, road, rail or air.")
	case in.Customer == "" || utf8.RuneCountInString(in.Customer) > 60:
		fieldError(w, "customer", "Enter the customer (up to 60 characters).")
	case in.Origin == "" || utf8.RuneCountInString(in.Origin) > 60:
		fieldError(w, "origin", "Enter where the shipment starts.")
	case in.Destination == "" || utf8.RuneCountInString(in.Destination) > 60:
		fieldError(w, "destination", "Enter where it’s going.")
	case strings.EqualFold(in.Origin, in.Destination):
		fieldError(w, "destination", "Origin and destination must differ.")
	case in.WeightKg < 1 || in.WeightKg > 500_000:
		fieldError(w, "weightKg", "Weight must be between 1 and 500,000 kg.")
	case in.Pieces < 1 || in.Pieces > 10_000:
		fieldError(w, "pieces", "Pieces must be between 1 and 10,000.")
	case in.Priority != "standard" && in.Priority != "express":
		fieldError(w, "priority", "Choose standard or express.")
	case in.DepartsAt.Before(now.Add(-time.Hour)) || in.DepartsAt.After(now.AddDate(0, 0, 60)):
		fieldError(w, "departsAt", "Departure must be within the next 60 days.")
	default:
		u := userFrom(r)
		nb := jobs.Booking(u.CompanyID, in.Mode, rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())), in.DepartsAt)
		nb.Customer, nb.Origin, nb.Destination = in.Customer, in.Origin, in.Destination
		nb.WeightKg, nb.Pieces, nb.Priority, nb.BookedAt, nb.CreatedBy = in.WeightKg, in.Pieces, in.Priority, now, &u.ID
		if in.Carrier != "" {
			nb.Carrier = in.Carrier
		}
		sh, err := s.st.CreateShipment(r.Context(), u.CompanyID, nb)
		if err != nil {
			s.fail(w, err)
			return
		}
		jobID, err := s.enqueueOne(r, "shipment.book", mustJSON(map[string]int64{"shipmentId": sh.ID}))
		if err != nil {
			s.fail(w, err)
			return
		}
		s.audit(r, "shipment.create", sh.Reference, fmt.Sprintf("%s → %s", sh.Origin, sh.Destination))
		writeJSON(w, http.StatusCreated, map[string]any{"shipment": sh, "jobId": jobID})
	}
}

func (s *Server) cancelShipment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	sh, err := s.st.CancelShipment(r.Context(), userFrom(r).CompanyID, id)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "Only booked shipments can be cancelled — this one has departed or was already cancelled.")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	s.audit(r, "shipment.cancel", sh.Reference, "")
	writeJSON(w, http.StatusOK, map[string]any{"shipment": sh})
}

func (s *Server) syncShipment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := s.st.Shipment(r.Context(), userFrom(r).CompanyID, id); err != nil {
		s.fail(w, err)
		return
	}
	jobID, err := s.enqueueOne(r, "tracking.sync", mustJSON(map[string]int64{"shipmentId": id}))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID})
}

// ---- realm ----

type realmVehicle struct {
	ID          int64     `json:"id"`
	Reference   string    `json:"reference"`
	Status      string    `json:"status"`
	Progress    float64   `json:"progress"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	Carrier     string    `json:"carrier"`
	Customer    string    `json:"customer"`
	ETA         time.Time `json:"eta"`
}

const maxVehicles = 14

func (s *Server) realm(w http.ResponseWriter, r *http.Request) {
	company := userFrom(r).CompanyID
	progress, err := s.st.RealmProgress(r.Context(), company)
	if err != nil {
		s.fail(w, err)
		return
	}
	active, counts, err := s.st.ActiveByMode(r.Context(), company)
	if err != nil {
		s.fail(w, err)
		return
	}
	town, err := s.st.RealmCounts(r.Context(), company)
	if err != nil {
		s.fail(w, err)
		return
	}
	unlocked, err := s.st.Milestones(r.Context(), company)
	if err != nil {
		s.fail(w, err)
		return
	}
	var modes []map[string]any
	for _, m := range realm.Modes {
		p := progress[m]
		var vehicles []realmVehicle
		for _, sh := range active[m] {
			if sh.Status == "booked" || len(vehicles) >= maxVehicles {
				continue
			}
			vehicles = append(vehicles, realmVehicle{sh.ID, sh.Reference, sh.Status, sh.Progress, sh.Origin, sh.Destination, sh.Carrier, sh.Customer, sh.ETA})
		}
		if vehicles == nil {
			vehicles = []realmVehicle{}
		}
		entry := map[string]any{
			"mode": m, "name": realm.ModeName(m), "xp": p.XP, "level": p.Level,
			"prevAt": realm.Thresholds[p.Level-1], "nextAt": realm.NextAt(p.Level),
			"tier": realm.Tiers[m][p.Level-1], "tiers": realm.Tiers[m],
			"active": counts[m], "target": realm.TargetActive(company, m, p.Level), "vehicles": vehicles,
		}
		modes = append(modes, entry)
	}
	var milestones []map[string]any
	for _, m := range realm.AllMilestones() {
		e := map[string]any{"key": m.Key, "mode": m.Mode, "title": m.Title, "description": m.Description, "unlockedAt": nil}
		if t, ok := unlocked[m.Key]; ok {
			e["unlockedAt"] = t
		}
		milestones = append(milestones, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"modes": modes, "town": town, "milestones": milestones})
}

func (s *Server) advanceRealm(w http.ResponseWriter, r *http.Request) {
	var in struct{ Hours int }
	if !readJSON(w, r, &in) {
		return
	}
	if in.Hours < 1 || in.Hours > 48 {
		fieldError(w, "hours", "Advance between 1 and 48 hours.")
		return
	}
	u := userFrom(r)
	n, err := s.st.AdvanceClock(r.Context(), u.CompanyID, time.Duration(in.Hours)*time.Hour)
	if err != nil {
		s.fail(w, err)
		return
	}
	queued := s.sim.SyncCompany(r.Context(), u.CompanyID)
	s.audit(r, "realm.advance", fmt.Sprintf("%d hours", in.Hours), fmt.Sprintf("%d shipments", n))
	writeJSON(w, http.StatusAccepted, map[string]any{"shipments": n, "jobs": queued})
}

// ---- notifications & activity ----

func (s *Server) notifications(w http.ResponseWriter, r *http.Request) {
	list, unread, err := s.st.Notifications(r.Context(), userFrom(r).ID, 40)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": list, "unread": unread})
}

func (s *Server) readNotifications(w http.ResponseWriter, r *http.Request) {
	var in struct{ IDs []int64 }
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.st.MarkRead(r.Context(), userFrom(r).ID, in.IDs); err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	list, err := s.st.Activity(r.Context(), userFrom(r).CompanyID, r.URL.Query().Get("action"), before, 50)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": list})
}

// ---- time-off requests ----

func (s *Server) listRequests(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	f := store.TimeOffFilter{Company: u.CompanyID}
	if !u.IsManager() || r.URL.Query().Get("mine") == "1" {
		f.UserID = u.ID
	}
	switch st := r.URL.Query().Get("status"); st {
	case "pending", "approved", "denied", "withdrawn":
		f.Status = st
	}
	list, err := s.st.TimeOff(r.Context(), f)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": list})
}

func (s *Server) createRequest(w http.ResponseWriter, r *http.Request) {
	var in store.NewTimeOff
	if !readJSON(w, r, &in) {
		return
	}
	in.Reason = clean(in.Reason)
	start, err1 := time.Parse(time.DateOnly, in.StartsOn)
	end, err2 := time.Parse(time.DateOnly, in.EndsOn)
	today := time.Now().Truncate(24 * time.Hour)
	switch {
	case in.Kind != "vacation" && in.Kind != "sick" && in.Kind != "personal":
		fieldError(w, "kind", "Choose vacation, sick or personal.")
	case err1 != nil:
		fieldError(w, "startsOn", "Choose a start date.")
	case err2 != nil:
		fieldError(w, "endsOn", "Choose an end date.")
	case end.Before(start):
		fieldError(w, "endsOn", "The last day can’t be before the first.")
	case start.Before(today.AddDate(0, 0, -14)):
		fieldError(w, "startsOn", "Requests can go back at most two weeks.")
	case end.Sub(start) > 30*24*time.Hour:
		fieldError(w, "endsOn", "Keep a single request to 31 days or fewer.")
	case utf8.RuneCountInString(in.Reason) > 200:
		fieldError(w, "reason", "Keep the reason under 200 characters.")
	default:
		u := userFrom(r)
		id, err := s.st.CreateTimeOff(r.Context(), u.CompanyID, u.ID, in)
		if errors.Is(err, store.ErrConflict) {
			fieldError(w, "startsOn", "You already have a request covering some of these days.")
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		days := int(end.Sub(start).Hours()/24) + 1
		_ = s.st.Notify(r.Context(), store.NotifyTarget{Company: u.CompanyID, Role: "manager"}, "request",
			u.Name+" requested time off", fmt.Sprintf("%s · %d day%s from %s", in.Kind, days, plural(days), start.Format("2 Jan")), "/requests")
		s.audit(r, "request.create", fmt.Sprintf("#%d", id), in.Kind)
		writeJSON(w, http.StatusCreated, map[string]any{"id": id})
	}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func (s *Server) decideRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct{ Decision, Note string }
	if !readJSON(w, r, &in) {
		return
	}
	in.Note = clean(in.Note)
	if in.Decision != "approved" && in.Decision != "denied" {
		fieldError(w, "decision", "Approve or deny the request.")
		return
	}
	if utf8.RuneCountInString(in.Note) > 200 {
		fieldError(w, "note", "Keep the note under 200 characters.")
		return
	}
	u := userFrom(r)
	t, err := s.st.DecideTimeOff(r.Context(), u.CompanyID, id, u.ID, in.Decision, in.Note)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "This request was already decided or withdrawn, or it’s your own — another manager has to decide it.")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	body := fmt.Sprintf("%s to %s", t.StartsOn.Format("2 Jan"), t.EndsOn.Format("2 Jan"))
	if in.Note != "" {
		body += " · “" + in.Note + "”"
	}
	_ = s.st.Notify(r.Context(), store.NotifyTarget{UserIDs: []int64{t.UserID}}, "request",
		"Time off "+in.Decision, body, "/requests")
	s.audit(r, map[string]string{"approved": "request.approve", "denied": "request.deny"}[in.Decision], t.Name, body)
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) withdrawRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	if err := s.st.WithdrawTimeOff(r.Context(), u.CompanyID, id, u.ID); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "Only your own pending requests can be withdrawn.")
			return
		}
		s.fail(w, err)
		return
	}
	s.audit(r, "request.withdraw", fmt.Sprintf("#%d", id), "")
	w.WriteHeader(http.StatusNoContent)
}

// ---- inventory ----

func (s *Server) inventory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	company := userFrom(r).CompanyID
	items, err := s.st.Inventory(r.Context(), store.ItemFilter{
		Company: company, Query: strings.TrimSpace(q.Get("q")), Category: q.Get("category"), Low: q.Get("low") == "1",
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	cats, err := s.st.Categories(r.Context(), company)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "categories": cats})
}

func (s *Server) adjustInventory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Delta  int
		Reason string
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Reason = clean(in.Reason)
	switch {
	case in.Delta == 0 || in.Delta < -100_000 || in.Delta > 100_000:
		fieldError(w, "delta", "Enter a non-zero change up to ±100,000.")
		return
	case in.Reason == "" || utf8.RuneCountInString(in.Reason) > 80:
		fieldError(w, "reason", "Say why the count changed (up to 80 characters).")
		return
	}
	u := userFrom(r)
	it, crossed, err := s.st.AdjustStock(r.Context(), u.CompanyID, id, in.Delta, false)
	if errors.Is(err, store.ErrConflict) {
		fieldError(w, "delta", "That would take on-hand stock below zero.")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	if crossed {
		_ = s.st.Notify(r.Context(), store.NotifyTarget{Company: u.CompanyID, Role: "manager"}, "stock",
			it.Name+" is low on stock", fmt.Sprintf("%d %s available, reorder point %d.", it.Available, it.Unit, it.ReorderPoint), "/inventory?low=1")
	}
	s.audit(r, "inventory.adjust", it.SKU, fmt.Sprintf("%+d · %s", in.Delta, in.Reason))
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) reorderItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	it, err := s.st.Item(r.Context(), u.CompanyID, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	if it.Inbound > 0 {
		writeError(w, http.StatusConflict, fmt.Sprintf("A replenishment of %d %s is already on the way.", it.Inbound, it.Unit))
		return
	}
	jobID, err := s.enqueueOne(r, "inventory.reorder", mustJSON(map[string]int64{"itemId": id}))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.audit(r, "inventory.reorder", it.SKU, fmt.Sprintf("%d %s", it.ReorderQty, it.Unit))
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID})
}

// ---- analytics & search ----

func (s *Server) analytics(w http.ResponseWriter, r *http.Request) {
	days := 14
	switch r.URL.Query().Get("days") {
	case "7":
		days = 7
	case "30":
		days = 30
	}
	tz := r.URL.Query().Get("tz")
	if _, err := time.LoadLocation(tz); err != nil || tz == "" || tz == "Local" {
		tz = "UTC"
	}
	a, err := s.st.Analytics(r.Context(), userFrom(r).CompanyID, days, tz)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) < 2 {
		writeJSON(w, http.StatusOK, map[string]any{"results": []store.SearchHit{}})
		return
	}
	u := userFrom(r)
	hits, err := s.st.Search(r.Context(), u.CompanyID, u.ID, u.IsManager(), q)
	if err != nil {
		s.fail(w, err)
		return
	}
	if hits == nil {
		hits = []store.SearchHit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": hits})
}

// ---- CSV export ----

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	kind := strings.TrimSuffix(r.PathValue("kind"), ".csv")
	var header []string
	var rows [][]string
	ts := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.Format(time.RFC3339)
	}
	ms := func(v *float64) string {
		if v == nil {
			return ""
		}
		return strconv.FormatFloat(*v, 'f', 1, 64)
	}
	switch kind {
	case "shipments":
		f := s.shipmentFilter(r)
		f.Before, f.Limit = 0, 10000
		list, err := s.st.ListShipments(r.Context(), f)
		if err != nil {
			s.fail(w, err)
			return
		}
		header = []string{"reference", "mode", "status", "customer", "carrier", "origin", "destination", "weight_kg", "pieces", "priority", "departs_at", "eta", "delivered_at", "on_time"}
		for _, sh := range list {
			onTime := ""
			if sh.OnTime != nil {
				onTime = strconv.FormatBool(*sh.OnTime)
			}
			rows = append(rows, []string{sh.Reference, sh.Mode, sh.Status, sh.Customer, sh.Carrier, sh.Origin, sh.Destination,
				strconv.Itoa(sh.WeightKg), strconv.Itoa(sh.Pieces), sh.Priority, sh.DepartsAt.Format(time.RFC3339), sh.ETA.Format(time.RFC3339),
				ts(sh.DeliveredAt), onTime})
		}
	case "jobs":
		f := s.jobFilter(r)
		f.Before, f.Limit = 0, 200
		list, err := s.st.ListJobs(r.Context(), f)
		if err != nil {
			s.fail(w, err)
			return
		}
		header = []string{"id", "type", "status", "attempts", "worker", "stolen", "queue_ms", "run_ms", "enqueued_at", "finished_at", "error"}
		for _, j := range list {
			worker, errMsg := "", ""
			if j.Worker != nil {
				worker = *j.Worker
			}
			if j.Error != nil {
				errMsg = *j.Error
			}
			rows = append(rows, []string{strconv.FormatInt(j.ID, 10), j.Type, j.Status, strconv.Itoa(j.Attempts), worker,
				strconv.FormatBool(j.Stolen), ms(j.QueueMs), ms(j.DurationMs), j.EnqueuedAt.Format(time.RFC3339), ts(j.FinishedAt), errMsg})
		}
	case "inventory":
		items, err := s.st.Inventory(r.Context(), store.ItemFilter{Company: u.CompanyID})
		if err != nil {
			s.fail(w, err)
			return
		}
		header = []string{"sku", "name", "category", "location", "unit", "on_hand", "reserved", "available", "reorder_point", "reorder_qty", "inbound"}
		for _, it := range items {
			rows = append(rows, []string{it.SKU, it.Name, it.Category, it.Location, it.Unit, strconv.Itoa(it.OnHand), strconv.Itoa(it.Reserved),
				strconv.Itoa(it.Available), strconv.Itoa(it.ReorderPoint), strconv.Itoa(it.ReorderQty), strconv.Itoa(it.Inbound)})
		}
	case "activity":
		if !u.IsManager() {
			writeError(w, http.StatusForbidden, "Only managers can export the activity log.")
			return
		}
		list, err := s.st.Activity(r.Context(), u.CompanyID, "", 0, 200)
		if err != nil {
			s.fail(w, err)
			return
		}
		header = []string{"at", "actor", "action", "target", "detail"}
		for _, e := range list {
			actor := "System"
			if e.Actor != nil {
				actor = *e.Actor
			}
			rows = append(rows, []string{e.At.Format(time.RFC3339), actor, e.Action, e.Target, e.Detail})
		}
	default:
		writeError(w, http.StatusNotFound, "Unknown export.")
		return
	}
	name := fmt.Sprintf("relay-%s-%s.csv", kind, time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	cw := csv.NewWriter(w)
	cw.Write(header)
	for _, row := range rows {
		// Neutralise spreadsheet formula injection in free-text cells.
		for i, cell := range row {
			if cell != "" && strings.ContainsRune("=+-@", rune(cell[0])) && i > 0 {
				if _, err := strconv.ParseFloat(cell, 64); err != nil {
					row[i] = "'" + cell
				}
			}
		}
		cw.Write(row)
	}
	cw.Flush()
}
