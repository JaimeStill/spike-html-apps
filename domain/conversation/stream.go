package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"uuid"
)

// errReplyFailed reports a reply that took the failure path: its stream
// ended, as the trigger asks, with the error event and response.failed.
var errReplyFailed = errors.New("reply failed deliberately: the input was the failure trigger")

// The failure path's error, as its error event and its failed response
// carry it.
const (
	failType    = "server_error"
	failCode    = "emulated_failure"
	failMessage = "The emulator failed this reply deliberately: the input was the failure trigger, " + Trigger + "."
)

// reply is one scripted reply a stream writes: the model it names, the
// tokens of its input, and whether it takes the failure path.
type reply struct {
	model       string
	inputTokens int
	fail        bool
}

// deltas is the script's text deltas: each word with the space after it.
var deltas = strings.SplitAfter(Script, " ")

// tokens counts the tokens of text the usage reports: a token a word.
func tokens(text string) int {
	return len(strings.Fields(text))
}

// newID returns a fresh id under prefix, a UUID's hex digits after it.
func newID(prefix string) string {
	return prefix + strings.ReplaceAll(uuid.NewV7().String(), "-", "")
}

// head is what every event carries first: its type, which is also its
// event field, and its sequence number, which the writer sets.
type head struct {
	Type           string `json:"type"`
	SequenceNumber int    `json:"sequence_number"`
}

// header returns the event's head, for the writer.
func (h *head) header() *head { return h }

// event is one event of the stream: one of the wire structs below.
type event interface{ header() *head }

// responseEvent is response.created, response.completed, or
// response.failed.
type responseEvent struct {
	head
	Response response `json:"response"`
}

// itemEvent is response.output_item.added or response.output_item.done.
type itemEvent struct {
	head
	OutputIndex int  `json:"output_index"`
	Item        Item `json:"item"`
}

// partEvent is response.content_part.added or response.content_part.done.
type partEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	ContentIndex int    `json:"content_index"`
	Part         Part   `json:"part"`
}

// deltaEvent is response.output_text.delta.
type deltaEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	ContentIndex int    `json:"content_index"`
	Delta        string `json:"delta"`
	Logprobs     []any  `json:"logprobs"`
}

// textDoneEvent is response.output_text.done.
type textDoneEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	ContentIndex int    `json:"content_index"`
	Text         string `json:"text"`
	Logprobs     []any  `json:"logprobs"`
}

// errorEvent is the spec's error event.
type errorEvent struct {
	head
	Error errorObject `json:"error"`
}

// errorObject is an error event's error; param is always null, since the
// failure concerns no request parameter.
type errorObject struct {
	Type    string  `json:"type"`
	Code    string  `json:"code"`
	Message string  `json:"message"`
	Param   *string `json:"param"`
}

// response is the response resource the response events carry.
// CompletedAt, Error, and Usage are null until the response ends.
type response struct {
	ID                string         `json:"id"`
	Object            string         `json:"object"`
	CreatedAt         int64          `json:"created_at"`
	CompletedAt       *int64         `json:"completed_at"`
	Status            string         `json:"status"`
	Model             string         `json:"model"`
	Output            []Item         `json:"output"`
	Error             *responseError `json:"error"`
	IncompleteDetails *struct{}      `json:"incomplete_details"`
	Usage             *usage         `json:"usage"`
}

// responseError is a failed response's error.
type responseError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// usage is a response's token counts, with the spec's breakdowns, which a
// scripted reply has nothing to put in.
type usage struct {
	InputTokens         int                 `json:"input_tokens"`
	InputTokensDetails  inputTokensDetails  `json:"input_tokens_details"`
	OutputTokens        int                 `json:"output_tokens"`
	OutputTokensDetails outputTokensDetails `json:"output_tokens_details"`
	TotalTokens         int                 `json:"total_tokens"`
}

type inputTokensDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type outputTokensDetails struct {
	ReasoningTokens int `json:"reasoning_tokens"`
}

// eventWriter writes a stream's events, numbering them from 0 and flushing
// each as it is written.
type eventWriter struct {
	w   http.ResponseWriter
	rc  *http.ResponseController
	seq int
}

// write sets e's sequence number and writes it as one event, its event
// field e's type and no id field, then flushes it to the client.
func (ew *eventWriter) write(e event) error {
	h := e.header()
	h.SequenceNumber = ew.seq
	ew.seq++
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(ew.w, "event: %s\ndata: %s\n\n", h.Type, data); err != nil {
		return err
	}
	return ew.rc.Flush()
}

// stream writes rp to w as a text/event-stream, as the package
// documentation describes, and returns the assistant's message once the
// reply has streamed whole. A reply on the failure path returns
// errReplyFailed after its last event. ctx ending, as it does when the
// client closes the connection, stops the stream before its next event and
// returns ctx's error; a failed write returns its error. Either way the
// stream ends with no terminal event, and the message is never returned.
func (s *Service) stream(ctx context.Context, w http.ResponseWriter, rp reply) (Item, error) {
	ew := &eventWriter{w: w, rc: http.NewResponseController(w)}
	if s.grace > 0 {
		// The script's whole duration, plus the server's write timeout as
		// grace for the events around the deltas and a slow reader.
		d := time.Duration(len(deltas))*s.interval + s.grace
		if err := ew.rc.SetWriteDeadline(time.Now().Add(d)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return Item{}, fmt.Errorf("set the write deadline: %w", err)
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	resp := response{
		ID:        newID("resp_"),
		Object:    "response",
		CreatedAt: time.Now().Unix(),
		Status:    "in_progress",
		Model:     rp.model,
		Output:    []Item{},
	}
	itemID := newID("msg_")
	if err := ew.write(&responseEvent{Type: "response.created", Response: resp}); err != nil {
		return Item{}, err
	}
	if err := ew.write(&itemEvent{Type: "response.output_item.added", Item: assistantMessage(itemID, InProgress, "")}); err != nil {
		return Item{}, err
	}
	if err := ew.write(&partEvent{Type: "response.content_part.added", ItemID: itemID, Part: outputText("")}); err != nil {
		return Item{}, err
	}

	n := len(deltas)
	if rp.fail {
		n = min(FailAfter, n)
	}
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	var text strings.Builder
	for _, delta := range deltas[:n] {
		select {
		case <-ctx.Done():
			return Item{}, ctx.Err()
		case <-ticker.C:
		}
		text.WriteString(delta)
		if err := ew.write(&deltaEvent{Type: "response.output_text.delta", ItemID: itemID, Delta: delta, Logprobs: []any{}}); err != nil {
			return Item{}, err
		}
	}

	now := time.Now().Unix()
	resp.CompletedAt = &now
	resp.Usage = &usage{InputTokens: rp.inputTokens, OutputTokens: n, TotalTokens: rp.inputTokens + n}
	if rp.fail {
		return Item{}, s.fail(ew, resp, itemID, text.String())
	}

	item := assistantMessage(itemID, Completed, text.String())
	if err := ew.write(&textDoneEvent{Type: "response.output_text.done", ItemID: itemID, Text: text.String(), Logprobs: []any{}}); err != nil {
		return Item{}, err
	}
	if err := ew.write(&partEvent{Type: "response.content_part.done", ItemID: itemID, Part: item.Content[0]}); err != nil {
		return Item{}, err
	}
	if err := ew.write(&itemEvent{Type: "response.output_item.done", Item: item}); err != nil {
		return Item{}, err
	}
	resp.Status = "completed"
	resp.Output = []Item{item}
	if err := ew.write(&responseEvent{Type: "response.completed", Response: resp}); err != nil {
		return Item{}, err
	}
	return item, nil
}

// fail ends the failure path's stream: the error event, then
// response.failed, its response holding the item stopped part way,
// incomplete, with the text streamed. It returns errReplyFailed once both
// are written.
func (s *Service) fail(ew *eventWriter, resp response, itemID, text string) error {
	if err := ew.write(&errorEvent{Type: "error", Error: errorObject{Type: failType, Code: failCode, Message: failMessage}}); err != nil {
		return err
	}
	resp.Status = "failed"
	resp.Output = []Item{assistantMessage(itemID, Incomplete, text)}
	resp.Error = &responseError{Code: failCode, Message: failMessage}
	if err := ew.write(&responseEvent{Type: "response.failed", Response: resp}); err != nil {
		return err
	}
	return errReplyFailed
}
