package conversation_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/domain/conversation"
)

// These tests serve the conversations route group alone over httptest and
// read the rich reply's stream back whole: its exact event sequence, each
// event's members, the items it completes, and the history they join; each
// item type's wire form; and a rich reply cut off inside its function call.

// serve runs the conversations routes at delta interval interval and
// returns the server's URL.
func serve(t *testing.T, interval time.Duration) string {
	t.Helper()
	svc, err := conversation.New(conversation.Config{Interval: interval})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	api := web.NewGroup("/api")
	api.Mount(conversation.Routes(svc, web.Limits{DefaultSize: 20, MaxSize: 100}, slog.New(slog.DiscardHandler)))
	srv := httptest.NewServer(web.NewModule(api))
	t.Cleanup(srv.Close)
	return srv.URL
}

// create starts a conversation and returns its id.
func create(t *testing.T, url string) string {
	t.Helper()
	resp, err := http.Post(url+"/api/conversations", "", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var c conversation.Conversation
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		t.Fatalf("decode the conversation: %v", err)
	}
	return c.ID
}

// history reads the conversation id's history.
func history(t *testing.T, url, id string) []conversation.Item {
	t.Helper()
	resp, err := http.Get(url + "/api/conversations/" + id)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var c conversation.Conversation
	if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
		t.Fatalf("decode the conversation: %v", err)
	}
	return c.History
}

// post posts text to the conversation id and returns the reply's response,
// its body the stream; ctx cuts it off.
func post(ctx context.Context, t *testing.T, url, id, text string) *http.Response {
	t.Helper()
	body, err := json.Marshal(conversation.MessageRequest{Text: text})
	if err != nil {
		t.Fatalf("encode the message: %v", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api/conversations/"+id+"/messages", strings.NewReader(string(body)))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	return resp
}

// wireEvent is one event of a stream: its event field and its data,
// decoded generically and kept raw.
type wireEvent struct {
	event string
	data  map[string]any
	raw   string
}

// typ is the type its data names.
func (e wireEvent) typ() string { s, _ := e.data["type"].(string); return s }

// str is the data's member name as a string, "" when it is none.
func (e wireEvent) str(name string) string { s, _ := e.data[name].(string); return s }

// num is the data's member name as an int, -1 when it is none.
func (e wireEvent) num(name string) int {
	n, ok := e.data[name].(float64)
	if !ok {
		return -1
	}
	return int(n)
}

// decode re-decodes v, part of an event's generic data, into T.
func decode[T any](t *testing.T, v any) T {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("re-encode %v: %v", v, err)
	}
	var out T
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	return out
}

// encoded is v's JSON.
func encoded(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("encode %v: %v", v, err)
	}
	return string(b)
}

// read reads a stream's events until it ends, or until stop says to stop
// at one, failing on a line outside the framing.
func read(t *testing.T, r io.Reader, stop func(wireEvent) bool) []wireEvent {
	t.Helper()
	var out []wireEvent
	var cur wireEvent
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if err := json.Unmarshal([]byte(cur.raw), &cur.data); err != nil {
				t.Fatalf("event %q data %q: %v", cur.event, cur.raw, err)
			}
			out = append(out, cur)
			if stop(cur) {
				return out
			}
			cur = wireEvent{}
		case strings.HasPrefix(line, "event: "):
			cur.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			cur.raw = strings.TrimPrefix(line, "data: ")
		default:
			t.Fatalf("line %q is outside the framing", line)
		}
	}
	return out
}

// whole reads the stream to its end and closes it.
func whole(t *testing.T, resp *http.Response) []wireEvent {
	t.Helper()
	defer func() { _ = resp.Body.Close() }()
	return read(t, resp.Body, func(wireEvent) bool { return false })
}

// deltas is how many deltas text streams as: a word, and the whitespace
// after it, a delta.
func deltas(text string) int { return len(strings.Fields(text)) }

// repeat is n copies of typ.
func repeat(typ string, n int) []string { return slices.Repeat([]string{typ}, n) }

// richTypes is the rich reply's event sequence.
func richTypes() []string {
	return slices.Concat(
		[]string{"response.created", "response.output_item.added", "response.content_part.added"},
		repeat("response.reasoning.delta", deltas(conversation.RichReasoning)),
		[]string{"response.reasoning.done", "response.content_part.done", "response.reasoning_summary_part.added"},
		repeat("response.reasoning_summary_text.delta", deltas(conversation.RichSummary)),
		[]string{"response.reasoning_summary_text.done", "response.reasoning_summary_part.done", "response.output_item.done",
			"response.output_item.added"},
		repeat("response.function_call_arguments.delta", deltas(conversation.RichArguments)),
		[]string{"response.function_call_arguments.done", "response.output_item.done",
			"response.output_item.added", "response.output_item.done",
			"response.output_item.added", "response.content_part.added"},
		repeat("response.output_text.delta", deltas(conversation.RichReply)),
		[]string{"response.output_text.done", "response.content_part.done", "response.output_item.done", "response.completed"},
	)
}

// The rich reply streams, in output order, a reasoning item, its content
// then its summary grown a word at a time; a function_call, its arguments
// grown as written; the call's output; and the Markdown message. Every
// event about an item names it by its id and output index, every delta is
// a word with its whitespace, each done item is the whole item completed,
// and response.completed holds exactly the four, with usage counting every
// delta and the reasoning's apart. The history then holds the user's
// message and the four, and the next reply's input counts their text.
func TestConversations_RichReply(t *testing.T) {
	url := serve(t, time.Millisecond)
	id := create(t, url)
	events := whole(t, post(t.Context(), t, url, id, conversation.RichTrigger))

	got := make([]string, len(events))
	for i, e := range events {
		got[i] = e.typ()
		if e.event != e.typ() || e.num("sequence_number") != i {
			t.Errorf("event %d: event field %q, type %q, sequence_number %d", i, e.event, e.typ(), e.num("sequence_number"))
		}
	}
	if want := richTypes(); !slices.Equal(got, want) {
		t.Fatalf("event types =\n%v\nwant\n%v", got, want)
	}

	// The items as added, by output index; each event about one names it,
	// and each delta is one word and the whitespace after it.
	added := map[int]conversation.Item{}
	texts := map[string]string{}
	for i, e := range events {
		if e.typ() == "response.output_item.added" {
			added[e.num("output_index")] = decode[conversation.Item](t, e.data["item"])
		}
		if item := e.str("item_id"); item != "" && added[e.num("output_index")].ID != item {
			t.Errorf("event %d (%s): item_id %s at output %d, want %s", i, e.typ(), item, e.num("output_index"), added[e.num("output_index")].ID)
		}
		if d, ok := e.data["delta"].(string); ok {
			if word := strings.TrimRight(d, " \n"); word == "" || strings.ContainsAny(word, " \n") {
				t.Errorf("event %d (%s): delta %q, want one word and its whitespace", i, e.typ(), d)
			}
			texts[e.typ()] += d
		}
	}
	reasoning, call, output, message := added[0], added[1], added[2], added[3]
	if got := encoded(t, reasoning); got != `{"type":"reasoning","id":"`+reasoning.ID+`","status":"in_progress","summary":[],"content":[]}` || !strings.HasPrefix(reasoning.ID, "rs_") {
		t.Errorf("added reasoning = %s, want an rs_ id, in_progress, summary and content []", got)
	}
	if got := encoded(t, call); got != `{"type":"function_call","id":"`+call.ID+`","status":"in_progress","call_id":"`+call.CallID+`","name":"`+conversation.RichFunction+`","arguments":""}` ||
		!strings.HasPrefix(call.ID, "fc_") || !strings.HasPrefix(call.CallID, "call_") {
		t.Errorf("added call = %s, want an fc_ id and a call_ call_id, in_progress, arguments \"\"", got)
	}
	if got := encoded(t, output); got != `{"type":"function_call_output","id":"`+output.ID+`","status":"in_progress","call_id":"`+call.CallID+`","output":""}` || !strings.HasPrefix(output.ID, "fco_") {
		t.Errorf("added output = %s, want an fco_ id answering the call, in_progress, output \"\"", got)
	}
	if message.Type != "message" || message.Role != conversation.Assistant || message.Status != conversation.InProgress || message.Content == nil || len(message.Content) != 0 {
		t.Errorf("added message = %s, want an assistant message in progress, content []", encoded(t, message))
	}
	for typ, want := range map[string]string{
		"response.reasoning.delta":               conversation.RichReasoning,
		"response.reasoning_summary_text.delta":  conversation.RichSummary,
		"response.function_call_arguments.delta": conversation.RichArguments,
		"response.output_text.delta":             conversation.RichReply,
	} {
		if texts[typ] != want {
			t.Errorf("%s deltas = %q, want %q", typ, texts[typ], want)
		}
	}
	for _, e := range events {
		switch e.typ() {
		case "response.content_part.added", "response.content_part.done":
			if e.num("content_index") != 0 {
				t.Errorf("%s = %s, want content_index 0", e.typ(), e.raw)
			}
		case "response.reasoning.done":
			if e.str("text") != conversation.RichReasoning || e.num("content_index") != 0 {
				t.Errorf("reasoning.done = %s", e.raw)
			}
		case "response.reasoning_summary_part.added", "response.reasoning_summary_part.done":
			if p := decode[conversation.Part](t, e.data["part"]); p.Type != "summary_text" || e.num("summary_index") != 0 {
				t.Errorf("%s = %s, want a summary_text part at summary_index 0", e.typ(), e.raw)
			}
		case "response.reasoning_summary_text.done":
			if e.str("text") != conversation.RichSummary || e.num("summary_index") != 0 {
				t.Errorf("reasoning_summary_text.done = %s", e.raw)
			}
		case "response.function_call_arguments.done":
			if e.str("arguments") != conversation.RichArguments {
				t.Errorf("function_call_arguments.done = %s", e.raw)
			}
		}
	}

	want := []conversation.Item{
		{Type: "reasoning", ID: reasoning.ID, Status: conversation.Completed,
			Summary: []conversation.Part{{Type: "summary_text", Text: conversation.RichSummary}},
			Content: []conversation.Part{{Type: "reasoning_text", Text: conversation.RichReasoning}}},
		{Type: "function_call", ID: call.ID, Status: conversation.Completed, CallID: call.CallID, Name: conversation.RichFunction, Arguments: conversation.RichArguments},
		{Type: "function_call_output", ID: output.ID, Status: conversation.Completed, CallID: call.CallID, Output: conversation.RichOutput},
		{Type: "message", ID: message.ID, Role: conversation.Assistant, Status: conversation.Completed,
			Content: []conversation.Part{{Type: "output_text", Text: conversation.RichReply, Annotations: []any{}}}},
	}
	var done []conversation.Item
	for _, e := range events {
		if e.typ() == "response.output_item.done" {
			done = append(done, decode[conversation.Item](t, e.data["item"]))
		}
	}
	if encoded(t, done) != encoded(t, want) {
		t.Errorf("done items =\n%s\nwant\n%s", encoded(t, done), encoded(t, want))
	}
	completed := decode[struct {
		Status string              `json:"status"`
		Output []conversation.Item `json:"output"`
		Usage  struct {
			InputTokens         int `json:"input_tokens"`
			OutputTokens        int `json:"output_tokens"`
			OutputTokensDetails struct {
				ReasoningTokens int `json:"reasoning_tokens"`
			} `json:"output_tokens_details"`
			TotalTokens int `json:"total_tokens"`
		} `json:"usage"`
	}](t, events[len(events)-1].data["response"])
	if completed.Status != "completed" || encoded(t, completed.Output) != encoded(t, want) {
		t.Errorf("completed = %s, want completed with the done items", events[len(events)-1].raw)
	}
	reasoningTokens := deltas(conversation.RichReasoning) + deltas(conversation.RichSummary)
	outputTokens := reasoningTokens + deltas(conversation.RichArguments) + deltas(conversation.RichReply)
	if u := completed.Usage; u.InputTokens != 1 || u.OutputTokens != outputTokens || u.OutputTokensDetails.ReasoningTokens != reasoningTokens || u.TotalTokens != 1+outputTokens {
		t.Errorf("usage = %+v, want 1 input token, %d output, %d of them reasoning", u, outputTokens, reasoningTokens)
	}

	user := conversation.Item{Type: "message", Role: conversation.User, Content: []conversation.Part{{Type: "input_text", Text: conversation.RichTrigger}}}
	if got, want := encoded(t, history(t, url, id)), encoded(t, append([]conversation.Item{user}, want...)); got != want {
		t.Errorf("history =\n%s\nwant\n%s", got, want)
	}

	// The next reply, plain, counts the whole history as its input.
	events = whole(t, post(t.Context(), t, url, id, "thanks"))
	next := decode[struct {
		Usage struct {
			InputTokens int `json:"input_tokens"`
		} `json:"usage"`
	}](t, events[len(events)-1].data["response"])
	wantInput := 1 + outputTokens + deltas(conversation.RichOutput) + 1
	if first := decode[conversation.Item](t, events[1].data["item"]); next.Usage.InputTokens != wantInput || first.Type != "message" {
		t.Errorf("next reply: input tokens %d, first item %s; want %d, the plain message", next.Usage.InputTokens, events[1].raw, wantInput)
	}
	// Only the trigger exactly asks for the rich reply.
	for _, near := range []string{" " + conversation.RichTrigger, conversation.RichTrigger + " ", "/RICH"} {
		events := whole(t, post(t.Context(), t, url, id, near))
		if first := decode[conversation.Item](t, events[1].data["item"]); first.Type != "message" {
			t.Errorf("text %q: first item %s, want the plain reply's message", near, events[1].raw)
		}
	}
}

// Each item type decodes and encodes with its own members alone, each
// present even when empty: no message has a call_id, no function call a
// role or content.
func TestItem_EncodesItsTypesMembers(t *testing.T) {
	for _, wire := range []string{
		`{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}`,
		`{"type":"message","id":"msg_1","role":"assistant","status":"in_progress","content":[]}`,
		`{"type":"reasoning","id":"rs_1","status":"in_progress","summary":[],"content":[]}`,
		`{"type":"reasoning","id":"rs_1","status":"completed","summary":[{"type":"summary_text","text":"b"}],"content":[{"type":"reasoning_text","text":"a"}]}`,
		`{"type":"function_call","id":"fc_1","status":"in_progress","call_id":"call_1","name":"f","arguments":""}`,
		`{"type":"function_call_output","id":"fco_1","status":"completed","call_id":"call_1","output":"{}"}`,
	} {
		var it conversation.Item
		if err := json.Unmarshal([]byte(wire), &it); err != nil {
			t.Fatalf("decode %s: %v", wire, err)
		}
		if got := encoded(t, it); got != wire {
			t.Errorf("round trip of %s = %s", wire, got)
		}
	}
	if got := encoded(t, conversation.Item{Type: "message", Role: conversation.User}); got != `{"type":"message","role":"user","content":[]}` {
		t.Errorf("a message of nil content = %s, want its content []", got)
	}
}

// A rich reply the client cuts off inside its function call's arguments
// joins nothing to the history, not even the reasoning that streamed whole.
func TestConversations_RichReplyCutOffInTheCall(t *testing.T) {
	const interval = 5 * time.Millisecond
	url := serve(t, interval)
	id := create(t, url)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	resp := post(ctx, t, url, id, conversation.RichTrigger)
	events := read(t, resp.Body, func(e wireEvent) bool { return e.typ() == "response.function_call_arguments.delta" })
	cancel()
	_ = resp.Body.Close()
	if last := events[len(events)-1].typ(); last != "response.function_call_arguments.delta" {
		t.Fatalf("the stream ended at %s, before the call's arguments", last)
	}

	// Past the whole script's duration, the history holds the message alone.
	time.Sleep(time.Duration(len(richTypes()))*interval + 100*time.Millisecond)
	if h := history(t, url, id); len(h) != 1 || h[0].Role != conversation.User {
		t.Errorf("history = %s, want the user's message alone", encoded(t, h))
	}
}
