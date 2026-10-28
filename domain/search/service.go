package search

import (
	"iter"
	"mime"
	"strings"
	"unicode"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/domain/document"
)

// Source yields every document with its bytes, in creation order.
type Source interface {
	All() iter.Seq2[document.Document, []byte]
}

// Service is the search layer, reading the documents of its [Source]. It
// holds no state of its own and is safe for concurrent use as its Source
// is.
type Service struct {
	documents Source
}

// New returns the layer's service over documents.
func New(documents Source) *Service {
	return &Service{documents: documents}
}

// Search returns the page of matches for the q filter that query
// addresses, in document creation order, with their total. The one filter
// it takes is q, once, with no operator, and not blank; any other filter,
// a missing or blank q, or a sort is a *web.QueryError.
func (s *Service) Search(query web.Query) ([]Match, web.Paging, error) {
	if len(query.Sort) > 0 {
		return nil, web.Paging{}, &web.QueryError{Param: "sort", Value: query.Sort[0].Field, Reason: "matches list in document creation order only"}
	}
	q := ""
	for _, f := range query.Filters {
		if f.Field != "q" || f.Op != "" || len(f.Values) != 1 {
			return nil, web.Paging{}, &web.QueryError{Param: f.Field, Value: first(f.Values), Reason: "the one parameter besides paging is q, the query, once"}
		}
		q = strings.TrimSpace(f.Values[0])
	}
	if q == "" {
		return nil, web.Paging{}, &web.QueryError{Param: "q", Value: q, Reason: "a non-blank query is required"}
	}
	needle := []rune(q)

	var matched []Match
	for doc, b := range s.documents.All() {
		m := Match{ID: doc.ID, Name: doc.Name}
		if textLike(doc.ContentType) {
			if snippet, ok := find(strings.ToValidUTF8(string(b), "�"), needle); ok {
				m.Field, m.Snippet = InContent, snippet
				matched = append(matched, m)
				continue
			}
		}
		if snippet, ok := find(strings.ToValidUTF8(doc.Name, "�"), needle); ok {
			m.Field, m.Snippet = InName, snippet
			matched = append(matched, m)
		}
	}

	total := len(matched)
	from := min((query.Page-1)*query.Size, total)
	to := min(from+query.Size, total)
	items := make([]Match, 0, to-from)
	items = append(items, matched[from:to]...)
	return items, web.Paging{Total: &total, More: to < total}, nil
}

// first returns the first of values, or "".
func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

// textLike reports whether a document of contentType has content a search
// reads: a media type, parameters ignored, of text/*, application/json, or
// any +json type. A content type that does not parse is not text-like.
func textLike(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	return strings.HasPrefix(mt, "text/") || mt == "application/json" || strings.HasSuffix(mt, "+json")
}

// find looks for needle in text, case-insensitively, and returns the
// snippet around its first occurrence. text must be valid UTF-8.
func find(text string, needle []rune) (string, bool) {
	runes := []rune(text)
	at := index(runes, needle)
	if at < 0 {
		return "", false
	}
	return snippet(runes, at, at+len(needle)), true
}

// index returns the rune offset of needle's first occurrence in runes,
// compared rune by rune under Unicode simple case folding, or -1. Folding
// rune by rune keeps every offset a rune offset, which lowering both
// strings would not: a rune's lower case may differ in its length.
func index(runes, needle []rune) int {
	for i := 0; i+len(needle) <= len(runes); i++ {
		j := 0
		for j < len(needle) && equalFold(runes[i+j], needle[j]) {
			j++
		}
		if j == len(needle) {
			return i
		}
	}
	return -1
}

// equalFold reports whether a and b are equal under simple case folding.
func equalFold(a, b rune) bool {
	if a == b {
		return true
	}
	for r := unicode.SimpleFold(a); r != a; r = unicode.SimpleFold(r) {
		if r == b {
			return true
		}
	}
	return false
}

// snippet returns runes[from:to] with up to [Context] runes on each side,
// whitespace runs collapsed to one space and the ends trimmed, and an
// ellipsis at an end the window stops short of the text's. The window is
// cut in runes, so it never splits a multi-byte character.
func snippet(runes []rune, from, to int) string {
	start, end := max(from-Context, 0), min(to+Context, len(runes))
	var b strings.Builder
	if start > 0 {
		b.WriteRune('\u2026')
	}
	b.WriteString(strings.Join(strings.Fields(string(runes[start:end])), " "))
	if end < len(runes) {
		b.WriteRune('\u2026')
	}
	return b.String()
}
