package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
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

// startFailing runs the app as startRuns does, under the fail rules rules.
func startFailing(t *testing.T, interval time.Duration, rules ...string) (*running, *config.Config, *webtest.Client) {
	t.Helper()
	return startRules(t, interval, rules, nil)
}

// startRules runs the app as startRuns does, under the fail rules fail and
// the hold rules hold.
func startRules(t *testing.T, interval time.Duration, fail, hold []string) (*running, *config.Config, *webtest.Client) {
	t.Helper()
	cfg := configtest.Config(t)
	cfg.Runs.StageInterval = libconfig.Duration(interval)
	cfg.Runs.Fail = fail
	cfg.Runs.Hold = hold
	r := start(t, cfg)
	return r, cfg, webtest.NewClient("http://" + waitForReady(t, r.log))
}

// A document whose name matches a fail rule starts a run that fails at the
// rule's stage: the stages before it complete, the stage itself failed
// with its failure time and the rule's reason, the stages after it
// pending, and the run failed, never complete. The broker holds the run's
// stage events for the stages before it, then one failure event, of type
// <prefix>.run.failed, at the stage's failure time, whose data names the
// stage, its position, the stage count, the document, and the reason the
// read gives; the run publishes nothing after it. The first matching rule
// wins, and a document no rule matches completes as before.
func TestRuns_FailRuleFailsRunAtStage(t *testing.T) {
	const interval = 20 * time.Millisecond
	const rule = "fail-at-*:extraction"
	r, cfg, c := startFailing(t, interval, "never-*:upload", rule, "fail-*:metadata")
	col := collect(t, r.broker)

	doc := uploadDoc(t, c, "fail-at-extraction.txt")
	ok := uploadDoc(t, c, "report.txt")
	_, rn := awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })
	_, okRun := awaitRun(t, c, ok.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })

	if rn.Status != run.Failed || rn.CompletedAt != nil {
		t.Fatalf("run = %+v, want it failed, with no completion time", rn)
	}
	wantReason := `emulated failure: the document's name matches the fail rule "` + rule + `"`
	for i, s := range rn.Stages {
		switch {
		case i < 2:
			if s.State != run.Done || s.CompletedAt == nil || s.FailedAt != nil || s.Reason != nil {
				t.Errorf("stage %d = %+v, want it complete", i, s)
			}
		case i == 2:
			if s.Name != "extraction" || s.State != run.Faulted || s.CompletedAt != nil || s.FailedAt == nil || s.Reason == nil || *s.Reason != wantReason {
				t.Errorf("stage %d = %+v, want extraction failed with reason %q", i, s, wantReason)
			}
		default:
			if s.State != run.Pending || s.CompletedAt != nil || s.FailedAt != nil || s.Reason != nil {
				t.Errorf("stage %d = %+v, want it pending", i, s)
			}
		}
	}
	if okRun.Status != run.Complete || completed(okRun) != len(stageNames) {
		t.Errorf("unmatched run = %+v, want it complete", okRun)
	}

	// The failing run's two stage events and its failure event, beside the
	// other run's five; then no more, however long the broker is watched.
	col.await(t, 3+len(stageNames))
	time.Sleep(4 * interval)
	var mine []event.Event
	for _, e := range col.snapshot() {
		if e.Subject == doc.RunID {
			mine = append(mine, e)
		}
	}
	if len(mine) != 3 {
		t.Fatalf("failing run's events = %+v, want two stage events and a failure", mine)
	}
	for i, e := range mine[:2] {
		if e.Type != cfg.NATS.Prefix+".run.stage" || !e.Time.Equal(*rn.Stages[i].CompletedAt) {
			t.Errorf("event %d = type %q at %s, want %s.run.stage at the stage's completion", i, e.Type, e.Time, cfg.NATS.Prefix)
		}
	}
	f := mine[2]
	if f.Type != cfg.NATS.Prefix+".run.failed" || f.ID != doc.RunID+".failed" || f.Source != "/emulator/"+cfg.Runs.Instance || f.DataContentType != "application/json" {
		t.Errorf("failure event = %+v, want type %s.run.failed, id %s.failed, the instance's source, JSON data", f, cfg.NATS.Prefix, doc.RunID)
	}
	if !f.Time.Equal(*rn.Stages[2].FailedAt) {
		t.Errorf("failure event time = %s, want the stage's failure %s", f.Time, rn.Stages[2].FailedAt)
	}
	type failedData struct {
		Stage      string `json:"stage"`
		Position   int    `json:"position"`
		StageCount int    `json:"stage_count"`
		DocumentID string `json:"document_id"`
		Reason     string `json:"reason"`
	}
	var data failedData
	dec := json.NewDecoder(bytes.NewReader(f.Data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&data); err != nil {
		t.Fatalf("failure event data %s: %v", f.Data, err)
	}
	if want := (failedData{"extraction", 3, len(stageNames), doc.ID, wantReason}); data != want {
		t.Errorf("failure event data = %+v, want %+v", data, want)
	}
}

// A run can fail at its first stage, before any stage completes, and at
// its last, after every other has.
func TestRuns_FailRuleAtFirstAndLastStage(t *testing.T) {
	_, _, c := startFailing(t, 10*time.Millisecond, "first.txt:upload", "last.txt:embeddings")
	for name, at := range map[string]int{"first.txt": 0, "last.txt": len(stageNames) - 1} {
		doc := uploadDoc(t, c, name)
		_, rn := awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })
		if rn.Status != run.Failed || completed(rn) != at || rn.Stages[at].State != run.Faulted {
			t.Errorf("%s: run = %+v, want it failed at stage %d with %d complete", name, rn, at+1, at)
		}
	}
}

// A malformed fail rule fails the run layer's construction, so Run exits 1
// naming the rule before anything reports ready.
func TestRuns_MalformedFailRuleFailsStartup(t *testing.T) {
	for name, rule := range map[string]string{
		"no stage":      "fail-*",
		"unknown stage": "fail-*:indexing",
		"empty pattern": ":upload",
		"bad pattern":   "fail-[:upload",
	} {
		t.Run(name, func(t *testing.T) {
			cfg := configtest.Config(t)
			cfg.Runs.Fail = []string{rule}
			var log syncBuffer
			a := newApp(t, cfg, &log)
			withMemoryBroker(a)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if code := a.Run(ctx); code != 1 {
				t.Errorf("Run = %d, want 1", code)
			}
			if out := log.String(); !strings.Contains(out, "fail rule") || strings.Contains(out, "server ready") {
				t.Errorf("log = %q, want a failure naming the fail rule and no ready record", out)
			}
		})
	}
}

// A document whose name matches a hold rule starts a run that holds at the
// rule's stage: the stages before it complete and publish their stage
// events, and the run stays running, the held stage and those after it
// pending with no time and no reason, however long it is watched. The
// broker holds its stage events for the stages before it alone, and no
// failure event. The first matching rule wins, and a document no rule
// matches, uploaded after it, completes as before, so the held run's
// schedule has passed its every stage by then.
func TestRuns_HoldRuleHoldsRunAtStage(t *testing.T) {
	const interval = 20 * time.Millisecond
	r, cfg, c := startRules(t, interval, nil, []string{"never-*:upload", "held-*:extraction", "held-*:metadata"})
	col := collect(t, r.broker)

	doc := uploadDoc(t, c, "held-brief.txt")
	ok := uploadDoc(t, c, "report.txt")
	awaitRun(t, c, doc.RunID, failsafe, func(r run.Run) bool { return completed(r) == 2 })
	_, okRun := awaitRun(t, c, ok.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })
	if okRun.Status != run.Complete || completed(okRun) != len(stageNames) {
		t.Errorf("unmatched run = %+v, want it complete", okRun)
	}
	col.await(t, 2+len(stageNames))
	time.Sleep(4 * interval)

	rn := readRun(t, c, doc.RunID)
	if rn.Status != run.Running || rn.CompletedAt != nil {
		t.Fatalf("run = %+v, want it running, with no completion time", rn)
	}
	for i, s := range rn.Stages {
		if i < 2 {
			if s.State != run.Done || s.CompletedAt == nil || s.FailedAt != nil || s.Reason != nil {
				t.Errorf("stage %d = %+v, want it complete", i, s)
			}
			continue
		}
		if s.State != run.Pending || s.CompletedAt != nil || s.FailedAt != nil || s.Reason != nil {
			t.Errorf("stage %d = %+v, want it pending, held at extraction", i, s)
		}
	}
	var mine []event.Event
	for _, e := range col.snapshot() {
		if e.Subject == doc.RunID {
			mine = append(mine, e)
		}
	}
	if len(mine) != 2 {
		t.Fatalf("held run's events = %+v, want its two stage events", mine)
	}
	for i, e := range mine {
		if e.Type != cfg.NATS.Prefix+".run.stage" || e.ID != doc.RunID+"."+strconv.Itoa(i+1) || !e.Time.Equal(*rn.Stages[i].CompletedAt) {
			t.Errorf("event %d = %+v, want %s.run.stage, id %s.%d, at the stage's completion", i, e, cfg.NATS.Prefix, doc.RunID, i+1)
		}
	}
}

// A run can hold at its first stage, before any stage completes, and at
// its last, after every other has.
func TestRuns_HoldRuleAtFirstAndLastStage(t *testing.T) {
	const interval = 10 * time.Millisecond
	_, _, c := startRules(t, interval, nil, []string{"first.txt:upload", "last.txt:embeddings"})
	first := uploadDoc(t, c, "first.txt")
	last := uploadDoc(t, c, "last.txt")
	awaitRun(t, c, last.RunID, failsafe, func(r run.Run) bool { return completed(r) == len(stageNames)-1 })
	// The unmatched run, uploaded after both, completing bounds the wait:
	// both held runs' schedules have passed every stage by then.
	ok := uploadDoc(t, c, "report.txt")
	awaitRun(t, c, ok.RunID, failsafe, func(r run.Run) bool { return r.Status == run.Complete })
	for name, want := range map[string]struct {
		id string
		at int
	}{"first.txt": {first.RunID, 0}, "last.txt": {last.RunID, len(stageNames) - 1}} {
		rn := readRun(t, c, want.id)
		if rn.Status != run.Running || completed(rn) != want.at || rn.Stages[want.at].State != run.Pending {
			t.Errorf("%s: run = %+v, want it held at stage %d with %d complete", name, rn, want.at+1, want.at)
		}
	}
}

// A name that matches a fail rule and a hold rule stops at the earlier of
// their two stages: a hold before the fail holds the run there, and it
// never fails; a fail before the hold fails the run there; and a fail and
// a hold at one stage fail the run.
func TestRuns_FailAndHoldRulesEarlierStageWins(t *testing.T) {
	const interval = 10 * time.Millisecond
	_, _, c := startRules(t, interval,
		[]string{"hold-first.txt:extraction", "fail-first.txt:metadata", "same.txt:chunks"},
		[]string{"hold-first.txt:metadata", "fail-first.txt:extraction", "same.txt:chunks"})
	holdFirst := uploadDoc(t, c, "hold-first.txt")
	failFirst := uploadDoc(t, c, "fail-first.txt")
	same := uploadDoc(t, c, "same.txt")
	_, ff := awaitRun(t, c, failFirst.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })
	_, sm := awaitRun(t, c, same.RunID, failsafe, func(r run.Run) bool { return r.Status != run.Running })
	if ff.Status != run.Failed || completed(ff) != 1 || ff.Stages[1].State != run.Faulted {
		t.Errorf("fail-first.txt: run = %+v, want it failed at metadata", ff)
	}
	if sm.Status != run.Failed || completed(sm) != 3 || sm.Stages[3].State != run.Faulted {
		t.Errorf("same.txt: run = %+v, want it failed at chunks", sm)
	}
	// same.txt's run reached its fourth stage, later than hold-first.txt's
	// second, which it was uploaded after.
	hf := readRun(t, c, holdFirst.RunID)
	if hf.Status != run.Running || completed(hf) != 1 || hf.Stages[1].State != run.Pending {
		t.Errorf("hold-first.txt: run = %+v, want it held at metadata, never failed", hf)
	}
}

// A malformed hold rule fails the run layer's construction, as a malformed
// fail rule does, so Run exits 1 naming the rule before anything reports
// ready.
func TestRuns_MalformedHoldRuleFailsStartup(t *testing.T) {
	for name, rule := range map[string]string{
		"no stage":      "held-*",
		"unknown stage": "held-*:indexing",
		"empty pattern": ":upload",
		"bad pattern":   "held-[:upload",
	} {
		t.Run(name, func(t *testing.T) {
			cfg := configtest.Config(t)
			cfg.Runs.Hold = []string{rule}
			var log syncBuffer
			a := newApp(t, cfg, &log)
			withMemoryBroker(a)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if code := a.Run(ctx); code != 1 {
				t.Errorf("Run = %d, want 1", code)
			}
			if out := log.String(); !strings.Contains(out, "hold rule") || strings.Contains(out, "server ready") {
				t.Errorf("log = %q, want a failure naming the hold rule and no ready record", out)
			}
		})
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
