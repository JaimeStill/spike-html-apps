package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"
	"uuid"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-core/event"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-messaging/memory"
	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/domain/document"
	"github.com/JaimeStill/spike-html-apps/domain/run"
	"github.com/JaimeStill/spike-html-apps/internal/config"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests drive the runs through the composed router over loopback
// HTTP, and read their stage events from the in-memory broker the unit tier
// composes in place of NATS.

// stageNames is the order a run's stages pass in.
var stageNames = []string{"upload", "metadata", "extraction", "chunks", "embeddings"}

// startRuns runs the app with stage interval interval and returns it, its
// configuration, and a client bound to it.
func startRuns(t *testing.T, interval time.Duration) (*running, *config.Config, *webtest.Client) {
	t.Helper()
	cfg := configtest.Config(t)
	cfg.Runs.StageInterval = libconfig.Duration(interval)
	r := start(t, cfg)
	return r, cfg, webtest.NewClient("http://" + waitForReady(t, r.log))
}

// uploadDoc uploads a small text document and returns it.
func uploadDoc(t *testing.T, c *webtest.Client, name string) document.Document {
	t.Helper()
	return webtest.Decode[document.Document](t, upload(t, c, name, "text/plain", []byte("content of "+name)), http.StatusCreated)
}

// readRun reads the run id.
func readRun(t *testing.T, c *webtest.Client, id string) run.Run {
	t.Helper()
	return webtest.Decode[run.Run](t, c.Get(t, "/api/runs/"+id), http.StatusOK)
}

// completed counts the run's complete stages.
func completed(r run.Run) int {
	n := 0
	for _, s := range r.Stages {
		if s.State == run.Done {
			n++
		}
	}
	return n
}

// awaitRun polls the run id until done reports true of it, failing the
// test past within, and returns every distinct count of complete stages it
// saw, in order, with the last read.
func awaitRun(t *testing.T, c *webtest.Client, id string, within time.Duration, done func(run.Run) bool) ([]int, run.Run) {
	t.Helper()
	var seen []int
	deadline := time.Now().Add(within)
	for {
		r := readRun(t, c, id)
		if n := completed(r); len(seen) == 0 || seen[len(seen)-1] != n {
			seen = append(seen, n)
		}
		if done(r) {
			return seen, r
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %s = %+v after %s; the wait's condition never held", id, r, within)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// An upload starts its document's run, which the upload's run_id names and
// the listing's document filter finds. The run passes its stages in order,
// a read partway through showing the later ones pending, the kth completing
// no sooner than k-1 stage intervals after the run started, until the run
// is complete with its completion time the last stage's.
func TestRuns_UploadedDocumentRunCompletes(t *testing.T) {
	const interval = 40 * time.Millisecond
	_, _, c := startRuns(t, interval)

	doc := uploadDoc(t, c, "report.txt")
	seen, r := awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return r.Status == run.Complete })

	if r.ID != doc.RunID || r.DocumentID != doc.ID {
		t.Errorf("run = %+v, want run %s of document %s", r, doc.RunID, doc.ID)
	}
	if len(seen) < 3 || !slices.IsSorted(seen) || seen[len(seen)-1] != len(stageNames) {
		t.Errorf("complete-stage counts seen = %v, want them rising through intermediate states to %d", seen, len(stageNames))
	}
	if len(r.Stages) != len(stageNames) {
		t.Fatalf("stages = %+v, want %d", r.Stages, len(stageNames))
	}
	prev := r.CreatedAt
	for i, s := range r.Stages {
		if s.Name != stageNames[i] || s.Position != i+1 || s.State != run.Done || s.CompletedAt == nil {
			t.Fatalf("stage %d = %+v, want %s at position %d, complete", i, s, stageNames[i], i+1)
		}
		if due := r.CreatedAt.Add(time.Duration(i) * interval); s.CompletedAt.Before(due) {
			t.Errorf("stage %s completed %s after the run started, want at least %s", s.Name, s.CompletedAt.Sub(r.CreatedAt), time.Duration(i)*interval)
		}
		if s.CompletedAt.Before(prev) {
			t.Errorf("stage %s completed at %s, before the stage ahead of it at %s", s.Name, s.CompletedAt, prev)
		}
		prev = *s.CompletedAt
	}
	if r.CompletedAt == nil || !r.CompletedAt.Equal(prev) {
		t.Errorf("run completed_at = %v, want the last stage's %s", r.CompletedAt, prev)
	}

	other := uploadDoc(t, c, "other.txt")
	page := webtest.Decode[struct {
		Items []run.Run `json:"items"`
		Total *int      `json:"total"`
	}](t, c.Get(t, "/api/runs?document="+doc.ID), http.StatusOK)
	if len(page.Items) != 1 || page.Items[0].ID != doc.RunID || page.Total == nil || *page.Total != 1 {
		t.Errorf("runs of document %s = %+v, want its one run %s", doc.ID, page, doc.RunID)
	}
	all := webtest.Decode[struct {
		Items []run.Run `json:"items"`
	}](t, c.Get(t, "/api/runs"), http.StatusOK)
	if len(all.Items) != 2 || all.Items[0].ID != doc.RunID || all.Items[1].ID != other.RunID {
		t.Errorf("runs = %+v, want both runs in creation order", all.Items)
	}
}

// A run's first stage completes as soon as the run starts: the upload
// nudges the reactor. The interval here is long, so neither a stage's own
// due time nor the reactor's backstop tick, a fifth of it, could complete
// it within the bound.
func TestRuns_FirstStageCompletesAtOnce(t *testing.T) {
	const interval = 5 * time.Second
	_, _, c := startRuns(t, interval)

	began := time.Now()
	doc := uploadDoc(t, c, "prompt.txt")
	_, r := awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return completed(r) == 1 })
	if elapsed := time.Since(began); elapsed > interval/10 {
		t.Errorf("first stage completed %s after the upload, want within %s", elapsed, interval/10)
	}
	if r.Stages[1].State != run.Pending || r.Status != run.Running {
		t.Errorf("run = %+v, want the later stages pending and the run running", r)
	}
}

// collector gathers the events a broker delivers to one subscription.
type collector struct {
	mu     sync.Mutex
	events []event.Event
}

// collect subscribes to b from its log's start and gathers every event it
// delivers until the test ends.
func collect(t *testing.T, b *memory.Broker) *collector {
	t.Helper()
	src, err := b.Subscribe(messaging.Subscription{Name: "test"}, nil)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	col := &collector{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = src.Receive(ctx, func(_ context.Context, e event.Event) error {
			col.mu.Lock()
			defer col.mu.Unlock()
			col.events = append(col.events, e)
			return nil
		})
	}()
	t.Cleanup(func() { cancel(); <-done })
	return col
}

// snapshot returns the events gathered so far.
func (col *collector) snapshot() []event.Event {
	col.mu.Lock()
	defer col.mu.Unlock()
	return slices.Clone(col.events)
}

// await waits until n events are gathered and returns them.
func (col *collector) await(t *testing.T, n int) []event.Event {
	t.Helper()
	deadline := time.Now().Add(failsafe)
	for time.Now().Before(deadline) {
		if got := col.snapshot(); len(got) >= n {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("gathered %d events, want %d", len(col.snapshot()), n)
	return nil
}

// Each completed stage publishes one CloudEvent through the broker: the
// type <prefix>.run.stage for every stage, the run's id as its subject, the
// instance's source, its completion time as the event's time, and JSON data
// naming exactly the stage, its 1-based position, the stage count, and the
// document. Each run's events arrive in stage order, and two runs' events
// never mix up their subjects.
func TestRuns_StageEventsPublished(t *testing.T) {
	const interval = 20 * time.Millisecond
	r, cfg, c := startRuns(t, interval)
	col := collect(t, r.broker)

	docs := []document.Document{uploadDoc(t, c, "one.txt"), uploadDoc(t, c, "two.txt")}
	events := col.await(t, 2*len(stageNames))

	for _, doc := range docs {
		_, rn := awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return r.Status == run.Complete })
		var mine []event.Event
		for _, e := range events {
			if e.Subject == doc.RunID {
				mine = append(mine, e)
			}
		}
		if len(mine) != len(stageNames) {
			t.Fatalf("run %s has %d events, want %d", doc.RunID, len(mine), len(stageNames))
		}
		for i, e := range mine {
			if e.Type != cfg.NATS.Prefix+".run.stage" {
				t.Errorf("event type = %q, want %s.run.stage", e.Type, cfg.NATS.Prefix)
			}
			if e.Source != "/emulator/"+cfg.Runs.Instance {
				t.Errorf("event source = %q, want /emulator/%s", e.Source, cfg.Runs.Instance)
			}
			if e.DataContentType != "application/json" {
				t.Errorf("event datacontenttype = %q, want application/json", e.DataContentType)
			}
			if !e.Time.Equal(*rn.Stages[i].CompletedAt) {
				t.Errorf("event %d time = %s, want the stage's completion %s", i, e.Time, rn.Stages[i].CompletedAt)
			}
			var data struct {
				Stage      string `json:"stage"`
				Position   int    `json:"position"`
				StageCount int    `json:"stage_count"`
				DocumentID string `json:"document_id"`
			}
			dec := json.NewDecoder(bytes.NewReader(e.Data))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&data); err != nil {
				t.Fatalf("event data %s: %v", e.Data, err)
			}
			want := struct {
				Stage      string `json:"stage"`
				Position   int    `json:"position"`
				StageCount int    `json:"stage_count"`
				DocumentID string `json:"document_id"`
			}{stageNames[i], i + 1, len(stageNames), doc.ID}
			if data != want {
				t.Errorf("event %d data = %+v, want %+v", i, data, want)
			}
		}
	}

	// No stage publishes twice: the gathered events are exactly the two
	// runs' ten, with ten distinct ids.
	time.Sleep(3 * interval)
	got := col.snapshot()
	ids := map[string]bool{}
	for _, e := range got {
		ids[e.ID] = true
	}
	if len(got) != 2*len(stageNames) || len(ids) != len(got) {
		t.Errorf("events = %d with %d distinct ids, want %d distinct", len(got), len(ids), 2*len(stageNames))
	}
}

// The runner drains with the process: once Run returns, a run cut off
// partway publishes no further stage, however long the broker is watched.
func TestRuns_DrainStopsPublishing(t *testing.T) {
	const interval = 100 * time.Millisecond
	r, _, c := startRuns(t, interval)
	col := collect(t, r.broker)

	uploadDoc(t, c, "halted.txt")
	col.await(t, 2)
	r.cancel()
	if code := r.exit(t); code != 0 {
		t.Fatalf("Run = %d, want 0; log: %q", code, r.log.String())
	}
	atExit := len(col.snapshot())
	if atExit >= len(stageNames) {
		t.Fatalf("%d events by the drain, want the run cut off partway", atExit)
	}
	time.Sleep(4 * interval)
	if after := len(col.snapshot()); after != atExit {
		t.Errorf("events = %d after the drain, %d at Run's return; want none published after", after, atExit)
	}
}

// An id the store does not hold is a 404 problem and a malformed one a 400;
// the listing refuses a filter other than document, and a sort.
func TestRuns_UnknownIDAndBadQueries(t *testing.T) {
	_, _, c := startRuns(t, time.Hour)
	_ = c.Get(t, "/api/runs/"+uuid.NewV4().String()).Problem(t, http.StatusNotFound)
	_ = c.Get(t, "/api/runs/not-a-uuid").Problem(t, http.StatusBadRequest)
	for _, q := range []string{"status=complete", "document[ne]=x", "sort=created_at"} {
		_ = c.Get(t, "/api/runs?"+q).Problem(t, http.StatusBadRequest)
	}
	page := webtest.Decode[struct {
		Items []run.Run `json:"items"`
	}](t, c.Get(t, "/api/runs?document="+uuid.NewV4().String()), http.StatusOK)
	if len(page.Items) != 0 {
		t.Errorf("runs of an unknown document = %+v, want none", page.Items)
	}
}
