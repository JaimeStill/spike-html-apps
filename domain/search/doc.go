// Package search is the search domain layer: a case-insensitive search of
// the uploaded documents' names and text content, served under
// /api/search.
//
// A search is GET /api/search?q=<query>, paged like every listing. The
// query is trimmed of surrounding whitespace and matched literally,
// case-insensitively by Unicode simple case folding, against each
// document's name and, for a text-like document, its content. A document
// is text-like when its media type, parsed with its parameters (a charset,
// say) ignored, is text/*, application/json, or any +json type; any other
// document, or one whose content type does not parse, matches on its name
// alone. Content that is not valid UTF-8 is searched with each invalid
// sequence read as U+FFFD.
//
// Matches come in document creation order, each with the document's id
// and name, where the match was found, and a snippet around the first
// match: from the content when the content matches, else from the name.
// A snippet holds the match with up to [Context] runes on each side, its
// runs of whitespace collapsed to one space, and an ellipsis (U+2026) at
// either end that stops short of the text's own.
//
// A missing or blank query, a second q, a filter other than q, or a sort
// is a *web.QueryError, a 400.
//
// The package's API:
//
//   - [Service], built by [New] over a [Source]: Search, the layer's one
//     operation.
//   - [Source]: what yields the documents a search scans, the document
//     layer's service in the composition.
//   - [Routes]: the route group the composition root mounts.
//   - [Match], the read shape, with [Field] ([InName], [InContent]).
//   - [Context]: the runes a snippet keeps on each side of the match.
package search
