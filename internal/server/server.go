// Package server exposes Relay's HTTP API and serves the web app.
package server

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"relay/internal/jobs"
	"relay/internal/store"
	"relay/relay"
)

//go:embed web
var webFS embed.FS

const (
	cookieName = "relay_session"
	sessionTTL = 7 * 24 * time.Hour
)

type Server struct {
	st  *store.Store
	rt  *relay.Runtime
	log *slog.Logger
	mux *http.ServeMux
	// dummyHash keeps login timing the same for unknown emails.
	dummyHash []byte
}

func New(st *store.Store, rt *relay.Runtime, log *slog.Logger) http.Handler {
	s := &Server{st: st, rt: rt, log: log, mux: http.NewServeMux()}
	s.dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

	s.mux.HandleFunc("GET /api/demo-accounts", s.demoAccounts)
	s.mux.HandleFunc("POST /api/login", s.login)
	s.mux.HandleFunc("POST /api/logout", s.logout)

	s.mux.HandleFunc("GET /api/me", s.auth(s.me))
	s.mux.HandleFunc("GET /api/runtime", s.auth(s.runtime))
	s.mux.HandleFunc("GET /api/stream", s.auth(s.stream))
	s.mux.HandleFunc("PUT /api/runtime/mode", s.manager(s.setMode))
	s.mux.HandleFunc("POST /api/runtime/burst", s.manager(s.burst))

	s.mux.HandleFunc("GET /api/jobs", s.auth(s.listJobs))
	s.mux.HandleFunc("GET /api/jobs/{id}", s.auth(s.getJob))
	s.mux.HandleFunc("POST /api/jobs", s.auth(s.createJob))
	s.mux.HandleFunc("POST /api/jobs/{id}/retry", s.manager(s.retryJob))

	s.mux.HandleFunc("GET /api/docks", s.auth(s.docks))
	s.mux.HandleFunc("POST /api/appointments", s.manager(s.createAppointment))
	s.mux.HandleFunc("POST /api/appointments/{id}/confirm", s.manager(s.confirmAppointment))
	s.mux.HandleFunc("POST /api/appointments/{id}/checkin", s.auth(s.checkIn))
	s.mux.HandleFunc("POST /api/appointments/{id}/complete", s.manager(s.completeAppointment))

	s.mux.HandleFunc("GET /api/shifts", s.auth(s.shifts))
	s.mux.HandleFunc("POST /api/shifts", s.manager(s.createShift))
	s.mux.HandleFunc("DELETE /api/shifts/{id}", s.manager(s.deleteShift))
	s.mux.HandleFunc("POST /api/shifts/publish", s.manager(s.publishShifts))

	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "No such endpoint.")
	})
	s.mux.Handle("/", s.static())
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Mutations must carry a custom header, which a cross-site form or
	// image request cannot add without a CORS preflight.
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Requested-With") != "relay" {
		writeError(w, http.StatusForbidden, "Missing X-Requested-With header.")
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) static() http.Handler {
	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServerFS(sub)
	index, _ := fs.ReadFile(sub, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(index)
	})
}

// ---- helpers ----

type ctxKey struct{}

func userFrom(r *http.Request) store.User { return r.Context().Value(ctxKey{}).(store.User) }

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		u, err := s.st.SessionUser(r.Context(), c.Value)
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				s.log.Error("session lookup", "err", err)
			}
			writeError(w, http.StatusUnauthorized, "Your session has expired. Sign in again.")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	}
}

func (s *Server) manager(next http.HandlerFunc) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		if !userFrom(r).IsManager() {
			writeError(w, http.StatusForbidden, "Only managers can do that.")
			return
		}
		next(w, r)
	})
}

type apiError struct {
	Error string `json:"error"`
	Field string `json:"field,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Error: msg})
}

func fieldError(w http.ResponseWriter, field, msg string) {
	writeJSON(w, http.StatusUnprocessableEntity, apiError{Error: msg, Field: field})
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "That record doesn’t exist or belongs to another company.")
		return
	}
	s.log.Error("request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "Something went wrong on our side. Try again.")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "The request body isn’t valid JSON.")
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "Not found.")
		return 0, false
	}
	return id, true
}

func timeRange(w http.ResponseWriter, r *http.Request, maxSpan time.Duration) (time.Time, time.Time, bool) {
	from, err1 := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, err2 := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if err1 != nil || err2 != nil || !to.After(from) || to.Sub(from) > maxSpan {
		writeError(w, http.StatusBadRequest, "Pass a valid from/to range in RFC 3339 format.")
		return from, to, false
	}
	return from, to, true
}

func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

// ---- auth ----

func (s *Server) demoAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.st.DemoAccounts(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts, "password": store.DemoPassword})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if !readJSON(w, r, &in) {
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Email == "" {
		fieldError(w, "email", "Enter your work email.")
		return
	}
	if in.Password == "" {
		fieldError(w, "password", "Enter your password.")
		return
	}
	u, err := s.st.UserByEmail(r.Context(), in.Email)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.fail(w, err)
		return
	}
	hash := s.dummyHash
	if err == nil {
		hash = []byte(u.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(in.Password)) != nil || err != nil {
		fieldError(w, "password", "That email and password don’t match an account.")
		return
	}
	token, err := s.st.CreateSession(r.Context(), u.ID, sessionTTL)
	if err != nil {
		s.fail(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		_ = s.st.DeleteSession(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	c, err := s.st.Company(r.Context(), u.CompanyID)
	if err != nil {
		s.fail(w, err)
		return
	}
	var kinds []jobs.Kind
	for _, k := range jobs.Catalog {
		if k.Submit == "all" || (k.Submit == "manager" && u.IsManager()) {
			kinds = append(kinds, k)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "company": c, "jobKinds": kinds, "allKinds": jobs.Catalog})
}

// ---- runtime ----

func (s *Server) runtime(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	out := map[string]any{
		"mode":    s.rt.Mode(),
		"workers": s.rt.Config().Workers,
		"history": s.rt.Metrics.History(u.CompanyID),
		"changes": s.rt.ModeChanges(),
	}
	if u.IsManager() {
		runs, err := s.st.Runs(r.Context(), u.CompanyID, 10)
		if err != nil {
			s.fail(w, err)
			return
		}
		types, err := s.st.JobTypeStats(r.Context(), u.CompanyID)
		if err != nil {
			s.fail(w, err)
			return
		}
		out["runs"], out["types"] = runs, types
		out["activeRuns"] = s.rt.Metrics.ActiveRuns(u.CompanyID)
		out["workerStats"] = s.rt.Workers()
		out["prefetch"] = s.rt.Config().Prefetch
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Streaming unsupported.")
		return
	}
	u := userFrom(r)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		msg := map[string]any{"mode": s.rt.Mode()}
		if p, ok := s.rt.Metrics.Latest(u.CompanyID); ok {
			msg["point"] = p
		}
		if u.IsManager() {
			msg["workers"] = s.rt.Workers()
			msg["activeRuns"] = s.rt.Metrics.ActiveRuns(u.CompanyID)
		}
		b, _ := json.Marshal(msg)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}

func (s *Server) setMode(w http.ResponseWriter, r *http.Request) {
	var in struct{ Mode relay.Mode }
	if !readJSON(w, r, &in) {
		return
	}
	if !in.Mode.Valid() {
		fieldError(w, "mode", "Choose work-stealing or single-queue.")
		return
	}
	if err := s.rt.SetMode(in.Mode); err != nil {
		s.fail(w, err)
		return
	}
	s.log.Info("mode changed", "by", userFrom(r).Email, "mode", in.Mode)
	writeJSON(w, http.StatusOK, map[string]any{"mode": s.rt.Mode(), "changes": s.rt.ModeChanges()})
}

const maxBurst = 50_000

func (s *Server) burst(w http.ResponseWriter, r *http.Request) {
	var in struct{ Jobs int }
	if !readJSON(w, r, &in) {
		return
	}
	if in.Jobs < 100 || in.Jobs > maxBurst {
		fieldError(w, "jobs", fmt.Sprintf("Pick between 100 and %d jobs.", maxBurst))
		return
	}
	u := userFrom(r)
	runID := s.rt.Metrics.BeginRun(u.CompanyID, s.rt.Mode(), in.Jobs)
	batch := jobs.Burst(u.CompanyID, in.Jobs, runID, rand.New(rand.NewPCG(uint64(runID), 7)))
	if _, err := s.rt.Enqueue(r.Context(), batch); err != nil {
		s.rt.Metrics.AbortRun(runID)
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"runId": runID, "jobs": in.Jobs, "mode": s.rt.Mode()})
}

// ---- jobs ----

func (s *Server) jobFilter(r *http.Request) store.JobFilter {
	q := r.URL.Query()
	u := userFrom(r)
	f := store.JobFilter{
		Company: u.CompanyID, Type: q.Get("type"), Query: strings.TrimSpace(q.Get("q")),
		IncludeLoad: q.Get("load") == "1", Limit: 50,
	}
	switch st := q.Get("status"); st {
	case "queued", "running", "succeeded", "failed":
		f.Status = st
	}
	if !u.IsManager() {
		f.SubmittedBy = u.ID
	}
	f.Before, _ = strconv.ParseInt(q.Get("before"), 10, 64)
	if n, err := strconv.Atoi(q.Get("limit")); err == nil {
		f.Limit = n
	}
	return f
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	f := s.jobFilter(r)
	list, err := s.st.ListJobs(r.Context(), f)
	if err != nil {
		s.fail(w, err)
		return
	}
	out := map[string]any{"jobs": list}
	if f.Before == 0 {
		counts, err := s.st.JobCounts(r.Context(), f)
		if err != nil {
			s.fail(w, err)
			return
		}
		out["counts"] = counts
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	j, err := s.st.Job(r.Context(), u.CompanyID, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) enqueueOne(r *http.Request, typ string, payload json.RawMessage) (int64, error) {
	u := userFrom(r)
	ids, err := s.rt.Enqueue(r.Context(), []relay.NewJob{{
		Company: u.CompanyID, Type: typ, Payload: payload, SubmittedBy: &u.ID,
	}})
	if err != nil {
		return 0, err
	}
	return ids[0], nil
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var in struct{ Type, Reference string }
	if !readJSON(w, r, &in) {
		return
	}
	u := userFrom(r)
	kind, ok := jobs.Lookup(in.Type)
	if !ok || kind.Submit == "system" || (kind.Submit == "manager" && !u.IsManager()) {
		fieldError(w, "type", "Choose a job type you’re allowed to run.")
		return
	}
	ref := strings.TrimSpace(in.Reference)
	if utf8.RuneCountInString(ref) > 40 {
		fieldError(w, "reference", "Keep the reference under 40 characters.")
		return
	}
	payload := jobs.Payload(u.CompanyID, in.Type, ref, rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())))
	id, err := s.enqueueOne(r, in.Type, payload)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": id})
}

func (s *Server) retryJob(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	j, err := s.st.ResetFailed(r.Context(), u.CompanyID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "Only failed jobs can be retried.")
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	if err := s.rt.Requeue(r.Context(), j); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": j.ID})
}

// ---- docks ----

func (s *Server) docks(w http.ResponseWriter, r *http.Request) {
	from, to, ok := timeRange(w, r, 8*24*time.Hour)
	if !ok {
		return
	}
	u := userFrom(r)
	docks, err := s.st.Docks(r.Context(), u.CompanyID)
	if err != nil {
		s.fail(w, err)
		return
	}
	appts, err := s.st.Appointments(r.Context(), u.CompanyID, from, to)
	if err != nil {
		s.fail(w, err)
		return
	}
	staff, err := s.st.Staff(r.Context(), u.CompanyID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"docks": docks, "appointments": appts, "staff": staff})
}

func (s *Server) createAppointment(w http.ResponseWriter, r *http.Request) {
	var in store.NewAppointment
	if !readJSON(w, r, &in) {
		return
	}
	in.Carrier, in.Reference = clean(in.Carrier), strings.ToUpper(clean(in.Reference))
	switch {
	case in.DockID == 0:
		fieldError(w, "dockId", "Choose a dock door.")
	case in.Carrier == "" || utf8.RuneCountInString(in.Carrier) > 60:
		fieldError(w, "carrier", "Enter the carrier name (up to 60 characters).")
	case in.Reference == "" || utf8.RuneCountInString(in.Reference) > 30:
		fieldError(w, "reference", "Enter a PO or SO reference (up to 30 characters).")
	case in.Direction != "inbound" && in.Direction != "outbound":
		fieldError(w, "direction", "Choose inbound or outbound.")
	case in.Pallets < 1 || in.Pallets > 60:
		fieldError(w, "pallets", "Pallets must be between 1 and 60.")
	case in.StartsAt.IsZero():
		fieldError(w, "start", "Choose a start time.")
	case in.EndsAt.Sub(in.StartsAt) < 15*time.Minute || in.EndsAt.Sub(in.StartsAt) > 8*time.Hour:
		fieldError(w, "duration", "Slots run from 15 minutes to 8 hours.")
	default:
		u := userFrom(r)
		id, err := s.st.CreateAppointment(r.Context(), u.CompanyID, in)
		if errors.Is(err, store.ErrConflict) {
			fieldError(w, "start", "That door is already booked for part of this slot.")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			fieldError(w, "dockId", "Choose one of your dock doors.")
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		jobID, err := s.enqueueOne(r, "dock.confirm", mustJSON(map[string]int64{"appointmentId": id}))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id, "jobId": jobID})
	}
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func (s *Server) appointmentJob(w http.ResponseWriter, r *http.Request, typ, want, verb string, allowed func(store.User, store.Appointment) bool) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u := userFrom(r)
	a, err := s.st.Appointment(r.Context(), u.CompanyID, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !allowed(u, a) {
		writeError(w, http.StatusForbidden, "This appointment is assigned to someone else.")
		return
	}
	if a.Status != want {
		writeError(w, http.StatusConflict, fmt.Sprintf("Only %s appointments can be %s.", strings.ReplaceAll(want, "_", " "), verb))
		return
	}
	jobID, err := s.enqueueOne(r, typ, mustJSON(map[string]int64{"appointmentId": id}))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": jobID})
}

func (s *Server) confirmAppointment(w http.ResponseWriter, r *http.Request) {
	s.appointmentJob(w, r, "dock.confirm", "requested", "confirmed",
		func(store.User, store.Appointment) bool { return true })
}

func (s *Server) checkIn(w http.ResponseWriter, r *http.Request) {
	s.appointmentJob(w, r, "dock.checkin", "confirmed", "checked in",
		func(u store.User, a store.Appointment) bool {
			return u.IsManager() || (a.AssignedTo != nil && *a.AssignedTo == u.ID)
		})
}

func (s *Server) completeAppointment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	done, err := s.st.AdvanceAppointment(r.Context(), userFrom(r).CompanyID, id, "checked_in", "completed")
	if err != nil {
		s.fail(w, err)
		return
	}
	if !done {
		writeError(w, http.StatusConflict, "Only checked-in appointments can be completed.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- shifts ----

func (s *Server) shifts(w http.ResponseWriter, r *http.Request) {
	from, to, ok := timeRange(w, r, 8*24*time.Hour)
	if !ok {
		return
	}
	u := userFrom(r)
	staff, err := s.st.Staff(r.Context(), u.CompanyID)
	if err != nil {
		s.fail(w, err)
		return
	}
	list, err := s.st.Shifts(r.Context(), u.CompanyID, from, to)
	if err != nil {
		s.fail(w, err)
		return
	}
	if !u.IsManager() {
		// Employees only see what has been published.
		visible := list[:0]
		for _, sh := range list {
			if sh.Published {
				visible = append(visible, sh)
			}
		}
		list = visible
	}
	writeJSON(w, http.StatusOK, map[string]any{"staff": staff, "shifts": list})
}

func (s *Server) createShift(w http.ResponseWriter, r *http.Request) {
	var in store.Shift
	if !readJSON(w, r, &in) {
		return
	}
	in.Position, in.Location = clean(in.Position), clean(in.Location)
	switch {
	case in.UserID == 0:
		fieldError(w, "userId", "Choose who works this shift.")
	case in.Position == "" || utf8.RuneCountInString(in.Position) > 40:
		fieldError(w, "position", "Enter a position (up to 40 characters).")
	case in.Location == "" || utf8.RuneCountInString(in.Location) > 40:
		fieldError(w, "location", "Enter a location (up to 40 characters).")
	case in.StartsAt.IsZero():
		fieldError(w, "start", "Choose a start time.")
	case !in.EndsAt.After(in.StartsAt) || in.EndsAt.Sub(in.StartsAt) > 14*time.Hour:
		fieldError(w, "end", "End after the start, within 14 hours.")
	default:
		id, err := s.st.CreateShift(r.Context(), userFrom(r).CompanyID, in)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				fieldError(w, "userId", "Choose someone on your team.")
				return
			}
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": id})
	}
}

func (s *Server) deleteShift(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.st.DeleteShift(r.Context(), userFrom(r).CompanyID, id); err != nil {
		s.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) publishShifts(w http.ResponseWriter, r *http.Request) {
	var in struct{ From, To time.Time }
	if !readJSON(w, r, &in) {
		return
	}
	if !in.To.After(in.From) || in.To.Sub(in.From) > 8*24*time.Hour {
		writeError(w, http.StatusBadRequest, "Pass a valid week range.")
		return
	}
	u := userFrom(r)
	ids, err := s.st.DraftShifts(r.Context(), u.CompanyID, in.From, in.To)
	if err != nil {
		s.fail(w, err)
		return
	}
	batch := make([]relay.NewJob, len(ids))
	for i, id := range ids {
		batch[i] = relay.NewJob{Company: u.CompanyID, Type: "shift.publish", SubmittedBy: &u.ID,
			Payload: mustJSON(map[string]int64{"shiftId": id})}
	}
	jobIDs, err := s.rt.Enqueue(r.Context(), batch)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobs": len(jobIDs), "jobIds": jobIDs})
}
