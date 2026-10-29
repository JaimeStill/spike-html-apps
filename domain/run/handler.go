package run

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/standards-lab/go-web-sdk"
)

// handler binds the layer's endpoints to its service under the injected
// paging policy. Every handler returns its error; the group's writer maps
// it to a problem.
type handler struct {
	service *Service
	limits  web.Limits
}

// Routes builds the layer's route group, /runs: the listing, which takes
// ?document=<id> to find a document's runs, and the read by id. limits is
// the listing's paging policy, and logger records the cause of every 5xx
// the group's error writer sends.
func Routes(service *Service, limits web.Limits, logger *slog.Logger) *web.Group {
	h := &handler{service: service, limits: limits}
	g := web.NewGroup("/runs")
	g.SetErrorWriter(web.NewErrorWriter(logger, status))
	g.HandleErr("GET", "", h.list)
	g.HandleErr("GET", "/{id}", h.run)
	return g
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

func (h *handler) run(w http.ResponseWriter, r *http.Request) error {
	id, err := web.PathUUID(r, "id")
	if err != nil {
		return err
	}
	run, err := h.service.Run(id)
	if err != nil {
		return err
	}
	return web.WriteJSON(w, http.StatusOK, run)
}

// status is the layer's error vocabulary as one web.ProblemMatcher: an
// unknown run (404). The SDK maps its own request errors.
func status(err error) (web.Problem, bool) {
	if errors.Is(err, ErrNotFound) {
		return web.Problem{Status: http.StatusNotFound}, true
	}
	return web.Problem{}, false
}
