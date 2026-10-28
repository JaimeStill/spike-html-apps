package document

import (
	"errors"
	"time"

	"github.com/standards-lab/go-web-sdk"
)

// ErrNotFound reports a document id the store does not hold; the handler
// maps it to a 404.
var ErrNotFound = errors.New("document not found")

// ErrValidation classifies an input rejection; wrapped with its reason, it
// reaches the wire as a 400's detail.
var ErrValidation = errors.New("invalid upload")

// Document is one uploaded document, as the API presents it: its name and
// content type as the upload declared them, its size in bytes, when it was
// accepted, and the run its upload started.
type Document struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
	RunID       string    `json:"run_id"`
}

// Content is a document as the download serves it: its name, for the
// attachment's filename; the object's description, which answers a
// revalidation alone; and its bytes.
type Content struct {
	Name   string
	Object web.Object
	Bytes  []byte
}
