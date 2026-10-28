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
			Name     string `json:"name"`
			Position int    `json:"position"`
			State    string `json:"state"`
		} `json:"stages"`
	}
	stageData struct {
		Stage      string `json:"stage"`
		Position   int    `json:"position"`
		StageCount int    `json:"stage_count"`
		DocumentID string `json:"document_id"`
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
