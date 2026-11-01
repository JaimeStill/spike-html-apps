package run

import (
	"errors"
	"time"
)

// ErrNotFound reports a run id the store does not hold; the handler maps
// it to a 404.
var ErrNotFound = errors.New("run not found")

// Stages names a run's stages in the order it passes through them.
var Stages = []string{"upload", "metadata", "extraction", "chunks", "embeddings"}

// Run is one pipeline run, as the API presents it: the document it runs
// for, its status, and each of [Stages] in order with its state.
// CompletedAt is set once the last stage completes; a failed run never
// completes, so it keeps CompletedAt null and its failed stage says when
// and why it failed.
type Run struct {
	ID          string     `json:"id"`
	DocumentID  string     `json:"document_id"`
	Status      Status     `json:"status"`
	Stages      []Stage    `json:"stages"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

// Status is a run's place in its stages.
type Status string

// The run statuses.
const (
	// Running is a run with a stage still pending.
	Running Status = "running"
	// Complete is a run whose every stage is complete.
	Complete Status = "complete"
	// Failed is a run one of whose stages failed: the stages before it
	// are complete, the stages after it pending, and none of them ever
	// advances.
	Failed Status = "failed"
)

// Stage is one stage of a run: its name, its 1-based position, its state,
// and, once complete, when it completed, or, once failed, when it failed
// and why. Each time and the reason is null until the stage reaches its
// state.
type Stage struct {
	Name        string     `json:"name"`
	Position    int        `json:"position"`
	State       StageState `json:"state"`
	CompletedAt *time.Time `json:"completed_at"`
	FailedAt    *time.Time `json:"failed_at"`
	Reason      *string    `json:"reason"`
}

// StageState is a stage's progress.
type StageState string

// The stage states.
const (
	// Pending is a stage not yet completed.
	Pending StageState = "pending"
	// Done is a completed stage, whose event the broker holds.
	Done StageState = "complete"
	// Faulted is a failed stage, whose [RunFailed] event the broker
	// holds; it is the last stage its run passes.
	Faulted StageState = "failed"
)

// StageCompleted is the stage event's type below the configured prefix: a
// run's every stage event has the type <prefix>.run.stage.
const StageCompleted = "run.stage"

// StageCompletedData is the data of a stage event: the stage completed,
// its 1-based position among the run's stages, how many stages the run
// has, and the document the run is for. The event's subject is the run's
// id, and its time the stage's completion.
type StageCompletedData struct {
	Stage      string `json:"stage"`
	Position   int    `json:"position"`
	StageCount int    `json:"stage_count"`
	DocumentID string `json:"document_id"`
}

// RunFailed is the failure event's type below the configured prefix: a
// run's failure publishes one event of type <prefix>.run.failed, a subject
// of its own, so a reader of the stage events alone never counts a failed
// stage complete.
const RunFailed = "run.failed"

// RunFailedData is the data of a failure event: the stage events' data,
// naming the stage that failed, with the reason it failed. The event's
// subject is the run's id, and its time the stage's failure.
type RunFailedData struct {
	Stage      string `json:"stage"`
	Position   int    `json:"position"`
	StageCount int    `json:"stage_count"`
	DocumentID string `json:"document_id"`
	Reason     string `json:"reason"`
}
