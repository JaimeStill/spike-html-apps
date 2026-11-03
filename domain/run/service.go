package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"uuid"

	"github.com/standards-lab/go-core/event"
	"github.com/standards-lab/go-core/reactor"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-web-sdk"
)

// Config is the layer's configuration: how long each stage takes, the
// source its stage events name, the namespace of their type, the broker's
// prefix, and the fail and hold rules.
//
// Fail is the emulator's test seam for a failed run, configuration and not
// client API: each rule is <pattern>:<stage>, a path.Match pattern over the
// document's name and one of [Stages]. A run whose document's name matches
// a rule, the first that matches in order, fails at that rule's stage
// instead of completing it, so a test uploads fail-at-extraction.txt under
// the rule fail-at-*:extraction. The stage is the text after the last ':',
// so a pattern may hold one.
//
// Hold is the emulator's test seam for a run under way, configuration and
// not client API, its rules written as Fail's are. A run whose document's
// name matches a rule, the first that matches in order, holds at that
// rule's stage: the stages before it complete and publish their events as
// any run's do, and the held stage is never completed, failed, or
// published, so the run stays [Running] with that stage the first
// [Pending] one, the stage a reader shows under way (the layer publishes
// no event for a stage's start), for as long as the process runs. Nothing
// releases a hold, so a test uploads held-brief.txt under the rule
// held-*:extraction to read a run mid-way for as long as it needs. A name
// that matches a fail rule and a hold rule stops at the earlier of their
// two stages, failing there or holding there; at one stage, it fails.
type Config struct {
	Interval time.Duration
	Source   string
	Prefix   string
	Fail     []string
	Hold     []string
}

// Service is the run layer: the store of every run and the advance that
// completes their stages. It is safe for concurrent use.
type Service struct {
	interval time.Duration
	source   string
	typ      string
	failType string
	rules    []stageRule
	holds    []stageRule
	pub      messaging.Publisher
	logger   *slog.Logger
	wake     *reactor.Waker

	mu    sync.Mutex
	byID  map[string]*record
	order []*record // in creation order, the order a listing reads
}

// record is one run as the store holds it: completed holds the completion
// time of each stage completed so far, in order; fail is the fail rule the
// run's document matched, or nil, and failed the time the stage after the
// completed ones failed, once it has; hold is the 1-based position of the
// stage the run holds at, or 0.
type record struct {
	id         string
	documentID string
	created    time.Time
	completed  []time.Time
	fail       *stageRule
	failed     *time.Time
	hold       int
}

// stageRule is one of [Config.Fail]'s or [Config.Hold]'s rules, parsed:
// the rule as configured, its pattern, and its stage's 1-based position.
type stageRule struct {
	rule     string
	pattern  string
	position int
}

// parseRules parses rules, each a kind rule ("fail" or "hold"),
// <pattern>:<stage>: the pattern must be a well-formed path.Match pattern,
// not empty, and the stage one of [Stages]. Each malformed rule is an
// error naming its kind.
func parseRules(kind string, rules []string) ([]stageRule, error) {
	out := make([]stageRule, 0, len(rules))
	var errs []error
	for _, rule := range rules {
		i := strings.LastIndexByte(rule, ':')
		if i < 0 {
			errs = append(errs, fmt.Errorf("%s rule %q: want <pattern>:<stage>", kind, rule))
			continue
		}
		pattern, stage := rule[:i], rule[i+1:]
		if pattern == "" {
			errs = append(errs, fmt.Errorf("%s rule %q: the pattern is empty", kind, rule))
			continue
		}
		if _, err := path.Match(pattern, ""); err != nil {
			errs = append(errs, fmt.Errorf("%s rule %q: %w", kind, rule, err))
			continue
		}
		k := slices.Index(Stages, stage)
		if k < 0 {
			errs = append(errs, fmt.Errorf("%s rule %q: stage %q is not one of %s", kind, rule, stage, strings.Join(Stages, ", ")))
			continue
		}
		out = append(out, stageRule{rule: rule, pattern: pattern, position: k + 1})
	}
	return out, errors.Join(errs...)
}

// match returns the first of rules whose pattern matches name, or nil.
func match(rules []stageRule, name string) *stageRule {
	for i := range rules {
		if ok, _ := path.Match(rules[i].pattern, name); ok {
			return &rules[i]
		}
	}
	return nil
}

// reason is why a run under the fail rule fails, the failed stage's
// reason.
func (f *stageRule) reason() string {
	return fmt.Sprintf("emulated failure: the document's name matches the fail rule %q", f.rule)
}

// New returns the layer's service, publishing its stage and failure
// events through pub and logging a failed publish through logger. A
// non-positive interval, an empty source, a prefix under which the stage
// event's type is not one a broker routes (the failure event's type
// differs only in a last segment as plain), or a malformed fail or hold
// rule is an error.
func New(cfg Config, pub messaging.Publisher, logger *slog.Logger) (*Service, error) {
	typ := cfg.Prefix + "." + StageCompleted
	rules, failErr := parseRules("fail", cfg.Fail)
	holds, holdErr := parseRules("hold", cfg.Hold)
	errs := []error{failErr, holdErr}
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
		failType: cfg.Prefix + "." + RunFailed,
		rules:    rules,
		holds:    holds,
		pub:      pub,
		logger:   logger,
		// A fifth of the interval bounds how late a due stage completes;
		// the nudge from Start makes a run's first stage prompt.
		wake: reactor.Wake(max(cfg.Interval/5, time.Millisecond)),
		byID: map[string]*record{},
	}, nil
}

// Start starts a run for the document documentID, named name, every stage
// pending, and nudges the advance, which completes its first stage as soon
// as it is free. The first fail rule whose pattern matches name sets the
// stage the run fails at, and the first hold rule's the stage it holds at;
// of the two, the earlier stage stops the run, and at one stage the fail
// does.
func (s *Service) Start(documentID, name string) Run {
	rec := &record{id: uuid.NewV7().String(), documentID: documentID, created: time.Now().UTC()}
	rec.fail = match(s.rules, name)
	if h := match(s.holds, name); h != nil && (rec.fail == nil || h.position < rec.fail.position) {
		rec.fail, rec.hold = nil, h.position
	}
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

// due is one stage a pass completes, or fails under fail.
type due struct {
	run        string
	documentID string
	position   int // 1-based
	fail       *stageRule
}

// Advance completes, for every run, the next stage when it is due: the
// first at once, and the kth k-1 stage intervals after the run started. It
// publishes each stage's event, then records the stage complete at the
// event's time. A stage its run's fail rule names fails instead: Advance
// publishes the run's failure event, then records the stage failed at the
// event's time, and the run advances no further. A stage its run's hold
// rule names is never due: Advance publishes nothing for it and records
// nothing, so the run stays running there. A failed publish is logged and
// leaves the stage pending for the next pass, so Advance itself never
// fails; it stops between stages once the reactor's drain begins.
func (s *Service) Advance(ctx context.Context, now time.Time) error {
	for _, d := range s.dueAt(now) {
		select {
		case <-reactor.Draining(ctx):
			return nil
		default:
		}
		at := time.Now().UTC()
		e, err := s.event(d, at)
		if err == nil {
			err = s.pub.Publish(ctx, e)
		}
		if err != nil {
			s.logger.Warn("stage event not published", "run", d.run, "stage", Stages[d.position-1], "error", err)
			continue
		}
		s.record(d, at)
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
		if n == len(Stages) || rec.failed != nil || rec.hold == n+1 {
			continue
		}
		if now.Before(rec.created.Add(time.Duration(n) * s.interval)) {
			continue
		}
		d := due{run: rec.id, documentID: rec.documentID, position: n + 1}
		if rec.fail != nil && rec.fail.position == d.position {
			d.fail = rec.fail
		}
		out = append(out, d)
	}
	return out
}

// record records d's stage complete at at, or failed under its fail rule.
func (s *Service) record(d due, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.byID[d.run]
	if len(rec.completed) != d.position-1 || rec.failed != nil {
		return
	}
	if d.fail != nil {
		rec.failed = &at
		return
	}
	rec.completed = append(rec.completed, at)
}

// event is the event of d's stage completing at at, or of its run failing
// there. A stage event's id is the run's id and the stage's position, and
// a failure event's the run's id and "failed", each the same on every
// attempt, so a broker drops the repeat of a publish that landed.
func (s *Service) event(d due, at time.Time) (event.Event, error) {
	stage := StageCompletedData{
		Stage:      Stages[d.position-1],
		Position:   d.position,
		StageCount: len(Stages),
		DocumentID: d.documentID,
	}
	id, typ := d.run+"."+strconv.Itoa(d.position), s.typ
	var v any = stage
	if d.fail != nil {
		id, typ = d.run+".failed", s.failType
		v = RunFailedData{
			Stage:      stage.Stage,
			Position:   stage.Position,
			StageCount: stage.StageCount,
			DocumentID: stage.DocumentID,
			Reason:     d.fail.reason(),
		}
	}
	data, err := json.Marshal(v)
	if err != nil {
		return event.Event{}, err
	}
	return event.Event{
		ID:              id,
		Source:          s.source,
		Type:            typ,
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
		switch {
		case i < len(rec.completed):
			st.State = Done
			st.CompletedAt = new(rec.completed[i])
		case i == len(rec.completed) && rec.failed != nil:
			st.State = Faulted
			st.FailedAt = new(*rec.failed)
			st.Reason = new(rec.fail.reason())
		}
		r.Stages[i] = st
	}
	switch {
	case rec.failed != nil:
		r.Status = Failed
	case len(rec.completed) == len(Stages):
		r.Status = Complete
		r.CompletedAt = new(rec.completed[len(Stages)-1])
	}
	return r
}
