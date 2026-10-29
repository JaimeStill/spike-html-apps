package app_test

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/domain/document"
	"github.com/JaimeStill/spike-html-apps/domain/search"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests drive the search route through the composed router over
// loopback HTTP, on the in-memory broker, searching documents uploaded
// through the documents route.

// startSearch runs the app with an upload limit roomy enough for a snippet
// cut at both ends, and returns a client bound to it.
func startSearch(t *testing.T) *webtest.Client {
	t.Helper()
	cfg := configtest.Config(t)
	cfg.Documents.MaxSize = new(int64(4096))
	return webtest.NewClient("http://" + waitForReady(t, start(t, cfg).log))
}

// searchPage is the page envelope of a search.
type searchPage struct {
	Items []search.Match `json:"items"`
	Page  int            `json:"page"`
	Size  int            `json:"size"`
	Total *int           `json:"total"`
	More  bool           `json:"more"`
}

// find searches for q, with any extra query parameters, and returns the
// page it answers 200 with.
func find(t *testing.T, c *webtest.Client, q, extra string) searchPage {
	t.Helper()
	return webtest.Decode[searchPage](t, c.Get(t, "/api/search?q="+url.QueryEscape(q)+extra), http.StatusOK)
}

// uploaded uploads body under contentType as the document name and returns
// its id.
func uploaded(t *testing.T, c *webtest.Client, name, contentType, body string) string {
	t.Helper()
	return webtest.Decode[document.Document](t, upload(t, c, name, contentType, []byte(body)), http.StatusCreated).ID
}

// A query matches case-insensitively against every document's name, and
// against the content of a text-like one: text/*, application/json, or a
// +json type, its media type parsed with any parameter ignored. A binary
// document, or one whose type is not text-like, matches on its name alone.
// A match in the content snippets the content; a match in the name alone
// snippets the name.
func TestSearch_NamesAndTextContent(t *testing.T) {
	c := startSearch(t)
	plain := uploaded(t, c, "notes.txt", "text/plain", "the quick brown Fox")
	report := uploaded(t, c, "Fox-Report.md", "text/markdown", "nothing to see")
	both := uploaded(t, c, "fox.txt", "text/plain", "a fox, twice: fox")
	blob := uploaded(t, c, "blob.bin", "application/octet-stream", "a fox in binary")
	xml := uploaded(t, c, "feed.xml", "application/xml", "<fox/>")
	jsonDoc := uploaded(t, c, "data.json", "application/json", `{"animal":"teal"}`)
	plusJSON := uploaded(t, c, "api.dat", "application/vnd.api+json; charset=utf-8", `{"color":"Teal"}`)
	charset := uploaded(t, c, "cs.dat", "Text/Plain; charset=UTF-8", "teal duck")

	for _, tc := range []struct {
		q    string
		want []search.Match
	}{
		{"FOX", []search.Match{
			{ID: plain, Name: "notes.txt", Field: search.InContent, Snippet: "the quick brown Fox"},
			{ID: report, Name: "Fox-Report.md", Field: search.InName, Snippet: "Fox-Report.md"},
			{ID: both, Name: "fox.txt", Field: search.InContent, Snippet: "a fox, twice: fox"},
		}},
		{"binary", nil},
		{"blob", []search.Match{{ID: blob, Name: "blob.bin", Field: search.InName, Snippet: "blob.bin"}}},
		{"feed", []search.Match{{ID: xml, Name: "feed.xml", Field: search.InName, Snippet: "feed.xml"}}},
		{"tEAL", []search.Match{
			{ID: jsonDoc, Name: "data.json", Field: search.InContent, Snippet: `{"animal":"teal"}`},
			{ID: plusJSON, Name: "api.dat", Field: search.InContent, Snippet: `{"color":"Teal"}`},
			{ID: charset, Name: "cs.dat", Field: search.InContent, Snippet: "teal duck"},
		}},
		{"  duck\t", []search.Match{{ID: charset, Name: "cs.dat", Field: search.InContent, Snippet: "teal duck"}}},
	} {
		page := find(t, c, tc.q, "")
		if fmt.Sprint(page.Items) != fmt.Sprint(tc.want) {
			t.Errorf("q=%q: matches = %+v, want %+v", tc.q, page.Items, tc.want)
		}
		if page.Total == nil || *page.Total != len(tc.want) {
			t.Errorf("q=%q: total = %v, want %d", tc.q, page.Total, len(tc.want))
		}
	}
}

// A snippet keeps the match with up to search.Context runes on each side,
// cut in runes so a multi-byte character is never split, and marks an end
// it stops short of with an ellipsis; an end within the window has none.
// Whitespace runs collapse to one space. Case folding is Unicode's, so a
// multi-byte query matches its other case.
func TestSearch_Snippet(t *testing.T) {
	c := startSearch(t)
	n := search.Context
	cut := uploaded(t, c, "cut.txt", "text/plain; charset=utf-8", strings.Repeat("é", n+1)+"ÉCOLE"+strings.Repeat("ü", n+1))
	edge := uploaded(t, c, "edge.txt", "text/plain", strings.Repeat("ø", n)+"Needle"+strings.Repeat("ø", n))
	spaced := uploaded(t, c, "spaced.txt", "text/plain", "\n  one \t\n two   pin\r\n three  ")

	for _, tc := range []struct {
		q, id, want string
	}{
		{"école", cut, "…" + strings.Repeat("é", n) + "ÉCOLE" + strings.Repeat("ü", n) + "…"},
		{"NEEDLE", edge, strings.Repeat("ø", n) + "Needle" + strings.Repeat("ø", n)},
		{"two", spaced, "one two pin three"},
	} {
		page := find(t, c, tc.q, "")
		if len(page.Items) != 1 || page.Items[0].ID != tc.id {
			t.Errorf("q=%q: matches = %+v, want the one document %s", tc.q, page.Items, tc.id)
			continue
		}
		got := page.Items[0].Snippet
		if !utf8.ValidString(got) {
			t.Errorf("q=%q: snippet %q is not valid UTF-8", tc.q, got)
		}
		if got != tc.want {
			t.Errorf("q=%q: snippet = %q, want %q", tc.q, got, tc.want)
		}
	}
}

// A search pages like a listing, under the reads block's policy, over its
// matches in document creation order with their total; a document that
// does not match takes no place in the order, and a name match keeps its
// place among content matches.
func TestSearch_Pages(t *testing.T) {
	c := startSearch(t)
	want := []string{
		uploaded(t, c, "a.txt", "text/plain", "teal one"),
		uploaded(t, c, "c.txt", "text/plain", "teal two"),
	}
	_ = uploaded(t, c, "b.txt", "text/plain", "grey")
	want = append(want,
		uploaded(t, c, "teal.bin", "application/octet-stream", "x"),
		uploaded(t, c, "d.txt", "text/plain", "teal three"),
	)

	first := find(t, c, "teal", "&size=3")
	if first.Page != 1 || first.Size != 3 || first.Total == nil || *first.Total != 4 || !first.More {
		t.Errorf("first page = %+v, want page 1 of size 3, total 4, more", first)
	}
	second := find(t, c, "teal", "&size=3&page=2")
	if second.Page != 2 || second.More || second.Total == nil || *second.Total != 4 {
		t.Errorf("second page = %+v, want page 2 of total 4 and no more", second)
	}
	var got []string
	for _, m := range append(first.Items, second.Items...) {
		got = append(got, m.ID)
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("matched ids = %v, want the matches in creation order %v", got, want)
	}
}

// A missing, empty, or blank query is a 400 problem, as are a second q, a
// q with an operator, any other filter, a sort, and a malformed page size.
func TestSearch_Refusals(t *testing.T) {
	c := startSearch(t)
	_ = uploaded(t, c, "a.txt", "text/plain", "teal")
	for _, query := range []string{
		"", "?q=", "?q=%20%20%09", "?q=teal&q=duck", "?q[eq]=teal",
		"?q=teal&name=a.txt", "?q=teal&sort=name", "?q=teal&size=0",
	} {
		_ = c.Get(t, "/api/search"+query).Problem(t, http.StatusBadRequest)
	}
}
