// Package conversation is the conversation domain layer: conversations with
// a scripted assistant, served under /api/conversations, and the stateless
// Open Responses route, /api/responses, both answered by one stream writer
// as an Open Responses (spec 2026-04-24) event stream, the form
// spike-ai-pipeline-client's format/responses decodes.
//
// A conversation is created by POST /api/conversations, which takes no
// body, listed by GET /api/conversations, paged like every listing, and read
// by GET /api/conversations/{id}, with its history: the ordered Open
// Responses message items exchanged so far. A user's message is an input
// item, {"type":"message","role":"user","content":[{"type":"input_text",
// "text"}]}, and an assistant's an output item, {"type":"message","id",
// "role":"assistant","status":"completed","content":[{"type":"output_text",
// "text","annotations":[]}]}.
//
// POST /api/conversations/{id}/messages takes {"text": "..."}, which must
// not be blank, adds the user's message to the history, and answers with the
// scripted reply, [Script], as a text/event-stream. Once the reply has
// streamed whole, the assistant's message joins the history; a reply the
// client cuts off, by closing the connection, ends the stream on the server
// and never joins it.
//
// POST /api/responses takes an Open Responses create-response body, which
// must carry stream true, and answers it with the same scripted reply from
// the same writer, keeping nothing. It reads the members it needs, model and
// input, a string or an array of items, and accepts every other member, such
// as store, include, and tools, without reading it. A body that doesn't
// parse, or doesn't ask for a stream, is a 400.
//
// The stream follows the spec: each event's event field is its data's type,
// its sequence_number rises from 0, and no event carries an id field. A
// reply is one assistant message, its id the same throughout:
// response.created (in_progress, no output), response.output_item.added,
// response.content_part.added, one response.output_text.delta per word of
// the script, each after the configured delta interval,
// response.output_text.done, response.content_part.done,
// response.output_item.done (the whole item, completed), and
// response.completed, whose response holds that item and the usage, a token
// a word. No [DONE] sentinel follows.
//
// The failure path is deliberate, and only one input takes it: a user's
// message whose text is exactly [Trigger], "/fail", posted to a
// conversation or as the last user input of a stateless request. Its reply
// streams the first [FailAfter] words of the script, then the spec's error
// event, {"type":"error","error":{"type","code","message","param"}}, and
// response.failed, whose response is failed, holds the partial output, and
// carries the error's code and message. A conversation keeps the user's
// message and gains no assistant message.
//
// A reply sets its connection's write deadline before it streams: the
// script's whole duration at the delta interval, plus the server's write
// timeout as grace, so a script longer than the server's write timeout
// still streams whole.
//
// All state is in memory, guarded by one mutex; nothing outlives the
// process.
//
// The package's API:
//
//   - [Service], built by [New] from a [Config]: Create, Conversation, and
//     List, the conversation store's operations; the reply and its stream
//     are the routes'.
//   - [Routes]: the conversations route group, and [ResponsesRoutes]: the
//     stateless route's, both of which the composition root mounts.
//   - [Conversation], the read shape, with [Item] and [Part], the history's
//     Open Responses items; [MessageRequest], a posted message.
//   - [Script], [Trigger], and [FailAfter]: the scripted reply and its
//     failure path.
//   - [ErrNotFound]: an unknown conversation id, a 404; [ErrValidation]: a
//     rejected input, a 400.
package conversation
