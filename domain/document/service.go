package document

import (
	"fmt"
	"io"
	"strconv"
	"sync"
	"time"
	"uuid"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/domain/run"
)

// Starter starts a run for an accepted document and returns it.
type Starter interface {
	Start(documentID string) run.Run
}

// Service is the document layer: the store of every accepted document. It
// is safe for concurrent use.
type Service struct {
	runs Starter

	mu    sync.Mutex
	byID  map[string]*record
	order []*record // in acceptance order, the order a listing reads
}

// record is one document as the store holds it.
type record struct {
	doc   Document
	bytes []byte
}

// New returns the layer's service, starting a run through runs for each
// document it accepts.
func New(runs Starter) *Service {
	return &Service{runs: runs, byID: map[string]*record{}}
}

// Upload reads u's body whole and stores it as the document name, then
// starts its run. A body that ends before its declared size, or fails to
// read, is a *web.BodyError, and nothing is stored.
func (s *Service) Upload(name string, u web.Upload) (Document, error) {
	b, err := io.ReadAll(u.Body)
	if err != nil {
		return Document{}, &web.BodyError{Reason: fmt.Sprintf("read the upload: %v", err)}
	}
	if int64(len(b)) != u.Size {
		return Document{}, &web.BodyError{Reason: fmt.Sprintf("the body held %d bytes, not the declared %d", len(b), u.Size)}
	}
	doc := Document{
		ID:          uuid.NewV7().String(),
		Name:        name,
		ContentType: u.ContentType,
		Size:        u.Size,
		CreatedAt:   time.Now().UTC(),
	}
	// The run starts before the document is visible, so no read sees a
	// document without its run.
	doc.RunID = s.runs.Start(doc.ID).ID
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := &record{doc: doc, bytes: b}
	s.byID[doc.ID] = rec
	s.order = append(s.order, rec)
	return doc, nil
}

// Document returns the document id, or [ErrNotFound].
func (s *Service) Document(id string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Document{}, ErrNotFound
	}
	return rec.doc, nil
}

// List returns the page of documents q addresses, oldest first, with their
// total. It takes no filter and no sort; either is a *web.QueryError.
func (s *Service) List(q web.Query) ([]Document, web.Paging, error) {
	if len(q.Sort) > 0 {
		return nil, web.Paging{}, &web.QueryError{Param: "sort", Value: q.Sort[0].Field, Reason: "documents list in upload order only"}
	}
	if len(q.Filters) > 0 {
		f := q.Filters[0]
		value := ""
		if len(f.Values) > 0 {
			value = f.Values[0]
		}
		return nil, web.Paging{}, &web.QueryError{Param: f.Field, Value: value, Reason: "documents take no filter"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	total := len(s.order)
	from := min((q.Page-1)*q.Size, total)
	to := min(from+q.Size, total)
	items := make([]Document, 0, to-from)
	for _, rec := range s.order[from:to] {
		items = append(items, rec.doc)
	}
	return items, web.Paging{Total: &total, More: to < total}, nil
}

// Content returns the document id's bytes as the download serves them, or
// [ErrNotFound]. Its entity tag is the document's id: a document's bytes
// never change.
func (s *Service) Content(id string) (Content, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.byID[id]
	if !ok {
		return Content{}, ErrNotFound
	}
	return Content{
		Name: rec.doc.Name,
		Object: web.Object{
			ContentType: rec.doc.ContentType,
			Size:        rec.doc.Size,
			ETag:        strconv.Quote(rec.doc.ID),
			ModifiedAt:  rec.doc.CreatedAt,
		},
		Bytes: rec.bytes,
	}, nil
}
