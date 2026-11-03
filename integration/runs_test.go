//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/standards-lab/go-core/event"
	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/integration"
)

// The read shapes these cases decode, as the API writes them.
type (
	documentBody struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		ContentType string `json:"content_type"`
		Size        int64  `json:"size"`
		RunID       string `json:"run_id"`
	}
	runBody struct {
		ID         string `json:"id"`
		DocumentID string `json:"document_id"`
		Status     string `json:"status"`
		Stages     []struct {
			Name        string     `json:"name"`
			Position    int        `json:"position"`
			State       string     `json:"state"`
			CompletedAt *time.Time `json:"completed_at"`
			FailedAt    *time.Time `json:"failed_at"`
			Reason      *string    `json:"reason"`
		} `json:"stages"`
		CompletedAt *time.Time `json:"completed_at"`
	}
	stageData struct {
		Stage      string `json:"stage"`
		Position   int    `json:"position"`
		StageCount int    `json:"stage_count"`
		DocumentID string `json:"document_id"`
	}
	failedData struct {
		Stage      string `json:"stage"`
		Position   int    `json:"position"`
		StageCount int    `json:"stage_count"`
		DocumentID string `json:"document_id"`
		Reason     string `json:"reason"`
	}
)

// stageNames is the order a run's stages pass in.
var stageNames = []string{"upload", "metadata", "extraction", "chunks", "embeddings"}

// jetStream connects to the service's embedded server with the token and
// returns its JetStream context; the connection closes with the test.
func jetStream(t *testing.T, s *integration.Service) jetstream.JetStream {
	t.Helper()
	nc, err := natsgo.Connect(s.NATSURL(), natsgo.Token(integration.Token), natsgo.Timeout(2*time.Second))
	if err != nil {
		t.Fatalf("connect to the embedded server: %v", err)
	}
	t.Cleanup(nc.Close)
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatalf("jetstream: %v", err)
	}
	return js
}

// The stream the broker owns is provisioned on the embedded server: the
// default name, capturing the default prefix, on file storage.
func TestRuns_StreamProvisioned(t *testing.T) {
	s := integration.Start(t, integration.Options{})
	js := jetStream(t, s)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := js.Stream(ctx, "EMULATOR")
	if err != nil {
		t.Fatalf("stream EMULATOR: %v", err)
	}
	got := stream.CachedInfo().Config
	if want := []string{"emulator.>"}; !slices.Equal(got.Subjects, want) {
		t.Errorf("stream subjects = %q, want %q", got.Subjects, want)
	}
	if got.Storage != jetstream.FileStorage {
		t.Errorf("stream storage = %v, want file", got.Storage)
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
}

// An upload to the binary starts a run that completes, and the stream holds
// its five stage events in order, each a binary-mode CloudEvent of type
// emulator.run.stage on that subject, with the run's id as its subject, the
// configured instance as its source, and data naming the stage, its
// position, the stage count, and the document.
func TestRuns_UploadRunsToStageEventsOnStream(t *testing.T) {
	s := integration.Start(t, integration.Options{Env: []string{
		"EMULATOR_RUNS_STAGE_INTERVAL=50ms",
		"EMULATOR_RUNS_INSTANCE=itest",
	}})
	c := s.Client()

	doc := webtest.Decode[documentBody](t, c.Post(t, "/api/documents?name=brief.txt",
		webtest.Raw{ContentType: "text/plain", Body: []byte("the capstone's brief")}), http.StatusCreated)
	if doc.Name != "brief.txt" || doc.ContentType != "text/plain" || doc.Size != 20 || doc.RunID == "" {
		t.Fatalf("upload = %+v", doc)
	}

	var r runBody
	s.Await(t, "run complete", func() bool {
		r = webtest.Decode[runBody](t, c.Get(t, "/api/runs/"+doc.RunID), http.StatusOK)
		return r.Status == "complete"
	})
	if r.DocumentID != doc.ID || len(r.Stages) != len(stageNames) {
		t.Fatalf("run = %+v, want document %s with %d stages", r, doc.ID, len(stageNames))
	}

	js := jetStream(t, s)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cons, err := js.OrderedConsumer(ctx, "EMULATOR", jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{"emulator.run.stage"},
	})
	if err != nil {
		t.Fatalf("ordered consumer: %v", err)
	}
	batch, err := cons.Fetch(len(stageNames)+1, jetstream.FetchMaxWait(time.Second))
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	var events []event.Event
	for msg := range batch.Messages() {
		if msg.Subject() != "emulator.run.stage" {
			t.Errorf("message subject = %q, want emulator.run.stage", msg.Subject())
		}
		e, err := event.Decode(event.Header(msg.Headers()), msg.Data())
		if err != nil {
			t.Fatalf("decode message: %v", err)
		}
		events = append(events, e)
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch: %v", err)
	}
	if len(events) != len(stageNames) {
		t.Fatalf("stream holds %d stage events, want %d", len(events), len(stageNames))
	}
	for i, e := range events {
		t.Logf("event %d: type=%s subject=%s source=%s time=%s data=%s", i+1, e.Type, e.Subject, e.Source, e.Time.Format(time.RFC3339Nano), e.Data)
		if e.Type != "emulator.run.stage" || e.Subject != doc.RunID || e.Source != "/emulator/itest" {
			t.Errorf("event %d = type %q, subject %q, source %q; want emulator.run.stage, %s, /emulator/itest", i, e.Type, e.Subject, e.Source, doc.RunID)
		}
		var data stageData
		if err := json.Unmarshal(e.Data, &data); err != nil {
			t.Fatalf("event %d data %s: %v", i, e.Data, err)
		}
		if want := (stageData{stageNames[i], i + 1, len(stageNames), doc.ID}); data != want {
			t.Errorf("event %d data = %+v, want %+v", i, data, want)
		}
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
}

// Under a fail rule set by EMULATOR_RUNS_FAIL, an upload whose name
// matches starts a run that ends failed at the rule's stage, and the API
// and the stream agree: the run reads failed, its first two stages
// complete, extraction failed with the rule's reason, and the rest
// pending; the stream holds its two stage events, then one
// emulator.run.failed event on that subject, at the stage's failure time,
// with data naming the stage, its position, the stage count, the document,
// and the same reason, and nothing more for the run. An upload no rule
// matches, beside it, completes with its five stage events as before.
func TestRuns_FailRuleEndsRunFailedOnAPIAndStream(t *testing.T) {
	s := integration.Start(t, integration.Options{Env: []string{
		"EMULATOR_RUNS_STAGE_INTERVAL=50ms",
		"EMULATOR_RUNS_INSTANCE=itest",
		"EMULATOR_RUNS_FAIL=fail-at-*:extraction",
	}})
	c := s.Client()

	failing := webtest.Decode[documentBody](t, c.Post(t, "/api/documents?name=fail-at-extraction.txt",
		webtest.Raw{ContentType: "text/plain", Body: []byte("a document that fails")}), http.StatusCreated)
	normal := webtest.Decode[documentBody](t, c.Post(t, "/api/documents?name=brief.txt",
		webtest.Raw{ContentType: "text/plain", Body: []byte("the capstone's brief")}), http.StatusCreated)

	var fr, nr runBody
	s.Await(t, "both runs ended", func() bool {
		fr = webtest.Decode[runBody](t, c.Get(t, "/api/runs/"+failing.RunID), http.StatusOK)
		nr = webtest.Decode[runBody](t, c.Get(t, "/api/runs/"+normal.RunID), http.StatusOK)
		return fr.Status != "running" && nr.Status != "running"
	})
	if nr.Status != "complete" {
		t.Errorf("unmatched run status = %q, want complete", nr.Status)
	}
	if fr.Status != "failed" || fr.CompletedAt != nil || len(fr.Stages) != len(stageNames) {
		t.Fatalf("failing run = %+v, want it failed with no completion time", fr)
	}
	const reason = `emulated failure: the document's name matches the fail rule "fail-at-*:extraction"`
	wantStates := []string{"complete", "complete", "failed", "pending", "pending"}
	for i, st := range fr.Stages {
		if st.State != wantStates[i] {
			t.Errorf("stage %s state = %q, want %q", st.Name, st.State, wantStates[i])
		}
	}
	failed := fr.Stages[2]
	if failed.Name != "extraction" || failed.FailedAt == nil || failed.Reason == nil || *failed.Reason != reason || failed.CompletedAt != nil {
		t.Fatalf("failed stage = %+v, want extraction failed with reason %q", failed, reason)
	}

	js := jetStream(t, s)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cons, err := js.OrderedConsumer(ctx, "EMULATOR", jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{"emulator.run.>"},
	})
	if err != nil {
		t.Fatalf("ordered consumer: %v", err)
	}
	// Two stage events and the failure, and the other run's five; one more
	// asked for, which a correct emulator never publishes.
	batch, err := cons.Fetch(3+len(stageNames)+1, jetstream.FetchMaxWait(time.Second))
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	byRun := map[string][]event.Event{}
	for msg := range batch.Messages() {
		e, err := event.Decode(event.Header(msg.Headers()), msg.Data())
		if err != nil {
			t.Fatalf("decode message: %v", err)
		}
		if msg.Subject() != e.Type {
			t.Errorf("message subject = %q, want the event's type %q", msg.Subject(), e.Type)
		}
		byRun[e.Subject] = append(byRun[e.Subject], e)
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch: %v", err)
	}
	if got := byRun[normal.RunID]; len(got) != len(stageNames) {
		t.Errorf("unmatched run has %d events, want its %d stage events", len(got), len(stageNames))
	}
	events := byRun[failing.RunID]
	if len(events) != 3 {
		t.Fatalf("failing run has %d events, want two stage events and the failure: %+v", len(events), events)
	}
	for i, e := range events[:2] {
		var data stageData
		if err := json.Unmarshal(e.Data, &data); err != nil {
			t.Fatalf("stage event %d data %s: %v", i, e.Data, err)
		}
		if want := (stageData{stageNames[i], i + 1, len(stageNames), failing.ID}); e.Type != "emulator.run.stage" || data != want {
			t.Errorf("event %d = type %q, data %+v; want emulator.run.stage, %+v", i, e.Type, data, want)
		}
	}
	f := events[2]
	t.Logf("failure event: id=%s type=%s subject=%s source=%s time=%s data=%s", f.ID, f.Type, f.Subject, f.Source, f.Time.Format(time.RFC3339Nano), f.Data)
	if f.Type != "emulator.run.failed" || f.Source != "/emulator/itest" || !f.Time.Equal(*failed.FailedAt) {
		t.Errorf("failure event = type %q, source %q, time %s; want emulator.run.failed, /emulator/itest, the stage's failure %s", f.Type, f.Source, f.Time, failed.FailedAt)
	}
	var data failedData
	if err := json.Unmarshal(f.Data, &data); err != nil {
		t.Fatalf("failure event data %s: %v", f.Data, err)
	}
	if want := (failedData{"extraction", 3, len(stageNames), failing.ID, reason}); data != want {
		t.Errorf("failure event data = %+v, want %+v", data, want)
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
}
