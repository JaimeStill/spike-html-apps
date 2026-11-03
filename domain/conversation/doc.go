// Package conversation is the conversation domain layer: conversations with
// a scripted assistant, served under /api/conversations, and the stateless
// Open Responses route, /api/responses, both answered by one stream writer
// as an Open Responses (spec 2026-04-24) event stream, the form
// spike-ai-pipeline-client's format/responses decodes.
//
// A conversation is created by POST /api/conversations, which takes no
// body, listed by GET /api/conversations, paged like every listing, and read
// by GET /api/conversations/{id}, with its history: the ordered Open
// Responses items exchanged so far. A user's message is an input item,
// {"type":"message","role":"user","content":[{"type":"input_text",
// "text"}]}, and an assistant's an output item, {"type":"message","id",
// "role":"assistant","status":"completed","content":[{"type":"output_text",
// "text","annotations":[]}]}. The rich reply, below, adds its reasoning,
// {"type":"reasoning","id","status","summary":[{"type":"summary_text",
// "text"}],"content":[{"type":"reasoning_text","text"}]}, its function
// call, {"type":"function_call","id","status","call_id","name",
// "arguments"}, and the call's output, {"type":"function_call_output","id",
// "status","call_id","output"}, ahead of its message.
//
// POST /api/conversations/{id}/messages takes {"text": "..."}, which must
// not be blank, adds the user's message to the history, and answers with the
// scripted reply, [Script], as a text/event-stream. Once the reply has
// streamed whole, its items join the history; a reply the client cuts off,
// by closing the connection, ends the stream on the server and none of it
// joins.
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
// The rich reply is deliberate too, a test seam like the failure path and
// not a client API, and one input takes it: a user's message to a
// conversation whose text is exactly [RichTrigger], "/rich". It shows a
// thread's whole range, deterministically: in output order, each item at
// its own output_index and each event about it naming it by item_id,
//
//  1. a reasoning item, rs_ its id: response.output_item.added (in
//     progress, summary and content []), response.content_part.added (a
//     reasoning_text part), one response.reasoning.delta per word of
//     [RichReasoning], response.reasoning.done, response.content_part.done,
//     then response.reasoning_summary_part.added (a summary_text part,
//     summary_index 0), one response.reasoning_summary_text.delta per word
//     of [RichSummary], response.reasoning_summary_text.done,
//     response.reasoning_summary_part.done, and response.output_item.done;
//  2. a function_call of [RichFunction], fc_ its id and call_ its call_id:
//     response.output_item.added (in progress, arguments ""), one
//     response.function_call_arguments.delta per word of [RichArguments],
//     JSON text whose integer-like keys and integer past 2^53 stand as
//     written, response.function_call_arguments.done, and
//     response.output_item.done;
//  3. the call's function_call_output, fco_ its id: response.output_item.added
//     (in progress, output ""), then a delta interval later, as the function
//     runs, response.output_item.done holding [RichOutput];
//  4. the assistant's message, as the plain reply streams it, its text
//     [RichReply], Markdown: a heading, a list, a table, inline code, a code
//     block, and a link;
//
// then response.completed, holding the four. Every delta is a word with
// the whitespace after it, newlines included, so the deltas join to the
// text as written; the usage counts every delta an output token, the
// reasoning's and its summary's as reasoning tokens. The event names are
// the spec's: response.reasoning.delta and .done, which OpenAI names
// response.reasoning_text.delta and .done. The stateless route never
// streams it, since a function_call_output is an input item, which the
// spec's response output never holds.
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
// A reply sets its connection's write deadline before it streams: its
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
//     failure path; [RichTrigger], with [RichReasoning], [RichSummary],
//     [RichFunction], [RichArguments], [RichOutput], and [RichReply]: the
//     rich reply.
//   - [ErrNotFound]: an unknown conversation id, a 404; [ErrValidation]: a
//     rejected input, a 400.
package conversation
