package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"
	"uuid"

	"github.com/standards-lab/go-core/event"
	"github.com/standards-lab/go-core/reactor"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-web-sdk"
)

// Config is the layer's configuration: how long each stage takes, the
// source its stage events name, and the namespace of their type, the
// broker's prefix.
type Config struct {
	Interval time.Duration
	Source   string
	Prefix   string
}

// Service is the run layer: the store of every run and the advance that
// completes their stages. It is safe for concurrent use.
type Service struct {
	interval time.Duration
	source   string
	typ      string
	pub      messaging.Publisher
	logger   *slog.Logger
	wake     *reactor.Waker

	mu    sync.Mutex
	byID  map[string]*record
	order []*record // in creation order, the order a listing reads
}

// record is one run as the store holds it: completed holds the completion
// time of each stage completed so far, in order.
type record struct {
	id         string
	documentID string
	created    time.Time
	completed  []time.Time
}

// New returns the layer's service, publishing its stage events through pub
// and logging a failed publish through logger. A non-positive interval, an
// empty source, or a prefix under which the stage event's type is not one a
// broker routes is an error.
func New(cfg Config, pub messaging.Publisher, logger *slog.Logger) (*Service, error) {
	typ := cfg.Prefix + "." + StageCompleted
	var errs []error
	if cfg.Interval <= 0 {
		errs = append(errs, fmt.Errorf("interval must be positive, got %s", cfg.Interval))
	}
	if cfg.Source == "" {
		errs = append(errs, errors.New("source is required"))
	}
	if err := messaging.CheckType(typ); err != nil {
		errs = append(errs, fmt.Errorf("prefix %q: %w", cfg.Prefix, err))
	}
	if err := errors.Join(errs...); err != nil {
		return nil, fmt.Errorf("run: %w", err)
	}
	return &Service{
		interval: cfg.Interval,
		source:   cfg.Source,
		typ:      typ,
		pub:      pub,
		logger:   logger,
		// A fifth of the interval bounds how late a due stage completes;
		// the nudge from Start makes a run's first stage prompt.
		wake: reactor.Wake(max(cfg.Interval/5, time.Millisecond)),
		byID: map[string]*record{},
	}, nil
}

// Start starts a run for the document documentID, every stage pending, and
// nudges the advance, which completes its first stage as soon as it is
// free.
func (s *Service) Start(documentID string) Run {
	rec := &record{id: uuid.NewV7().String(), documentID: documentID, created: time.Now().UTC()}
	s.mu.Lock()
	s.byID[rec.id] = rec
	s.order = append(s.order, rec)
	r := rec.present()
	s.mu.Unlock()
	s.wake.Nudge()
	return r
}

// Run returns the run id, or [ErrNotFound].
func (s *Service) Run(id string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Run{}, ErrNotFound
	}
	return rec.present(), nil
}

// List returns the page of runs q addresses, oldest first, with their
// total. The one filter it takes is document, a document's id, which
// narrows the listing to that document's runs; any other filter, an
// operator, or a sort is a *web.QueryError.
func (s *Service) List(q web.Query) ([]Run, web.Paging, error) {
	if len(q.Sort) > 0 {
		return nil, web.Paging{}, &web.QueryError{Param: "sort", Value: q.Sort[0].Field, Reason: "runs list in creation order only"}
	}
	document := ""
	for _, f := range q.Filters {
		if f.Field != "document" || f.Op != "" || len(f.Values) != 1 {
			return nil, web.Paging{}, &web.QueryError{Param: f.Field, Value: first(f.Values), Reason: "the one filter is document, a document id"}
		}
		document = f.Values[0]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	var matched []*record
	for _, rec := range s.order {
		if document == "" || rec.documentID == document {
			matched = append(matched, rec)
		}
	}
	total := len(matched)
	from := min((q.Page-1)*q.Size, total)
	to := min(from+q.Size, total)
	items := make([]Run, 0, to-from)
	for _, rec := range matched[from:to] {
		items = append(items, rec.present())
	}
	return items, web.Paging{Total: &total, More: to < total}, nil
}

// first returns the first of values, or "".
func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

// Ticks is the source the advance's reactor runs: an interval a fifth of
// the stage interval, nudged by Start.
func (s *Service) Ticks() reactor.Source[time.Time] { return s.wake }

// due is one stage a pass completes.
type due struct {
	run        string
	documentID string
	position   int // 1-based
}

// Advance completes, for every run, the next stage when it is due: the
// first at once, and the kth k-1 stage intervals after the run started. It
// publishes each stage's event, then records the stage complete at the
// event's time. A failed publish is logged and leaves the
// stage pending for the next pass, so Advance itself never fails; it stops
// between stages once the reactor's drain begins.
func (s *Service) Advance(ctx context.Context, now time.Time) error {
	for _, d := range s.dueAt(now) {
		select {
		case <-reactor.Draining(ctx):
			return nil
		default:
		}
		at := time.Now().UTC()
		e, err := s.stageEvent(d, at)
		if err == nil {
			err = s.pub.Publish(ctx, e)
		}
		if err != nil {
			s.logger.Warn("stage event not published", "run", d.run, "stage", Stages[d.position-1], "error", err)
			continue
		}
		s.complete(d, at)
	}
	return nil
}

// dueAt lists the stages due at now, one per run at most, in creation
// order.
func (s *Service) dueAt(now time.Time) []due {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []due
	for _, rec := range s.order {
		n := len(rec.completed)
		if n == len(Stages) {
			continue
		}
		if now.Before(rec.created.Add(time.Duration(n) * s.interval)) {
			continue
		}
		out = append(out, due{run: rec.id, documentID: rec.documentID, position: n + 1})
	}
	return out
}

// complete records d's stage complete at at.
func (s *Service) complete(d due, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.byID[d.run]
	if len(rec.completed) == d.position-1 {
		rec.completed = append(rec.completed, at)
	}
}

// stageEvent is the event of d's stage completing at at. Its id is the
// run's id and the stage's position, the same on every attempt, so a
// broker drops the repeat of a publish that landed.
func (s *Service) stageEvent(d due, at time.Time) (event.Event, error) {
	data, err := json.Marshal(StageCompletedData{
		Stage:      Stages[d.position-1],
		Position:   d.position,
		StageCount: len(Stages),
		DocumentID: d.documentID,
	})
	if err != nil {
		return event.Event{}, err
	}
	return event.Event{
		ID:              d.run + "." + strconv.Itoa(d.position),
		Source:          s.source,
		Type:            s.typ,
		Subject:         d.run,
		DataContentType: "application/json",
		Time:            at,
		Data:            data,
	}, nil
}

// present is the run's read shape. The caller holds the service's mutex.
func (rec *record) present() Run {
	r := Run{ID: rec.id, DocumentID: rec.documentID, Status: Running, CreatedAt: rec.created, Stages: make([]Stage, len(Stages))}
	for i, name := range Stages {
		st := Stage{Name: name, Position: i + 1, State: Pending}
		if i < len(rec.completed) {
			st.State = Done
			st.CompletedAt = new(rec.completed[i])
		}
		r.Stages[i] = st
	}
	if len(rec.completed) == len(Stages) {
		r.Status = Complete
		r.CompletedAt = new(rec.completed[len(Stages)-1])
	}
	return r
}
