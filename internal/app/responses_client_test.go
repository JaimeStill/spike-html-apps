package app_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	aiclient "github.com/JaimeStill/spike-ai-pipeline-client"
	"github.com/JaimeStill/spike-ai-pipeline-client/format/responses"
	"github.com/JaimeStill/spike-ai-pipeline-client/protocol"

	"github.com/JaimeStill/spike-html-apps/domain/conversation"
)

// These tests point spike-ai-pipeline-client v0.4.0, the capstone's Open
// Responses client, at the composed router's stateless route over
// loopback: its format/responses decoder checks every event the emulator
// streams, and its Accumulator folds them, so a departure from the stream
// the client decodes fails here.

// generate runs the client's GenerateStream against the emulator with one
// user message of text, folding every event, and returns the events, the
// folded response, and the first error the stream yielded.
func generate(t *testing.T, addr, text string) ([]protocol.Event, *protocol.Response, error) {
	t.Helper()
	c, err := aiclient.New(aiclient.Config{
		BaseURL: "http://" + addr + "/api",
		HTTP:    &http.Client{Transport: &http.Transport{DisableKeepAlives: true}},
		Format:  responses.New(responses.Options{}),
	})
	if err != nil {
		t.Fatalf("aiclient.New: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), failsafe)
	defer cancel()
	req := &protocol.Request{
		Model: "emulator",
		Input: []protocol.Item{protocol.Message{Role: protocol.RoleUser, Content: []protocol.ContentPart{protocol.InputText{Text: text}}}},
	}
	var events []protocol.Event
	var acc protocol.Accumulator
	for e, err := range c.GenerateStream(ctx, req) {
		if err != nil {
			return events, acc.Response(), err
		}
		events = append(events, e)
		if err := acc.Add(e); err != nil {
			t.Fatalf("Accumulator.Add(%T): %v", e, err)
		}
	}
	return events, acc.Response(), nil
}

// messageText returns the text of resp's one output item, a message of
// output_text parts, failing the test otherwise.
func messageText(t *testing.T, resp *protocol.Response) string {
	t.Helper()
	if len(resp.Output) != 1 {
		t.Fatalf("output = %+v, want one message", resp.Output)
	}
	m, ok := resp.Output[0].(protocol.Message)
	if !ok || m.Role != protocol.RoleAssistant {
		t.Fatalf("output[0] = %#v, want an assistant message", resp.Output[0])
	}
	var b strings.Builder
	for _, p := range m.Content {
		text, ok := p.(protocol.OutputText)
		if !ok {
			t.Fatalf("message part %#v, want output_text", p)
		}
		b.WriteString(text.Text)
	}
	return b.String()
}

// The scripted reply decodes and folds without error into a completed
// response whose one message is the script, with the usage the emulator
// counted.
func TestResponsesClient_FoldsScriptedReply(t *testing.T) {
	_, addr, _ := startConversations(t, deltaInterval)

	events, resp, err := generate(t, addr, "hello from the client")
	if err != nil {
		t.Fatalf("GenerateStream yielded %v after %d events", err, len(events))
	}
	if _, ok := events[0].(protocol.ResponseCreated); !ok {
		t.Errorf("first event = %T, want ResponseCreated", events[0])
	}
	if _, ok := events[len(events)-1].(protocol.ResponseCompleted); !ok {
		t.Errorf("last event = %T, want ResponseCompleted", events[len(events)-1])
	}
	if resp.Status != protocol.StatusCompleted || resp.Error != nil {
		t.Errorf("folded status = %s, error %+v; want completed, no error", resp.Status, resp.Error)
	}
	if got := messageText(t, resp); got != conversation.Script {
		t.Errorf("folded text = %q, want the script %q", got, conversation.Script)
	}
	if m := resp.Output[0].(protocol.Message); m.ID == "" || m.Status != protocol.StatusCompleted {
		t.Errorf("folded message = %+v, want an id, completed", m)
	}
	words := len(strings.Fields(conversation.Script))
	if u := resp.Usage; u.InputTokens != 4 || u.OutputTokens != words || u.TotalTokens != 4+words {
		t.Errorf("usage = %+v, want 4 input, %d output, and their total", u, words)
	}
}

// The trigger's stream ends, with no error pair, in the error event the
// client surfaces with the emulator's type, code, and message, then
// response.failed: the folded response is failed with that code and
// message, holding the partial message in progress.
func TestResponsesClient_TriggerSurfacesFailure(t *testing.T) {
	_, addr, _ := startConversations(t, deltaInterval)

	events, resp, err := generate(t, addr, conversation.Trigger)
	if err != nil {
		t.Fatalf("GenerateStream yielded %v after %d events, want the failure as events", err, len(events))
	}
	n := len(events)
	if n < 2 {
		t.Fatalf("events = %v, want at least the error event and response.failed", events)
	}
	e, ok := events[n-2].(protocol.ErrorEvent)
	if !ok {
		t.Fatalf("second-last event = %T, want ErrorEvent", events[n-2])
	}
	if e.Error.Type != "server_error" || e.Error.Code != "emulated_failure" || !strings.Contains(e.Error.Message, conversation.Trigger) || e.Error.Param != "" {
		t.Errorf("error = %+v, want server_error emulated_failure naming the trigger, no param", e.Error)
	}
	if _, ok := events[n-1].(protocol.ResponseFailed); !ok {
		t.Fatalf("last event = %T, want ResponseFailed", events[n-1])
	}
	if resp.Status != protocol.StatusFailed || resp.Error == nil || resp.Error.Code != e.Error.Code || resp.Error.Message != e.Error.Message {
		t.Errorf("folded = status %s, error %+v; want failed with the error event's code and message", resp.Status, resp.Error)
	}
	partial := strings.Join(strings.SplitAfter(conversation.Script, " ")[:conversation.FailAfter], "")
	if got := messageText(t, resp); got != partial {
		t.Errorf("partial text = %q, want %q", got, partial)
	}
	if m := resp.Output[0].(protocol.Message); m.Status != protocol.StatusInProgress {
		t.Errorf("partial message status = %s, want in_progress, as the client holds an item still open", m.Status)
	}
}
