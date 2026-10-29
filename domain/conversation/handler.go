package conversation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/standards-lab/go-web-sdk"
)

// The request body limits: a posted message's, and a create-response
// body's, which carries a whole conversation.
const (
	maxMessageBody  = 64 << 10
	maxResponseBody = 4 << 20
)

// handler binds the layer's endpoints to its service under the injected
// paging policy. Every handler returns its error until its stream begins;
// the group's writer maps it to a problem. Once a stream has begun, its
// status is sent, so the handler logs how it ended and returns nil.
type handler struct {
	service *Service
	limits  web.Limits
	logger  *slog.Logger
}

// Routes builds the conversations route group, /conversations: the
// creation, the listing, the read by id, and the message, which answers
// with the scripted reply's stream. limits is the listing's paging policy,
// and logger records the cause of every 5xx the group's error writer sends
// and how each stream that did not complete ended.
func Routes(service *Service, limits web.Limits, logger *slog.Logger) *web.Group {
	h := &handler{service: service, limits: limits, logger: logger}
	g := web.NewGroup("/conversations")
	g.SetErrorWriter(web.NewErrorWriter(logger, status))
	g.HandleErr("POST", "", h.create)
	g.HandleErr("GET", "", h.list)
	g.HandleErr("GET", "/{id}", h.conversation)
	g.HandleErr("POST", "/{id}/messages", h.message)
	return g
}

// ResponsesRoutes builds the stateless route group, /responses: the
// create-response route, which answers an Open Responses request with the
// scripted reply's stream and keeps nothing. logger records the cause of
// every 5xx its error writer sends and how each stream that did not
// complete ended.
func ResponsesRoutes(service *Service, logger *slog.Logger) *web.Group {
	h := &handler{service: service, logger: logger}
	g := web.NewGroup("/responses")
	g.SetErrorWriter(web.NewErrorWriter(logger, status))
	g.HandleErr("POST", "", h.respond)
	return g
}

// create starts a conversation; it reads no body. The Location is the new
// conversation's read.
func (h *handler) create(w http.ResponseWriter, r *http.Request) error {
	c := h.service.Create()
	w.Header().Set("Location", r.URL.Path+"/"+c.ID)
	return web.WriteJSON(w, http.StatusCreated, c)
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

func (h *handler) conversation(w http.ResponseWriter, r *http.Request) error {
	id, err := web.PathUUID(r, "id")
	if err != nil {
		return err
	}
	c, err := h.service.Conversation(id)
	if err != nil {
		return err
	}
	return web.WriteJSON(w, http.StatusOK, c)
}

// message reads {"text": "..."}, adds the user's message to the history,
// and streams the scripted reply, whose message joins the history once it
// has streamed whole. Text exactly [Trigger] takes the failure path.
func (h *handler) message(w http.ResponseWriter, r *http.Request) error {
	id, err := web.PathUUID(r, "id")
	if err != nil {
		return err
	}
	body, err := web.DecodeJSON[MessageRequest](w, r, maxMessageBody)
	if err != nil {
		return err
	}
	rp, err := h.service.post(id, body.Text)
	if err != nil {
		return err
	}
	item, err := h.service.stream(r.Context(), w, rp)
	if err != nil {
		h.ended(r, err)
		return nil
	}
	h.service.complete(id, item)
	return nil
}

// respond reads an Open Responses create-response body and streams the
// scripted reply, keeping nothing. The last user input exactly [Trigger]
// takes the failure path.
func (h *handler) respond(w http.ResponseWriter, r *http.Request) error {
	rp, err := readCreate(w, r)
	if err != nil {
		return err
	}
	if _, err := h.service.stream(r.Context(), w, rp); err != nil {
		h.ended(r, err)
	}
	return nil
}

// ended logs how a stream that did not complete ended: the failure path,
// as the trigger asked, and a client's disconnect at debug, and a failed
// write at warn.
func (h *handler) ended(r *http.Request, err error) {
	switch {
	case errors.Is(err, errReplyFailed):
		h.logger.DebugContext(r.Context(), "reply took the failure path", "url.path", r.URL.Path)
	case errors.Is(err, context.Canceled):
		h.logger.DebugContext(r.Context(), "reply cut off by the client", "url.path", r.URL.Path)
	default:
		h.logger.WarnContext(r.Context(), "reply stream failed", "url.path", r.URL.Path, "error", err)
	}
}

// createRequest is the part of a create-response body the route reads:
// the model, the input, a string or an array of items, and stream. Every
// other member is accepted and ignored.
type createRequest struct {
	Model  string          `json:"model"`
	Input  json.RawMessage `json:"input"`
	Stream bool            `json:"stream"`
}

// inputItem is the part of an input item the route reads: a message's
// type, which may be omitted, its role, and its content, a string or an
// array of parts.
type inputItem struct {
	Type    string          `json:"type"`
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// inputPart is the part of a content part the route reads: its type and
// text.
type inputPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// readCreate reads r's body as a create-response request and returns the
// reply that answers it. A body over the limit, empty, not one JSON
// object, or whose input is neither a string nor an array of objects, is a
// *web.BodyError; one without stream true, or with no input, an
// [ErrValidation].
func readCreate(w http.ResponseWriter, r *http.Request) (reply, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxResponseBody))
	if err != nil {
		if mbe, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return reply{}, &web.BodyError{TooLarge: true, Reason: fmt.Sprintf("exceeds the %d-byte limit", mbe.Limit)}
		}
		return reply{}, &web.BodyError{Reason: err.Error()}
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return reply{}, &web.BodyError{Reason: "empty body"}
	}
	var req createRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return reply{}, &web.BodyError{Reason: err.Error()}
	}
	if !req.Stream {
		return reply{}, fmt.Errorf("%w: stream must be true: the route answers only with a stream", ErrValidation)
	}
	texts, last, err := readInput(req.Input)
	if err != nil {
		return reply{}, err
	}
	model := req.Model
	if model == "" {
		model = Model
	}
	input := 0
	for _, t := range texts {
		input += tokens(t)
	}
	return reply{model: model, inputTokens: input, fail: last == Trigger}, nil
}

// readInput reads a request's input: a string, one user message of that
// text, or an array of items. It returns the text of every message, and
// the text of the last user message, its input_text parts joined; an item
// of another type or part of another type contributes no text.
func readInput(raw json.RawMessage) (texts []string, last string, err error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return nil, "", fmt.Errorf("%w: input is required", ErrValidation)
	}
	var s string
	if json.Unmarshal(trimmed, &s) == nil {
		return []string{s}, s, nil
	}
	var items []inputItem
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, "", &web.BodyError{Reason: "input must be a string or an array of items: " + err.Error()}
	}
	for _, it := range items {
		if it.Type != "" && it.Type != "message" {
			continue
		}
		text := contentText(it.Content)
		texts = append(texts, text)
		if it.Role == string(User) {
			last = text
		}
	}
	return texts, last, nil
}

// contentText returns a message content's text: the string, or the texts
// of its text parts joined.
func contentText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []inputPart
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var b strings.Builder
	for _, p := range parts {
		switch p.Type {
		case "input_text", "output_text":
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

// status is the layer's error vocabulary as one web.ProblemMatcher: a
// rejected input (400) and an unknown conversation (404). The SDK maps its
// own request and body errors.
func status(err error) (web.Problem, bool) {
	switch {
	case errors.Is(err, ErrValidation):
		return web.Problem{Status: http.StatusBadRequest}, true
	case errors.Is(err, ErrNotFound):
		return web.Problem{Status: http.StatusNotFound}, true
	}
	return web.Problem{}, false
}
