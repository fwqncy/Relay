// Command bench drives a running Relay server through a burst in each
// scheduling mode and prints the queue-latency comparison.
//
//	go run ./cmd/bench -jobs 12000
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"text/tabwriter"
	"time"
)

type result struct {
	ID         int64   `json:"id"`
	Mode       string  `json:"mode"`
	Jobs       int     `json:"jobs"`
	P50        float64 `json:"p50"`
	P95        float64 `json:"p95"`
	P99        float64 `json:"p99"`
	Throughput float64 `json:"throughput"`
}

type client struct {
	base string
	http *http.Client
}

func (c *client) do(method, path string, body, out any) error {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.base+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "relay")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var e struct{ Error string }
		json.NewDecoder(res.Body).Decode(&e)
		return fmt.Errorf("%s %s: %s %s", method, path, res.Status, e.Error)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

func main() {
	base := flag.String("url", "http://localhost:8080", "Relay server URL")
	email := flag.String("email", "maya@harborline.example", "manager account to run as")
	password := flag.String("password", "relay-demo", "password for -email")
	n := flag.Int("jobs", 12000, "jobs per burst")
	flag.Parse()

	jar, _ := cookiejar.New(nil)
	c := &client{base: *base, http: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
	if err := c.do("POST", "/api/login", map[string]string{"email": *email, "password": *password}, nil); err != nil {
		fail(err)
	}
	var rt struct{ Mode string }
	if err := c.do("GET", "/api/runtime", nil, &rt); err != nil {
		fail(err)
	}

	var results []result
	for _, mode := range []string{"single-queue", "work-stealing"} {
		fmt.Printf("→ %s: switching mode and enqueueing %d jobs…\n", mode, *n)
		if err := c.do("PUT", "/api/runtime/mode", map[string]string{"mode": mode}, nil); err != nil {
			fail(err)
		}
		time.Sleep(3 * time.Second) // let reclaimed jobs from the switch drain
		var started struct{ RunID int64 }
		if err := c.do("POST", "/api/runtime/burst", map[string]int{"jobs": *n}, &started); err != nil {
			fail(err)
		}
		res, err := wait(c, started.RunID, 3*time.Minute)
		if err != nil {
			fail(err)
		}
		results = append(results, res)
	}
	if err := c.do("PUT", "/api/runtime/mode", map[string]string{"mode": rt.Mode}, nil); err != nil {
		fail(err)
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', tabwriter.AlignRight)
	fmt.Fprintln(tw, "\nmode\tjobs\tp50\tp95\tp99\tjobs/s\t")
	for _, r := range results {
		fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\t%.0f\t\n", r.Mode, r.Jobs, ms(r.P50), ms(r.P95), ms(r.P99), r.Throughput)
	}
	tw.Flush()
	if len(results) == 2 && results[1].P95 > 0 {
		fmt.Printf("\np95 queue latency: %s → %s (%.1f× lower)\n", ms(results[0].P95), ms(results[1].P95), results[0].P95/results[1].P95)
	}
}

func wait(c *client, id int64, timeout time.Duration) (result, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		time.Sleep(time.Second)
		var rt struct{ Runs []result }
		if err := c.do("GET", "/api/runtime", nil, &rt); err != nil {
			return result{}, err
		}
		for _, r := range rt.Runs {
			if r.ID == id {
				return r, nil
			}
		}
	}
	return result{}, fmt.Errorf("run %d did not finish within %s", id, timeout)
}

func ms(v float64) string {
	if v >= 1000 {
		return fmt.Sprintf("%.2f s", v/1000)
	}
	return fmt.Sprintf("%.0f ms", v)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "bench:", err)
	os.Exit(1)
}
