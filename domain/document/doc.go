// Package document is the document domain layer: the files a client
// uploads to the emulated pipeline, held in memory and served under
// /api/documents.
//
// An upload is a raw body, the file's bytes under its own Content-Type,
// with a declared Content-Length and the file's name as the name query
// parameter. The route refuses it by its headers before reading a byte:
// go-web-sdk's ReadUpload answers a missing or malformed Content-Type with
// a 415, a missing Content-Length (a chunked body) with a 411, and a
// declared length over the configured limit with a 413; a missing name is
// a 400. Any well-formed media type is accepted, since the content is
// served back only as an attachment. Each accepted upload starts a run for
// the document through the [Starter] the layer is built with, and the
// document records that run's id.
//
// All state is in memory, guarded by one mutex; nothing outlives the
// process.
//
// The package's API:
//
//   - [Service], built by [New]: Upload, Document, List, and Content, the
//     layer's operations, one per endpoint; and All, every document with
//     its bytes, the read the search layer scans.
//   - [Starter]: what starts a run for an accepted document, the run
//     layer's service in the composition.
//   - [Routes]: the route group the composition root mounts.
//   - [Document], the read shape and the upload's result, and [Content],
//     the download.
//   - [ErrNotFound]: an unknown document id, a 404; [ErrValidation]: an
//     upload's rejected input, a 400.
package document
