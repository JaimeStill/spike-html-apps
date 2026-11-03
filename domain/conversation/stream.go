package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
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
// tokens of its input, whether it takes the failure path, and whether it is
// the rich reply.
type reply struct {
	model       string
	inputTokens int
	fail        bool
	rich        bool
}

// wordPattern is a delta: a word and the whitespace after it.
var wordPattern = regexp.MustCompile(`\S+\s*`)

// words splits text into its deltas, each a word with the whitespace that
// follows it, spaces and newlines alike, so the deltas joined are the text.
func words(text string) []string {
	return wordPattern.FindAllString(text, -1)
}

// The scripts' deltas.
var (
	deltas          = words(Script)
	reasoningDeltas = words(RichReasoning)
	summaryDeltas   = words(RichSummary)
	argumentDeltas  = words(RichArguments)
	richDeltas      = words(RichReply)
)

// ticks is how many delta intervals rp's stream waits: one before each
// delta, and, in the rich reply, one while the function runs.
func ticks(rp reply) int {
	if !rp.rich {
		return len(deltas)
	}
	return len(reasoningDeltas) + len(summaryDeltas) + len(argumentDeltas) + 1 + len(richDeltas)
}

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

// reasoningDeltaEvent is response.reasoning.delta, a delta of a reasoning
// item's reasoning_text part.
type reasoningDeltaEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	ContentIndex int    `json:"content_index"`
	Delta        string `json:"delta"`
}

// reasoningDoneEvent is response.reasoning.done.
type reasoningDoneEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	ContentIndex int    `json:"content_index"`
	Text         string `json:"text"`
}

// summaryPartEvent is response.reasoning_summary_part.added or
// response.reasoning_summary_part.done.
type summaryPartEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	SummaryIndex int    `json:"summary_index"`
	Part         Part   `json:"part"`
}

// summaryDeltaEvent is response.reasoning_summary_text.delta.
type summaryDeltaEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	SummaryIndex int    `json:"summary_index"`
	Delta        string `json:"delta"`
}

// summaryDoneEvent is response.reasoning_summary_text.done.
type summaryDoneEvent struct {
	head
	ItemID       string `json:"item_id"`
	OutputIndex  int    `json:"output_index"`
	SummaryIndex int    `json:"summary_index"`
	Text         string `json:"text"`
}

// argumentsDeltaEvent is response.function_call_arguments.delta.
type argumentsDeltaEvent struct {
	head
	ItemID      string `json:"item_id"`
	OutputIndex int    `json:"output_index"`
	Delta       string `json:"delta"`
}

// argumentsDoneEvent is response.function_call_arguments.done.
type argumentsDoneEvent struct {
	head
	ItemID      string `json:"item_id"`
	OutputIndex int    `json:"output_index"`
	Arguments   string `json:"arguments"`
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

// replyStream is one reply's stream as it is written: the writer, the
// timer each delta waits on, the items streamed whole so far, in output
// order, and the deltas counted for the usage. Its first error, ctx's or a
// write's, sticks: every later write and wait does nothing, and the stream
// returns it.
type replyStream struct {
	ctx       context.Context
	ew        *eventWriter
	ticker    *time.Ticker
	output    []Item
	deltas    int
	reasoning int
	err       error
}

// write writes e, unless the stream has already failed.
func (rs *replyStream) write(e event) {
	if rs.err == nil {
		rs.err = rs.ew.write(e)
	}
}

// tick waits for the next delta interval, or ends the stream when ctx ends
// first; it reports whether the stream goes on.
func (rs *replyStream) tick() bool {
	if rs.err != nil {
		return false
	}
	select {
	case <-rs.ctx.Done():
		rs.err = rs.ctx.Err()
		return false
	case <-rs.ticker.C:
		return true
	}
}

// text writes each of ws after a tick, as the event delta makes of it, and
// returns the text streamed, the deltas joined.
func (rs *replyStream) text(ws []string, delta func(string) event) string {
	var b strings.Builder
	for _, w := range ws {
		if !rs.tick() {
			break
		}
		b.WriteString(w)
		rs.deltas++
		rs.write(delta(w))
	}
	return b.String()
}

// reason streams the rich reply's reasoning item at the next output
// index: its reasoning_text part, then its summary_text part, each opened,
// grown a word at a time, and closed, then the item done.
func (rs *replyStream) reason() {
	index, id := len(rs.output), newID("rs_")
	rs.write(&itemEvent{Type: "response.output_item.added", OutputIndex: index, Item: reasoningItem(id, InProgress, "", "")})
	rs.write(&partEvent{Type: "response.content_part.added", ItemID: id, OutputIndex: index, Part: Part{Type: "reasoning_text"}})
	before := rs.deltas
	content := rs.text(reasoningDeltas, func(d string) event {
		return &reasoningDeltaEvent{Type: "response.reasoning.delta", ItemID: id, OutputIndex: index, Delta: d}
	})
	rs.write(&reasoningDoneEvent{Type: "response.reasoning.done", ItemID: id, OutputIndex: index, Text: content})
	rs.write(&partEvent{Type: "response.content_part.done", ItemID: id, OutputIndex: index, Part: Part{Type: "reasoning_text", Text: content}})
	rs.write(&summaryPartEvent{Type: "response.reasoning_summary_part.added", ItemID: id, OutputIndex: index, Part: Part{Type: "summary_text"}})
	summary := rs.text(summaryDeltas, func(d string) event {
		return &summaryDeltaEvent{Type: "response.reasoning_summary_text.delta", ItemID: id, OutputIndex: index, Delta: d}
	})
	rs.write(&summaryDoneEvent{Type: "response.reasoning_summary_text.done", ItemID: id, OutputIndex: index, Text: summary})
	rs.write(&summaryPartEvent{Type: "response.reasoning_summary_part.done", ItemID: id, OutputIndex: index, Part: Part{Type: "summary_text", Text: summary}})
	rs.reasoning += rs.deltas - before
	rs.done(index, reasoningItem(id, Completed, content, summary))
}

// call streams the rich reply's function_call at the next output index,
// its arguments a word at a time, then its function_call_output at the one
// after, added in progress, and done, holding the output whole, a delta
// interval later, while the function runs.
func (rs *replyStream) call() {
	index, id, callID := len(rs.output), newID("fc_"), newID("call_")
	rs.write(&itemEvent{Type: "response.output_item.added", OutputIndex: index, Item: functionCall(id, InProgress, callID, RichFunction, "")})
	arguments := rs.text(argumentDeltas, func(d string) event {
		return &argumentsDeltaEvent{Type: "response.function_call_arguments.delta", ItemID: id, OutputIndex: index, Delta: d}
	})
	rs.write(&argumentsDoneEvent{Type: "response.function_call_arguments.done", ItemID: id, OutputIndex: index, Arguments: arguments})
	rs.done(index, functionCall(id, Completed, callID, RichFunction, arguments))

	index, id = len(rs.output), newID("fco_")
	rs.write(&itemEvent{Type: "response.output_item.added", OutputIndex: index, Item: functionCallOutput(id, InProgress, callID, "")})
	if rs.tick() {
		rs.done(index, functionCallOutput(id, Completed, callID, RichOutput))
	}
}

// done writes item's output_item.done at index and adds it to the output,
// unless the stream has failed.
func (rs *replyStream) done(index int, item Item) {
	rs.write(&itemEvent{Type: "response.output_item.done", OutputIndex: index, Item: item})
	if rs.err == nil {
		rs.output = append(rs.output, item)
	}
}

// stream writes rp to w as a text/event-stream, as the package
// documentation describes, and returns the reply's items, in output order,
// once the reply has streamed whole: the assistant's message, after the
// rich reply's reasoning, function call, and its output. A reply on the
// failure path returns errReplyFailed after its last event. ctx ending, as
// it does when the client closes the connection, stops the stream before
// its next event and returns ctx's error; a failed write returns its error.
// Either way the stream ends with no terminal event, and no item is
// returned.
func (s *Service) stream(ctx context.Context, w http.ResponseWriter, rp reply) ([]Item, error) {
	ew := &eventWriter{w: w, rc: http.NewResponseController(w)}
	if s.grace > 0 {
		// The script's whole duration, plus the server's write timeout as
		// grace for the events around the deltas and a slow reader.
		d := time.Duration(ticks(rp))*s.interval + s.grace
		if err := ew.rc.SetWriteDeadline(time.Now().Add(d)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return nil, fmt.Errorf("set the write deadline: %w", err)
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
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	rs := &replyStream{ctx: ctx, ew: ew, ticker: ticker}
	rs.write(&responseEvent{Type: "response.created", Response: resp})
	script := deltas
	if rp.rich {
		rs.reason()
		rs.call()
		script = richDeltas
	}

	index, itemID := len(rs.output), newID("msg_")
	rs.write(&itemEvent{Type: "response.output_item.added", OutputIndex: index, Item: assistantMessage(itemID, InProgress, "")})
	rs.write(&partEvent{Type: "response.content_part.added", ItemID: itemID, OutputIndex: index, Part: outputText("")})
	if rp.fail {
		script = script[:min(FailAfter, len(script))]
	}
	text := rs.text(script, func(d string) event {
		return &deltaEvent{Type: "response.output_text.delta", ItemID: itemID, OutputIndex: index, Delta: d, Logprobs: []any{}}
	})
	if rs.err != nil {
		return nil, rs.err
	}

	now := time.Now().Unix()
	resp.CompletedAt = &now
	resp.Usage = &usage{
		InputTokens:         rp.inputTokens,
		OutputTokens:        rs.deltas,
		OutputTokensDetails: outputTokensDetails{ReasoningTokens: rs.reasoning},
		TotalTokens:         rp.inputTokens + rs.deltas,
	}
	if rp.fail {
		return nil, s.fail(rs, resp, assistantMessage(itemID, Incomplete, text))
	}

	item := assistantMessage(itemID, Completed, text)
	rs.write(&textDoneEvent{Type: "response.output_text.done", ItemID: itemID, OutputIndex: index, Text: text, Logprobs: []any{}})
	rs.write(&partEvent{Type: "response.content_part.done", ItemID: itemID, OutputIndex: index, Part: item.Content[0]})
	rs.done(index, item)
	resp.Status = "completed"
	resp.Output = rs.output
	rs.write(&responseEvent{Type: "response.completed", Response: resp})
	if rs.err != nil {
		return nil, rs.err
	}
	return rs.output, nil
}

// fail ends the failure path's stream: the error event, then
// response.failed, its response holding the items streamed whole and
// partial, the item stopped part way, incomplete, with the text streamed.
// It returns errReplyFailed once both are written.
func (s *Service) fail(rs *replyStream, resp response, partial Item) error {
	rs.write(&errorEvent{Type: "error", Error: errorObject{Type: failType, Code: failCode, Message: failMessage}})
	resp.Status = "failed"
	resp.Output = append(slices.Clone(rs.output), partial)
	resp.Error = &responseError{Code: failCode, Message: failMessage}
	rs.write(&responseEvent{Type: "response.failed", Response: resp})
	if rs.err != nil {
		return rs.err
	}
	return errReplyFailed
}
