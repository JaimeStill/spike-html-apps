package conversation

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
)

// ErrNotFound reports a conversation id the store does not hold; the
// handler maps it to a 404.
var ErrNotFound = errors.New("conversation not found")

// ErrValidation classifies an input rejection; wrapped with its reason, it
// is a 400 whose detail is the reason.
var ErrValidation = errors.New("invalid input")

// Script is the text of every scripted reply. It streams a word at a time:
// each delta is one word with the space that follows it.
const Script = "Hello from the emulator. This reply is scripted: it streams one word at a time, " +
	"on a timer, the way a model's reply arrives, so a client can render it as it comes " +
	"and fold the events into the response once it completes."

// Trigger is the one input that takes the failure path: a user's message
// whose text is exactly this string. No other input, and nothing else the
// emulator does, fails a reply.
const Trigger = "/fail"

// FailAfter is how many words of [Script] the failure path streams before
// its error event.
const FailAfter = 4

// RichTrigger is the one input that asks for the rich reply: a user's
// message to a conversation whose text is exactly this string. It is a test
// seam, as [Trigger] is, not a client API: the rich reply shows a thread's
// whole range, deterministically, and the stateless route never takes it,
// since a function_call_output is an input item the spec's response output
// never holds.
const RichTrigger = "/rich"

// The rich reply's script: a reasoning item, its content [RichReasoning]
// and its summary [RichSummary]; a function_call of [RichFunction] with
// [RichArguments]; its function_call_output, [RichOutput]; and the
// assistant's message, [RichReply], in Markdown. Each text streams a word
// at a time, every delta a word with the whitespace that follows it, so
// the JSON's deltas reassemble it as written: its integer-like keys out of
// numeric order, and an integer past 2^53, which a client that parses and
// prints the JSON would reorder and round.
const (
	RichReasoning = "The reader asked for the rich reply. I will call lookup_forecast for Oslo, " +
		"then answer in Markdown: a heading, a list, a table, inline code, a code block, and a link."
	RichSummary   = "Looked up the forecast for Oslo with a tool, then answered in Markdown."
	RichFunction  = "lookup_forecast"
	RichArguments = `{"city": "Oslo", "10": "snow", "2": "rain", "station": 98765432109876543210}`
	RichOutput    = `{"city": "Oslo", "10": {"weather": "snow", "high": -1}, "2": {"weather": "rain", "high": 7}, "station": 98765432109876543210}`
	RichReply     = "## Forecast for Oslo\n\n" +
		"The `lookup_forecast` tool answered for **Oslo**:\n\n" +
		"- Day 2: rain, a high of 7 °C\n" +
		"- Day 10: snow, a high of -1 °C\n" +
		"- Station `98765432109876543210`\n\n" +
		"| Day | Weather | High |\n" +
		"| --- | --- | --- |\n" +
		"| 2 | Rain | 7 °C |\n" +
		"| 10 | Snow | -1 °C |\n\n" +
		"```json\n" +
		`{"2": "rain", "10": "snow"}` + "\n" +
		"```\n\n" +
		"The events are [Open Responses](https://www.openresponses.org/)'s."
)

// Model is the model a conversation's replies name; a stateless reply names
// the request's model, or this one when the request names none.
const Model = "emulator-scripted"

// Conversation is one conversation, as the API presents it: its id, when
// it was created, and its history, oldest first.
type Conversation struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	History   []Item    `json:"history"`
}

// Item is an Open Responses item of a conversation's history or a reply's
// output: a message, a user's input item, which has no id or status, or an
// assistant's output item; or, in the rich reply alone, a reasoning item, a
// function_call, or a function_call_output. Each type encodes with its own
// members, and with each of them, as the spec writes it: a message's role
// and content, never nil, so an array; a reasoning item's summary and
// content, arrays too; a function call's call_id, name, and arguments, ""
// until they stream; and a function call output's call_id and output.
type Item struct {
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	Role      Role   `json:"role,omitempty"`
	Status    Status `json:"status,omitempty"`
	Content   []Part `json:"content,omitzero"`
	Summary   []Part `json:"summary,omitzero"`
	CallID    string `json:"call_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
	Output    string `json:"output,omitempty"`
}

// The wire forms of each item type, which MarshalJSON writes: a type's
// members and no other's, each present even when empty.
type (
	messageWire struct {
		Type    string `json:"type"`
		ID      string `json:"id,omitempty"`
		Role    Role   `json:"role"`
		Status  Status `json:"status,omitempty"`
		Content []Part `json:"content"`
	}
	reasoningWire struct {
		Type    string `json:"type"`
		ID      string `json:"id"`
		Status  Status `json:"status"`
		Summary []Part `json:"summary"`
		Content []Part `json:"content"`
	}
	functionCallWire struct {
		Type      string `json:"type"`
		ID        string `json:"id"`
		Status    Status `json:"status"`
		CallID    string `json:"call_id"`
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}
	functionCallOutputWire struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		Status Status `json:"status"`
		CallID string `json:"call_id"`
		Output string `json:"output"`
	}
)

// MarshalJSON writes the item in its type's wire form; a type other than
// the three the rich reply adds is a message's.
func (it Item) MarshalJSON() ([]byte, error) {
	switch it.Type {
	case "reasoning":
		return json.Marshal(reasoningWire{Type: it.Type, ID: it.ID, Status: it.Status, Summary: nonNil(it.Summary), Content: nonNil(it.Content)})
	case "function_call":
		return json.Marshal(functionCallWire{Type: it.Type, ID: it.ID, Status: it.Status, CallID: it.CallID, Name: it.Name, Arguments: it.Arguments})
	case "function_call_output":
		return json.Marshal(functionCallOutputWire{Type: it.Type, ID: it.ID, Status: it.Status, CallID: it.CallID, Output: it.Output})
	}
	return json.Marshal(messageWire{Type: it.Type, ID: it.ID, Role: it.Role, Status: it.Status, Content: nonNil(it.Content)})
}

// nonNil is parts, or an empty slice for nil, so it encodes as an array.
func nonNil(parts []Part) []Part {
	if parts == nil {
		return []Part{}
	}
	return parts
}

// text is everything the item says, which its input tokens count: its
// parts' text, its arguments, and its output.
func (it Item) text() string {
	var b strings.Builder
	for _, p := range slices.Concat(it.Summary, it.Content) {
		b.WriteString(p.Text)
		b.WriteString(" ")
	}
	b.WriteString(it.Arguments)
	b.WriteString(" ")
	b.WriteString(it.Output)
	return b.String()
}

// Role is a message's author.
type Role string

// The message roles.
const (
	// User is a message the client posted.
	User Role = "user"
	// Assistant is a scripted reply.
	Assistant Role = "assistant"
)

// Status is an output item's progress.
type Status string

// The item statuses.
const (
	// InProgress is an item still streaming.
	InProgress Status = "in_progress"
	// Completed is an item streamed whole.
	Completed Status = "completed"
	// Incomplete is an item the failure path stopped part way.
	Incomplete Status = "incomplete"
)

// Part is a content part: an input_text of a user's message, an
// output_text of an assistant's, whose annotations are always present and
// always empty, or a reasoning item's reasoning_text, in its content, or
// summary_text, in its summary, which have no annotations.
type Part struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	Annotations []any  `json:"annotations,omitzero"`
}

// MessageRequest is a message a client posts to a conversation: its text,
// which must not be blank.
type MessageRequest struct {
	Text string `json:"text"`
}

// userMessage is the input item of a user's message of text.
func userMessage(text string) Item {
	return Item{Type: "message", Role: User, Content: []Part{{Type: "input_text", Text: text}}}
}

// assistantMessage is the output item id in status, holding text, or no
// part at all when it has none.
func assistantMessage(id string, status Status, text string) Item {
	it := Item{Type: "message", ID: id, Role: Assistant, Status: status, Content: []Part{}}
	if text != "" {
		it.Content = append(it.Content, outputText(text))
	}
	return it
}

// outputText is an output_text part holding text, its annotations empty.
func outputText(text string) Part {
	return Part{Type: "output_text", Text: text, Annotations: []any{}}
}

// reasoningItem is the reasoning item id in status, holding content and
// summary, or none of either.
func reasoningItem(id string, status Status, content, summary string) Item {
	it := Item{Type: "reasoning", ID: id, Status: status, Content: []Part{}, Summary: []Part{}}
	if content != "" {
		it.Content = append(it.Content, Part{Type: "reasoning_text", Text: content})
	}
	if summary != "" {
		it.Summary = append(it.Summary, Part{Type: "summary_text", Text: summary})
	}
	return it
}

// functionCall is the function_call id in status, calling name as callID
// with arguments.
func functionCall(id string, status Status, callID, name, arguments string) Item {
	return Item{Type: "function_call", ID: id, Status: status, CallID: callID, Name: name, Arguments: arguments}
}

// functionCallOutput is the function_call_output id in status, answering
// callID with output.
func functionCallOutput(id string, status Status, callID, output string) Item {
	return Item{Type: "function_call_output", ID: id, Status: status, CallID: callID, Output: output}
}
