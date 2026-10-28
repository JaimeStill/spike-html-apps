package conversation

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
	"uuid"

	"github.com/standards-lab/go-web-sdk"
)

// Config is the layer's configuration: the pause before each text delta of
// a reply, and the grace a reply's write deadline allows beyond the
// script's duration, the server's write timeout. A zero grace, for a server
// whose write timeout is disabled, leaves the deadline alone.
type Config struct {
	Interval time.Duration
	Grace    time.Duration
}

// Service is the conversation layer: the store of every conversation, and
// the stream writer both routes answer with. It is safe for concurrent use.
type Service struct {
	interval time.Duration
	grace    time.Duration

	mu    sync.Mutex
	byID  map[string]*record
	order []*record // in creation order, the order a listing reads
}

// record is one conversation as the store holds it.
type record struct {
	id      string
	created time.Time
	history []Item
}

// New returns the layer's service. A non-positive interval, or a negative
// grace, is an error.
func New(cfg Config) (*Service, error) {
	var errs []error
	if cfg.Interval <= 0 {
		errs = append(errs, fmt.Errorf("interval must be positive, got %s", cfg.Interval))
	}
	if cfg.Grace < 0 {
		errs = append(errs, fmt.Errorf("grace must not be negative, got %s", cfg.Grace))
	}
	if err := errors.Join(errs...); err != nil {
		return nil, fmt.Errorf("conversation: %w", err)
	}
	return &Service{interval: cfg.Interval, grace: cfg.Grace, byID: map[string]*record{}}, nil
}

// Create starts a conversation with an empty history.
func (s *Service) Create() Conversation {
	rec := &record{id: uuid.NewV7().String(), created: time.Now().UTC()}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byID[rec.id] = rec
	s.order = append(s.order, rec)
	return rec.present()
}

// Conversation returns the conversation id, or [ErrNotFound].
func (s *Service) Conversation(id string) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	return rec.present(), nil
}

// List returns the page of conversations q addresses, oldest first, with
// their total. A filter, an operator, or a sort is a *web.QueryError.
func (s *Service) List(q web.Query) ([]Conversation, web.Paging, error) {
	if len(q.Sort) > 0 {
		return nil, web.Paging{}, &web.QueryError{Param: "sort", Value: q.Sort[0].Field, Reason: "conversations list in creation order only"}
	}
	if len(q.Filters) > 0 {
		f := q.Filters[0]
		value := ""
		if len(f.Values) > 0 {
			value = f.Values[0]
		}
		return nil, web.Paging{}, &web.QueryError{Param: f.Field, Value: value, Reason: "conversations take no filter"}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	total := len(s.order)
	from := min((q.Page-1)*q.Size, total)
	to := min(from+q.Size, total)
	items := make([]Conversation, 0, to-from)
	for _, rec := range s.order[from:to] {
		items = append(items, rec.present())
	}
	return items, web.Paging{Total: &total, More: to < total}, nil
}

// post adds the user's message of text to the conversation id and returns
// the reply that answers it: its input is the whole history, the message
// included, and it takes the failure path when text is exactly [Trigger].
// Blank text is an [ErrValidation], and an unknown id [ErrNotFound].
func (s *Service) post(id, text string) (reply, error) {
	if strings.TrimSpace(text) == "" {
		return reply{}, fmt.Errorf("%w: the text must not be blank", ErrValidation)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return reply{}, ErrNotFound
	}
	rec.history = append(rec.history, userMessage(text))
	input := 0
	for _, it := range rec.history {
		for _, p := range it.Content {
			input += tokens(p.Text)
		}
	}
	return reply{model: Model, inputTokens: input, fail: text == Trigger}, nil
}

// complete adds item, a reply streamed whole, to the conversation id's
// history.
func (s *Service) complete(id string, item Item) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rec, ok := s.byID[id]; ok {
		rec.history = append(rec.history, item)
	}
}

// present is the conversation's read shape, its history a copy. The caller
// holds the service's mutex.
func (rec *record) present() Conversation {
	history := slices.Clone(rec.history)
	if history == nil {
		history = []Item{}
	}
	return Conversation{ID: rec.id, CreatedAt: rec.created, History: history}
}
