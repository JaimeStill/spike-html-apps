package app_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
	"uuid"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/domain/conversation"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests drive the conversations and the stateless responses route
// through the composed router over loopback HTTP, reading each reply's
// event stream whole, line by line.

// deltaInterval is the pace these tests stream at.
const deltaInterval = 2 * time.Millisecond

// scriptWords is the script's text deltas, as the stream should send them.
var scriptWords = strings.SplitAfter(conversation.Script, " ")

// startConversations runs the app at delta interval interval and returns
// it, its address, and a client bound to it.
func startConversations(t *testing.T, interval time.Duration) (*running, string, *webtest.Client) {
	t.Helper()
	cfg := configtest.Config(t)
	cfg.Conversations.DeltaInterval = libconfig.Duration(interval)
	r := start(t, cfg)
	addr := waitForReady(t, r.log)
	return r, addr, webtest.NewClient("http://" + addr)
}

// frame is one event of a stream: its event field, its data, decoded as a
// generic object and kept raw, and whether it carried an id field.
type frame struct {
	event string
	data  map[string]any
	raw   string
	hasID bool
}

// typ is the type its data names.
func (f frame) typ() string { s, _ := f.data["type"].(string); return s }

// seq is its data's sequence_number, or -1.
func (f frame) seq() int {
	n, ok := f.data["sequence_number"].(float64)
	if !ok {
		return -1
	}
	return int(n)
}

// streamed is one streamed reply, read to its end.
type streamed struct {
	status int
	header http.Header
	frames []frame
}

// postStream posts body as JSON to path and reads the reply's stream to its
// end, failing the test on a line outside the event framing.
func postStream(t *testing.T, addr, path, body string) streamed {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), failsafe)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+addr+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	out := streamed{status: resp.StatusCode, header: resp.Header}
	sc := bufio.NewScanner(resp.Body)
	var cur frame
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if cur.raw != "" || cur.event != "" {
				if err := json.Unmarshal([]byte(cur.raw), &cur.data); err != nil {
					t.Fatalf("event %q data %q: %v", cur.event, cur.raw, err)
				}
				out.frames = append(out.frames, cur)
			}
			cur = frame{}
		case strings.HasPrefix(line, "event: "):
			cur.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			cur.raw += strings.TrimPrefix(line, "data: ")
		case line == "id" || strings.HasPrefix(line, "id:"):
			cur.hasID = true
		default:
			t.Fatalf("line %q is outside the event framing", line)
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("read %s stream: %v", path, err)
	}
	if cur.raw != "" || cur.event != "" {
		t.Fatalf("stream ended inside an event: %+v", cur)
	}
	return out
}

// types lists the stream's event types, by their data.
func (s streamed) types() []string {
	out := make([]string, len(s.frames))
	for i, f := range s.frames {
		out[i] = f.typ()
	}
	return out
}

// completedTypes is the event sequence of a reply streamed whole.
func completedTypes() []string {
	out := []string{"response.created", "response.output_item.added", "response.content_part.added"}
	for range scriptWords {
		out = append(out, "response.output_text.delta")
	}
	return append(out, "response.output_text.done", "response.content_part.done", "response.output_item.done", "response.completed")
}

// failedTypes is the event sequence of the failure path.
func failedTypes() []string {
	out := []string{"response.created", "response.output_item.added", "response.content_part.added"}
	for range conversation.FailAfter {
		out = append(out, "response.output_text.delta")
	}
	return append(out, "error", "response.failed")
}

// decodeAs re-decodes v, part of a frame's generic data, into T.
func decodeAs[T any](t *testing.T, v any) T {
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

// wireResponse is the response resource a response event carries, as the
// tests read it.
type wireResponse struct {
	ID     string              `json:"id"`
	Object string              `json:"object"`
	Status string              `json:"status"`
	Model  string              `json:"model"`
	Output []conversation.Item `json:"output"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Usage *struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

// checkFraming asserts the stream's framing: text/event-stream, each
// event's event field its data's type, sequence numbers rising from 0, and
// no id field.
func checkFraming(t *testing.T, s streamed) {
	t.Helper()
	if s.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", s.status)
	}
	if got := s.header.Get("Content-Type"); got != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", got)
	}
	for i, f := range s.frames {
		if f.event != f.typ() {
			t.Errorf("event %d: event field %q, data type %q; want them equal", i, f.event, f.typ())
		}
		if f.seq() != i {
			t.Errorf("event %d (%s): sequence_number %d, want %d", i, f.typ(), f.seq(), i)
		}
		if f.hasID {
			t.Errorf("event %d (%s) carries an id field", i, f.typ())
		}
	}
}

// checkItemIDs asserts every event about the reply's message names the one
// item id the output_item.added gave, and returns it.
func checkItemIDs(t *testing.T, s streamed) string {
	t.Helper()
	added := decodeAs[conversation.Item](t, s.frames[1].data["item"])
	if added.ID == "" || added.Role != conversation.Assistant || added.Status != conversation.InProgress || added.Content == nil || len(added.Content) != 0 {
		t.Errorf("added item = %+v, want an assistant message with an id, in_progress, its content []", added)
	}
	for i, f := range s.frames {
		if id, ok := f.data["item_id"]; ok && id != added.ID {
			t.Errorf("event %d (%s): item_id %v, want %s", i, f.typ(), id, added.ID)
		}
		if it, ok := f.data["item"].(map[string]any); ok && it["id"] != added.ID {
			t.Errorf("event %d (%s): item id %v, want %s", i, f.typ(), it["id"], added.ID)
		}
	}
	return added.ID
}

// deltaText joins the stream's text deltas.
func deltaText(s streamed) string {
	var b strings.Builder
	for _, f := range s.frames {
		if f.typ() == "response.output_text.delta" {
			d, _ := f.data["delta"].(string)
			b.WriteString(d)
		}
	}
	return b.String()
}

// newConversation creates a conversation and returns it.
func newConversation(t *testing.T, c *webtest.Client) conversation.Conversation {
	t.Helper()
	return webtest.Decode[conversation.Conversation](t, c.Post(t, "/api/conversations", nil), http.StatusCreated)
}

// readConversation reads the conversation id.
func readConversation(t *testing.T, c *webtest.Client, id string) conversation.Conversation {
	t.Helper()
	return webtest.Decode[conversation.Conversation](t, c.Get(t, "/api/conversations/"+id), http.StatusOK)
}

// A conversation is created with an empty history, its Location its read;
// the listing pages every conversation in creation order; an unknown id is
// a 404 and a malformed one a 400.
func TestConversations_CreateListRead(t *testing.T) {
	_, _, c := startConversations(t, deltaInterval)

	res := c.Post(t, "/api/conversations", nil)
	first := webtest.Decode[conversation.Conversation](t, res, http.StatusCreated)
	if _, err := uuid.Parse(first.ID); err != nil {
		t.Errorf("id = %q, want a UUID", first.ID)
	}
	if first.History == nil || len(first.History) != 0 {
		t.Errorf("history = %#v, want []", first.History)
	}
	if got, want := res.Header.Get("Location"), "/api/conversations/"+first.ID; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
	if read := readConversation(t, c, first.ID); read.ID != first.ID || !read.CreatedAt.Equal(first.CreatedAt) {
		t.Errorf("read = %+v, want %+v", read, first)
	}
	second := newConversation(t, c)

	page := webtest.Decode[struct {
		Items []conversation.Conversation `json:"items"`
		Total *int                        `json:"total"`
		Page  int                         `json:"page"`
		Size  int                         `json:"size"`
	}](t, c.Get(t, "/api/conversations?size=1&page=2"), http.StatusOK)
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || page.Total == nil || *page.Total != 2 {
		t.Errorf("page 2 of size 1 = %+v, want the second conversation of 2", page)
	}

	_ = c.Get(t, "/api/conversations/"+uuid.NewV7().String()).Problem(t, http.StatusNotFound)
	_ = c.Get(t, "/api/conversations/not-a-uuid").Problem(t, http.StatusBadRequest)
	_ = c.Get(t, "/api/conversations?sort=id").Problem(t, http.StatusBadRequest)
}

// A posted message streams the scripted reply, framed and ordered as the
// spec has it, one item id throughout; response.completed holds exactly
// the done item and plausible usage. The history then holds the user's
// message and the assistant's, the same item the stream completed.
func TestConversations_MessageStreamsReplyAndKeepsHistory(t *testing.T) {
	_, addr, c := startConversations(t, deltaInterval)
	conv := newConversation(t, c)

	s := postStream(t, addr, "/api/conversations/"+conv.ID+"/messages", `{"text": "Hello there, emulator"}`)
	checkFraming(t, s)
	if got, want := s.types(), completedTypes(); !slices.Equal(got, want) {
		t.Fatalf("event types = %v, want %v", got, want)
	}
	itemID := checkItemIDs(t, s)
	if got := deltaText(s); got != conversation.Script {
		t.Errorf("deltas = %q, want the script", got)
	}

	created := decodeAs[wireResponse](t, s.frames[0].data["response"])
	if created.Status != "in_progress" || created.Output == nil || len(created.Output) != 0 || created.Usage != nil {
		t.Errorf("created response = %+v, want in_progress, output [], no usage", created)
	}
	n := len(s.frames)
	if text := s.frames[n-4].data["text"]; text != conversation.Script {
		t.Errorf("output_text.done text = %v, want the script", text)
	}
	done := decodeAs[conversation.Item](t, s.frames[n-2].data["item"])
	wantItem := conversation.Item{Type: "message", ID: itemID, Role: conversation.Assistant, Status: conversation.Completed,
		Content: []conversation.Part{{Type: "output_text", Text: conversation.Script, Annotations: []any{}}}}
	if !itemEqual(done, wantItem) {
		t.Errorf("output_item.done item = %+v, want %+v", done, wantItem)
	}
	completed := decodeAs[wireResponse](t, s.frames[n-1].data["response"])
	if completed.ID != created.ID || completed.Object != "response" || completed.Status != "completed" || completed.Model != conversation.Model || completed.Error != nil {
		t.Errorf("completed response = %+v, want response %s completed, of model %s, no error", completed, created.ID, conversation.Model)
	}
	if len(completed.Output) != 1 || !itemEqual(completed.Output[0], wantItem) {
		t.Errorf("completed output = %+v, want exactly %+v", completed.Output, wantItem)
	}
	if u := completed.Usage; u == nil || u.InputTokens != 3 || u.OutputTokens != len(scriptWords) || u.TotalTokens != u.InputTokens+u.OutputTokens {
		t.Errorf("usage = %+v, want 3 input tokens, %d output, and their total", u, len(scriptWords))
	}

	history := readConversation(t, c, conv.ID).History
	wantUser := conversation.Item{Type: "message", Role: conversation.User, Content: []conversation.Part{{Type: "input_text", Text: "Hello there, emulator"}}}
	if len(history) != 2 || !itemEqual(history[0], wantUser) || !itemEqual(history[1], wantItem) {
		t.Errorf("history = %+v, want the user's message, then %+v", history, wantItem)
	}

	// A second turn's input is the whole history.
	s = postStream(t, addr, "/api/conversations/"+conv.ID+"/messages", `{"text": "again"}`)
	again := decodeAs[wireResponse](t, s.frames[len(s.frames)-1].data["response"])
	if want := 3 + len(scriptWords) + 1; again.Usage == nil || again.Usage.InputTokens != want {
		t.Errorf("second turn usage = %+v, want %d input tokens", again.Usage, want)
	}
	if got := len(readConversation(t, c, conv.ID).History); got != 4 {
		t.Errorf("history after two turns has %d items, want 4", got)
	}
}

// itemEqual compares two items by their wire form.
func itemEqual(a, b conversation.Item) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// A client that disconnects mid-reply ends the stream on the server, which
// logs the cut-off, and the reply never joins the history, even after the
// script's whole duration has passed; the user's message stays.
func TestConversations_AbortLeavesNoAssistantMessage(t *testing.T) {
	const interval = 10 * time.Millisecond
	r, addr, c := startConversations(t, interval)
	conv := newConversation(t, c)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+addr+"/api/conversations/"+conv.ID+"/messages", strings.NewReader(`{"text": "hi"}`))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST message: %v", err)
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		if sc.Text() == "event: response.output_text.delta" {
			break
		}
	}
	cancel()
	_ = resp.Body.Close()

	deadline := time.Now().Add(failsafe)
	for !strings.Contains(r.log.String(), `msg="reply cut off by the client"`) {
		if time.Now().After(deadline) {
			t.Fatalf("the server logged no cut-off; log: %q", r.log.String())
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(time.Duration(len(scriptWords))*interval + 100*time.Millisecond)
	history := readConversation(t, c, conv.ID).History
	if len(history) != 1 || history[0].Role != conversation.User {
		t.Errorf("history = %+v, want the user's message alone", history)
	}
}

// The trigger, and only the trigger exactly, takes the failure path: part
// of the reply, the error event, and response.failed holding the partial
// output, failed with the error. The history keeps the user's message and
// no assistant message. Near misses stream the reply whole.
func TestConversations_TriggerFailsReply(t *testing.T) {
	_, addr, c := startConversations(t, deltaInterval)
	conv := newConversation(t, c)

	s := postStream(t, addr, "/api/conversations/"+conv.ID+"/messages", `{"text": "`+conversation.Trigger+`"}`)
	checkFraming(t, s)
	if got, want := s.types(), failedTypes(); !slices.Equal(got, want) {
		t.Fatalf("event types = %v, want %v", got, want)
	}
	itemID := checkItemIDs(t, s)
	partial := strings.Join(scriptWords[:conversation.FailAfter], "")
	if got := deltaText(s); got != partial {
		t.Errorf("deltas = %q, want the script's first %d words %q", got, conversation.FailAfter, partial)
	}

	n := len(s.frames)
	e := decodeAs[struct {
		Type  string `json:"type"`
		Error struct {
			Type    string  `json:"type"`
			Code    string  `json:"code"`
			Message string  `json:"message"`
			Param   *string `json:"param"`
		} `json:"error"`
	}](t, s.frames[n-2].data)
	if e.Error.Type != "server_error" || e.Error.Code != "emulated_failure" || !strings.Contains(e.Error.Message, conversation.Trigger) || e.Error.Param != nil {
		t.Errorf("error event = %+v, want server_error emulated_failure naming the trigger, param null", e)
	}
	if _, ok := s.frames[n-2].data["error"].(map[string]any)["param"]; !ok {
		t.Error("error event's error has no param member, want null")
	}
	failed := decodeAs[wireResponse](t, s.frames[n-1].data["response"])
	if failed.Status != "failed" || failed.Error == nil || failed.Error.Code != e.Error.Code || failed.Error.Message != e.Error.Message {
		t.Errorf("failed response = %+v, want failed with the error event's code and message", failed)
	}
	wantPartial := conversation.Item{Type: "message", ID: itemID, Role: conversation.Assistant, Status: conversation.Incomplete,
		Content: []conversation.Part{{Type: "output_text", Text: partial, Annotations: []any{}}}}
	if len(failed.Output) != 1 || !itemEqual(failed.Output[0], wantPartial) {
		t.Errorf("failed output = %+v, want exactly %+v", failed.Output, wantPartial)
	}

	history := readConversation(t, c, conv.ID).History
	if len(history) != 1 || history[0].Role != conversation.User || history[0].Content[0].Text != conversation.Trigger {
		t.Errorf("history = %+v, want the trigger message alone", history)
	}

	for _, near := range []string{" " + conversation.Trigger, conversation.Trigger + " ", "/FAIL", conversation.Trigger + " please"} {
		s := postStream(t, addr, "/api/conversations/"+conv.ID+"/messages", `{"text": "`+near+`"}`)
		if got := s.types(); !slices.Equal(got, completedTypes()) {
			t.Errorf("text %q: event types = %v, want the reply whole", near, got)
		}
	}
}

// A message is refused before any stream: blank text, an unknown field,
// or a body that is not JSON is a 400, an unknown conversation a 404.
func TestConversations_MessageRejections(t *testing.T) {
	_, _, c := startConversations(t, deltaInterval)
	conv := newConversation(t, c)
	path := "/api/conversations/" + conv.ID + "/messages"

	for _, body := range []string{`{"text": "   "}`, `{"text": "hi", "role": "user"}`, `{"text":`, ``} {
		_ = c.Post(t, path, body).Problem(t, http.StatusBadRequest)
	}
	_ = c.Post(t, "/api/conversations/"+uuid.NewV7().String()+"/messages", `{"text": "hi"}`).Problem(t, http.StatusNotFound)
	if got := len(readConversation(t, c, conv.ID).History); got != 0 {
		t.Errorf("history after rejections has %d items, want 0", got)
	}
}

// The stateless route answers a create-response body, the client's members
// and unknown ones accepted, with the same scripted reply, under the
// request's model; the last user input exactly the trigger takes the
// failure path, wherever else the trigger appears.
func TestResponses_StatelessStreams(t *testing.T) {
	_, addr, _ := startConversations(t, deltaInterval)

	clientBody := `{"model": "test-model", "input": [
		{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "` + conversation.Trigger + `"}]},
		{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "earlier"}]},
		{"role": "user", "content": "one two three"}],
		"stream": true, "store": false, "include": ["reasoning.encrypted_content"], "tools": [], "temperature": 0.2}`
	s := postStream(t, addr, "/api/responses", clientBody)
	checkFraming(t, s)
	if got := s.types(); !slices.Equal(got, completedTypes()) {
		t.Fatalf("event types = %v, want the reply whole", got)
	}
	checkItemIDs(t, s)
	completed := decodeAs[wireResponse](t, s.frames[len(s.frames)-1].data["response"])
	if completed.Model != "test-model" || completed.Usage == nil || completed.Usage.InputTokens != 5 {
		t.Errorf("completed = %+v, want model test-model and 5 input tokens", completed)
	}

	s = postStream(t, addr, "/api/responses", `{"input": "hello", "stream": true}`)
	if got := s.types(); !slices.Equal(got, completedTypes()) {
		t.Errorf("string input: event types = %v, want the reply whole", got)
	}
	if m := decodeAs[wireResponse](t, s.frames[len(s.frames)-1].data["response"]).Model; m != conversation.Model {
		t.Errorf("model = %q, want the default %q", m, conversation.Model)
	}

	for name, body := range map[string]string{
		"string": `{"model": "m", "input": "` + conversation.Trigger + `", "stream": true}`,
		"items": `{"model": "m", "stream": true, "input": [{"type": "message", "role": "user", "content": "hi"},
			{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "` + conversation.Trigger + `"}]}]}`,
	} {
		s := postStream(t, addr, "/api/responses", body)
		checkFraming(t, s)
		if got := s.types(); !slices.Equal(got, failedTypes()) {
			t.Errorf("%s trigger: event types = %v, want the failure path", name, got)
		}
	}
}

// A body that doesn't parse, or doesn't ask for a stream, is a 400 before
// any stream; so is one without input.
func TestResponses_Rejections(t *testing.T) {
	_, _, c := startConversations(t, deltaInterval)

	for name, body := range map[string]string{
		"not JSON":       `{"model": `,
		"empty":          ``,
		"trailing data":  `{"input": "hi", "stream": true} {}`,
		"stream false":   `{"model": "m", "input": "hi", "stream": false}`,
		"stream missing": `{"model": "m", "input": "hi"}`,
		"stream string":  `{"model": "m", "input": "hi", "stream": "true"}`,
		"no input":       `{"model": "m", "stream": true}`,
		"input number":   `{"model": "m", "input": 7, "stream": true}`,
		"input object":   `{"model": "m", "input": {"role": "user"}, "stream": true}`,
		"not an object":  `["hi"]`,
	} {
		res := c.Post(t, "/api/responses", body)
		if res.Status != http.StatusBadRequest || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/problem+json") {
			t.Errorf("%s: %d %s %s, want a 400 problem", name, res.Status, res.Header.Get("Content-Type"), res.Body)
		}
	}
}

// A reply lifts its connection's write deadline over its whole script, so
// a script that outlasts the server's write timeout still streams whole:
// here the script takes about 380ms under a 100ms write timeout.
func TestConversations_ReplyOutlastsWriteTimeout(t *testing.T) {
	const writeTimeout = 100 * time.Millisecond
	cfg := configtest.Config(t)
	cfg.Conversations.DeltaInterval = libconfig.Duration(10 * time.Millisecond)
	cfg.Server.WriteTimeout = new(libconfig.Duration(writeTimeout))
	addr := waitForReady(t, start(t, cfg).log)
	if d := time.Duration(len(scriptWords)) * 10 * time.Millisecond; d < 2*writeTimeout {
		t.Fatalf("the script takes %s, want well over the %s write timeout", d, writeTimeout)
	}

	s := postStream(t, addr, "/api/responses", `{"input": "hi", "stream": true}`)
	checkFraming(t, s)
	if got := s.types(); !slices.Equal(got, completedTypes()) {
		t.Errorf("event types = %v, want the reply whole", got)
	}
}
