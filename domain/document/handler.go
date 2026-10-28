package document

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/standards-lab/go-web-sdk"
)

// handler binds the layer's endpoints to its service under the injected
// paging policy and upload transfer. Every handler returns its error; the
// group's writer maps it to a problem.
type handler struct {
	service *Service
	limits  web.Limits
	files   web.Transfer
}

// Routes builds the layer's route group, /documents: the upload, the
// listing, the read by id, and the content. limits is the listing's paging
// policy; files sizes an upload's limit and the deadlines of an upload and
// a download; and logger records the cause of every 5xx the group's error
// writer sends.
func Routes(service *Service, limits web.Limits, files web.Transfer, logger *slog.Logger) *web.Group {
	h := &handler{service: service, limits: limits, files: files}
	g := web.NewGroup("/documents")
	g.SetErrorWriter(web.NewErrorWriter(logger, status))
	g.HandleErr("POST", "", h.upload)
	g.HandleErr("GET", "", h.list)
	g.HandleErr("GET", "/{id}", h.document)
	g.HandleErr("GET", "/{id}/content", h.content)
	return g
}

// upload reads the required name query parameter, then the body by its
// headers, refused before any byte is read when they do not admit it. Any
// well-formed media type is accepted: the download never renders the
// bytes. The Location is the new document's read.
func (h *handler) upload(w http.ResponseWriter, r *http.Request) error {
	name := r.URL.Query().Get("name")
	if name == "" {
		return fmt.Errorf("%w: the name query parameter is required", ErrValidation)
	}
	upload, err := web.ReadUpload(w, r, h.files.Limit())
	if err != nil {
		return err
	}
	if err := h.files.WidenUpload(w, r); err != nil {
		return err
	}
	doc, err := h.service.Upload(name, upload)
	if err != nil {
		return err
	}
	w.Header().Set("Location", r.URL.Path+"/"+doc.ID)
	return web.WriteJSON(w, http.StatusCreated, doc)
}

func (h *handler) list(w http.ResponseWriter, r *http.Request) error {
	q, err := web.ParseQuery(r.URL.Query(), h.limits)
	if err != nil {
		return err
	}
	items, paging, err := h.service.List(q)
	if err != nil {
		return err
	}
	return web.WriteJSON(w, http.StatusOK, web.NewPage(items, q, paging))
}

func (h *handler) document(w http.ResponseWriter, r *http.Request) error {
	id, err := web.PathUUID(r, "id")
	if err != nil {
		return err
	}
	doc, err := h.service.Document(id)
	if err != nil {
		return err
	}
	return web.WriteJSON(w, http.StatusOK, doc)
}

// content serves the document's bytes under the content type it was
// uploaded with, as an attachment: user content is never rendered inline,
// since stored HTML would run in the API's origin. A client revalidates by
// ETag on every use.
func (h *handler) content(w http.ResponseWriter, r *http.Request) error {
	id, err := web.PathUUID(r, "id")
	if err != nil {
		return err
	}
	c, err := h.service.Content(id)
	if err != nil {
		return err
	}
	if err := h.files.WidenDownload(w, c.Object.Size); err != nil {
		return err
	}
	w.Header().Set("Content-Disposition", web.Attachment(c.Name))
	w.Header().Set("Cache-Control", "private, no-cache")
	return web.WriteObject(w, r, c.Object, func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(c.Bytes)), nil
	})
}

// status is the layer's error vocabulary as one web.ProblemMatcher: a
// rejected input (400) and an unknown document (404). The SDK maps its own
// request and upload errors.
func status(err error) (web.Problem, bool) {
	switch {
	case errors.Is(err, ErrValidation):
		return web.Problem{Status: http.StatusBadRequest}, true
	case errors.Is(err, ErrNotFound):
		return web.Problem{Status: http.StatusNotFound}, true
	}
	return web.Problem{}, false
}
