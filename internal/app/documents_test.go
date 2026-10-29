package app_test

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/domain/document"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests drive the documents routes through the composed router over
// loopback HTTP, on the in-memory broker.

// uploadLimit is the documents block's limit these tests run under.
const uploadLimit = 64

// startDocuments runs the app with the upload limit set and returns its
// address and a client bound to it.
func startDocuments(t *testing.T) (string, *webtest.Client) {
	t.Helper()
	cfg := configtest.Config(t)
	cfg.Documents.MaxSize = new(int64(uploadLimit))
	addr := waitForReady(t, start(t, cfg).log)
	return addr, webtest.NewClient("http://" + addr)
}

// upload posts body under contentType as the document name and returns the
// response.
func upload(t *testing.T, c *webtest.Client, name, contentType string, body []byte) *webtest.Response {
	t.Helper()
	return c.Post(t, "/api/documents?name="+url.QueryEscape(name), webtest.Raw{ContentType: contentType, Body: body})
}

// An accepted upload answers 201 with the document: a fresh UUID, the name
// and content type as sent, the body's size, its creation time, and the run
// its upload started; its Location is the document's read, which answers
// the same document. Its content reads back as uploaded, under the same
// content type, as an attachment. Any well-formed media type is accepted,
// octet-stream included.
func TestDocuments_UploadReadsBack(t *testing.T) {
	_, c := startDocuments(t)

	for _, tc := range []struct{ name, contentType, body string }{
		{"notes.txt", "text/plain; charset=utf-8", "hello, pipeline"},
		{"blob.bin", "application/octet-stream", "\x00\x01\x02"},
		{"empty.md", "text/markdown", ""},
	} {
		before := time.Now().UTC()
		res := upload(t, c, tc.name, tc.contentType, []byte(tc.body))
		doc := webtest.Decode[document.Document](t, res, http.StatusCreated)
		if _, err := uuid.Parse(doc.ID); err != nil {
			t.Errorf("%s: id = %q, want a UUID", tc.name, doc.ID)
		}
		if doc.Name != tc.name || doc.ContentType != tc.contentType || doc.Size != int64(len(tc.body)) {
			t.Errorf("%s: document = %+v, want name %q, content type %q, size %d", tc.name, doc, tc.name, tc.contentType, len(tc.body))
		}
		if doc.CreatedAt.Before(before.Add(-time.Second)) || doc.CreatedAt.After(time.Now().Add(time.Second)) {
			t.Errorf("%s: created_at = %s, want about now", tc.name, doc.CreatedAt)
		}
		if _, err := uuid.Parse(doc.RunID); err != nil {
			t.Errorf("%s: run_id = %q, want a run's UUID", tc.name, doc.RunID)
		}
		if got, want := res.Header.Get("Location"), "/api/documents/"+doc.ID; got != want {
			t.Errorf("%s: Location = %q, want %q", tc.name, got, want)
		}

		read := webtest.Decode[document.Document](t, c.Get(t, "/api/documents/"+doc.ID), http.StatusOK)
		if read != doc {
			t.Errorf("%s: read = %+v, want the upload's %+v", tc.name, read, doc)
		}

		content := c.Get(t, "/api/documents/"+doc.ID+"/content").Expect(t, http.StatusOK)
		if string(content.Body) != tc.body {
			t.Errorf("%s: content = %q, want %q", tc.name, content.Body, tc.body)
		}
		if got := content.Header.Get("Content-Type"); got != tc.contentType {
			t.Errorf("%s: content Content-Type = %q, want %q", tc.name, got, tc.contentType)
		}
		if got := content.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment;") || !strings.Contains(got, tc.name) {
			t.Errorf("%s: Content-Disposition = %q, want an attachment named %s", tc.name, got, tc.name)
		}
	}
}

// Each refusal is an RFC 9457 problem with its status, and stores nothing:
// a declared length over the limit 413, a body with no Content-Type or a
// malformed one 415, a chunked body with no Content-Length 411, and a
// missing name 400. A body at the limit exactly is accepted.
func TestDocuments_UploadRefusals(t *testing.T) {
	addr, c := startDocuments(t)

	over := strings.Repeat("x", uploadLimit+1)
	_ = upload(t, c, "big.txt", "text/plain", []byte(over)).Problem(t, http.StatusRequestEntityTooLarge)
	_ = upload(t, c, "untyped.txt", "", []byte("x")).Problem(t, http.StatusUnsupportedMediaType)
	_ = upload(t, c, "bad.txt", "text", []byte("x")).Problem(t, http.StatusUnsupportedMediaType)
	_ = c.Post(t, "/api/documents", webtest.Raw{ContentType: "text/plain", Body: []byte("x")}).Problem(t, http.StatusBadRequest)

	// A chunked body declares no length; net/http's client sends one for a
	// body of unknown length.
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/api/documents?name=chunked.txt", io.MultiReader(strings.NewReader("x")))
	if err != nil {
		t.Fatalf("new chunked request: %v", err)
	}
	req.Header.Set("Content-Type", "text/plain")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("chunked upload: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusLengthRequired {
		t.Errorf("chunked upload = %d, want 411", resp.StatusCode)
	}

	page := webtest.Decode[docPage](t, c.Get(t, "/api/documents"), http.StatusOK)
	if len(page.Items) != 0 || page.Total == nil || *page.Total != 0 {
		t.Errorf("listing after refusals = %+v, want empty", page)
	}

	upload(t, c, "full.txt", "text/plain", []byte(strings.Repeat("x", uploadLimit))).Expect(t, http.StatusCreated)
}

// The limit is checked before any byte is read: a request that declares a
// length over it and sends no body at all is answered 413 at once. Were the
// server to read the body first, it would wait for bytes that never come
// and the read deadline below would fail the test.
func TestDocuments_LimitCheckedBeforeBodyRead(t *testing.T) {
	addr, _ := startDocuments(t)

	conn, err := net.DialTimeout("tcp", addr, failsafe)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(failsafe))
	if _, err := fmt.Fprintf(conn, "POST /api/documents?name=big.txt HTTP/1.1\r\nHost: test\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n", 1<<30); err != nil {
		t.Fatalf("write headers: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
}

// docPage is the page envelope of the documents listing.
type docPage struct {
	Items []document.Document `json:"items"`
	Page  int                 `json:"page"`
	Size  int                 `json:"size"`
	Total *int                `json:"total"`
	More  bool                `json:"more"`
}

// The listing is go-web-sdk's page envelope over the documents in upload
// order, with the total, paged by number under the reads block's policy. It
// takes no filter and no sort.
func TestDocuments_ListPages(t *testing.T) {
	_, c := startDocuments(t)
	var ids []string
	for _, name := range []string{"a.txt", "b.txt", "c.txt"} {
		ids = append(ids, webtest.Decode[document.Document](t, upload(t, c, name, "text/plain", []byte(name)), http.StatusCreated).ID)
	}

	first := webtest.Decode[docPage](t, c.Get(t, "/api/documents?size=2"), http.StatusOK)
	if first.Page != 1 || first.Size != 2 || first.Total == nil || *first.Total != 3 || !first.More {
		t.Errorf("first page = %+v, want page 1 of size 2, total 3, more", first)
	}
	second := webtest.Decode[docPage](t, c.Get(t, "/api/documents?size=2&page=2"), http.StatusOK)
	if second.Page != 2 || second.More {
		t.Errorf("second page = %+v, want page 2 and no more", second)
	}
	var got []string
	for _, d := range append(first.Items, second.Items...) {
		got = append(got, d.ID)
	}
	if fmt.Sprint(got) != fmt.Sprint(ids) {
		t.Errorf("listed ids = %v, want the uploads in order %v", got, ids)
	}

	for _, q := range []string{"name=a.txt", "sort=name", "size=0"} {
		_ = c.Get(t, "/api/documents?"+q).Problem(t, http.StatusBadRequest)
	}
}

// An id the store does not hold is a 404 problem, for the read and the
// content alike; a malformed id is a 400.
func TestDocuments_UnknownID(t *testing.T) {
	_, c := startDocuments(t)
	unknown := uuid.NewV4().String()
	_ = c.Get(t, "/api/documents/"+unknown).Problem(t, http.StatusNotFound)
	_ = c.Get(t, "/api/documents/"+unknown+"/content").Problem(t, http.StatusNotFound)
	_ = c.Get(t, "/api/documents/not-a-uuid").Problem(t, http.StatusBadRequest)
}
