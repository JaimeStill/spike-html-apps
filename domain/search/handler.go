package search

import (
	"log/slog"
	"net/http"

	"github.com/standards-lab/go-web-sdk"
)

// handler binds the layer's endpoint to its service under the injected
// paging policy. It returns its error; the group's writer maps it to a
// problem.
type handler struct {
	service *Service
	limits  web.Limits
}

// Routes builds the layer's route group, /search: the search, which takes
// ?q=<query> and pages like a listing. limits is its paging policy, and
// logger records the cause of every 5xx the group's error writer sends.
// The layer has no error vocabulary of its own: every rejection is the
// SDK's *web.QueryError, a 400.
func Routes(service *Service, limits web.Limits, logger *slog.Logger) *web.Group {
	h := &handler{service: service, limits: limits}
	g := web.NewGroup("/search")
	g.SetErrorWriter(web.NewErrorWriter(logger))
	g.HandleErr("GET", "", h.search)
	return g
}

func (h *handler) search(w http.ResponseWriter, r *http.Request) error {
	q, err := web.ParseQuery(r.URL.Query(), h.limits)
	if err != nil {
		return err
	}
	items, paging, err := h.service.Search(q)
	if err != nil {
		return err
	}
	return web.WriteJSON(w, http.StatusOK, web.NewPage(items, q, paging))
}
