package conversation

import (
	"errors"
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

// Item is an Open Responses message item: a user's input item, which has
// no id or status, or an assistant's output item. Its content is never nil,
// so it encodes as an array.
type Item struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Role    Role   `json:"role"`
	Status  Status `json:"status,omitempty"`
	Content []Part `json:"content"`
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

// Part is a message content part: an input_text of a user's message, or an
// output_text of an assistant's, whose annotations are always present and
// always empty.
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
