package relay

import (
	"cmp"
	"math/rand/v2"
	"slices"
	"sync"
	"time"
)

const (
	bucketCount   = 180 // seconds of per-second buckets kept in memory
	historyLen    = 300 // sampled points kept per series
	reservoirSize = 2048
	latencyWindow = 5 // seconds of buckets a percentile is computed over
)

// Point is one per-second sample of a series. Latencies are in
// milliseconds; nil means no job finished inside the window.
type Point struct {
	T          int64    `json:"t"`
	P50        *float64 `json:"p50"`
	P95        *float64 `json:"p95"`
	Throughput float64  `json:"throughput"`
	Queued     int64    `json:"queued"`
	Mode       Mode     `json:"mode"`
}

// RunResult summarises a finished load run.
type RunResult struct {
	ID         int64     `json:"id"`
	Company    string    `json:"company"`
	Mode       Mode      `json:"mode"`
	Jobs       int       `json:"jobs"`
	P50        float64   `json:"p50"`
	P95        float64   `json:"p95"`
	P99        float64   `json:"p99"`
	Throughput float64   `json:"throughput"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt"`
}

// RunProgress describes a load run that is still draining.
type RunProgress struct {
	ID    int64 `json:"id"`
	Mode  Mode  `json:"mode"`
	Total int   `json:"total"`
	Done  int   `json:"done"`
}

type bucket struct {
	sec  int64
	n    int
	seen int
	lat  []float64
}

type series struct {
	buckets [bucketCount]bucket
	history []Point
}

type run struct {
	RunProgress
	company string
	started time.Time
	last    time.Time
	lat     []float64
}

// Metrics aggregates queue latency and throughput per company. The empty
// key holds the runtime-wide series.
type Metrics struct {
	mu        sync.Mutex
	series    map[string]*series
	queued    map[string]int64
	runs      map[int64]*run
	OnRunDone func(RunResult)
}

func NewMetrics() *Metrics {
	return &Metrics{series: map[string]*series{}, queued: map[string]int64{}, runs: map[int64]*run{}}
}

// Track makes sure a company gets sampled even before it has traffic.
func (m *Metrics) Track(companies ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range append(companies, "") {
		m.get(c)
	}
}

func (m *Metrics) get(key string) *series {
	s, ok := m.series[key]
	if !ok {
		s = &series{}
		m.series[key] = s
	}
	return s
}

func (m *Metrics) Enqueued(company string, n int64) {
	m.mu.Lock()
	m.queued[company] += n
	m.queued[""] += n
	m.mu.Unlock()
}

func (m *Metrics) Started(company string) {
	m.mu.Lock()
	m.queued[company]--
	m.queued[""]--
	m.mu.Unlock()
}

// SetQueued seeds the backlog counters, e.g. from Postgres at startup.
func (m *Metrics) SetQueued(counts map[string]int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var total int64
	for c, n := range counts {
		m.queued[c] = n
		total += n
	}
	m.queued[""] = total
}

// BeginRun registers a load run so its jobs can be summarised on completion.
func (m *Metrics) BeginRun(company string, mode Mode, total int) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := time.Now().UnixMilli()
	for m.runs[id] != nil {
		id++
	}
	m.runs[id] = &run{
		RunProgress: RunProgress{ID: id, Mode: mode, Total: total},
		company:     company, started: time.Now(),
		lat: make([]float64, 0, total),
	}
	return id
}

// AbortRun forgets a run whose jobs could not be enqueued.
func (m *Metrics) AbortRun(id int64) {
	m.mu.Lock()
	delete(m.runs, id)
	m.mu.Unlock()
}

func (m *Metrics) ActiveRuns(company string) []RunProgress {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []RunProgress
	for _, r := range m.runs {
		if company == "" || r.company == company {
			out = append(out, r.RunProgress)
		}
	}
	slices.SortFunc(out, func(a, b RunProgress) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// Record stores the queue latency of a finished job.
func (m *Metrics) Record(company string, runID int64, latency time.Duration, end time.Time) {
	ms := float64(latency.Microseconds()) / 1000
	sec := end.Unix()
	var done *RunResult
	m.mu.Lock()
	m.get(company).add(sec, ms)
	m.get("").add(sec, ms)
	if r := m.runs[runID]; runID != 0 && r != nil {
		r.Done++
		r.lat = append(r.lat, ms)
		r.last = end
		if r.Done >= r.Total {
			delete(m.runs, runID)
			res := r.result()
			done = &res
		}
	}
	cb := m.OnRunDone
	m.mu.Unlock()
	if done != nil && cb != nil {
		go cb(*done)
	}
}

func (r *run) result() RunResult {
	slices.Sort(r.lat)
	elapsed := r.last.Sub(r.started).Seconds()
	tput := 0.0
	if elapsed > 0 {
		tput = float64(r.Total) / elapsed
	}
	return RunResult{
		ID: r.ID, Company: r.company, Mode: r.Mode, Jobs: r.Total,
		P50: quantile(r.lat, 0.50), P95: quantile(r.lat, 0.95), P99: quantile(r.lat, 0.99),
		Throughput: tput, StartedAt: r.started, FinishedAt: r.last,
	}
}

func (s *series) add(sec int64, ms float64) {
	b := &s.buckets[sec%bucketCount]
	if b.sec != sec {
		b.sec, b.n, b.seen, b.lat = sec, 0, 0, b.lat[:0]
	}
	b.n++
	b.seen++
	if len(b.lat) < reservoirSize {
		b.lat = append(b.lat, ms)
	} else if i := rand.IntN(b.seen); i < reservoirSize {
		b.lat[i] = ms
	}
}

func (s *series) point(now time.Time, queued int64, mode Mode) Point {
	sec := now.Unix()
	var lat []float64
	for i := int64(0); i < latencyWindow; i++ {
		if b := s.buckets[(sec-i)%bucketCount]; b.sec == sec-i {
			lat = append(lat, b.lat...)
		}
	}
	// Throughput uses the last two whole seconds so a partial bucket
	// doesn't read as a dip.
	n := 0
	for i := int64(1); i <= 2; i++ {
		if b := s.buckets[(sec-i)%bucketCount]; b.sec == sec-i {
			n += b.n
		}
	}
	p := Point{T: now.UnixMilli(), Throughput: float64(n) / 2, Queued: max(0, queued), Mode: mode}
	if len(lat) > 0 {
		slices.Sort(lat)
		p50, p95 := quantile(lat, 0.5), quantile(lat, 0.95)
		p.P50, p.P95 = &p50, &p95
	}
	return p
}

// Sample appends a point to every series' history.
func (m *Metrics) Sample(now time.Time, mode Mode) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, s := range m.series {
		s.history = append(s.history, s.point(now, m.queued[key], mode))
		if len(s.history) > historyLen {
			s.history = slices.Delete(s.history, 0, len(s.history)-historyLen)
		}
	}
}

// History returns the sampled points for a company ("" for the runtime).
func (m *Metrics) History(company string) []Point {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.series[company]; ok {
		return append([]Point(nil), s.history...)
	}
	return nil
}

// Latest returns the most recent sampled point.
func (m *Metrics) Latest(company string) (Point, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.series[company]; ok && len(s.history) > 0 {
		return s.history[len(s.history)-1], true
	}
	return Point{}, false
}

func quantile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(q*float64(len(sorted)-1) + 0.5)
	return sorted[min(i, len(sorted)-1)]
}
