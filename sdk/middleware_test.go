package sdk_test

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/JaimeStill/spike-html-apps/sdk"
)

const (
	allowed    = "http://localhost:5173"
	disallowed = "https://evil.example"
)

// served is the handler behind the middleware: it marks the response, so a
// test sees whether the request reached it.
var served = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("X-Served", "yes")
	w.WriteHeader(http.StatusTeapot)
})

// do sends req through the CORS middleware over served, admitting the
// allowed origin and a second one, so matching is per origin and not the
// first entry alone.
func do(t *testing.T, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	sdk.CORS([]string{"https://other.example:8443", allowed})(served).ServeHTTP(rec, req)
	return rec
}

func preflight(origin, method, headers string) *http.Request {
	req := httptest.NewRequest(http.MethodOptions, "/api/documents", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	req.Header.Set("Access-Control-Request-Method", method)
	if headers != "" {
		req.Header.Set("Access-Control-Request-Headers", headers)
	}
	return req
}

// assertNoCORS fails on any Access-Control-* response header.
func assertNoCORS(t *testing.T, h http.Header) {
	t.Helper()
	for name := range h {
		if strings.HasPrefix(name, "Access-Control-") {
			t.Errorf("response carries %s: %q, want no CORS header", name, h.Values(name))
		}
	}
}

// varies reports whether the Vary header lists name.
func varies(h http.Header, name string) bool {
	for _, v := range h.Values("Vary") {
		for f := range strings.SplitSeq(v, ",") {
			if strings.EqualFold(strings.TrimSpace(f), name) {
				return true
			}
		}
	}
	return false
}

// Each API method is preflighted with the Authorization and Content-Type
// headers, and each is admitted for the allowed origin without reaching the
// handler.
func TestCORS_PreflightFromAllowedOrigin(t *testing.T) {
	for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} {
		t.Run(method, func(t *testing.T) {
			rec := do(t, preflight(allowed, method, "authorization,content-type"))

			if rec.Code != http.StatusNoContent {
				t.Errorf("status = %d, want 204", rec.Code)
			}
			if rec.Header().Get("X-Served") != "" {
				t.Error("preflight reached the handler")
			}
			h := rec.Header()
			if got := h.Get("Access-Control-Allow-Origin"); got != allowed {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, allowed)
			}
			if got := h.Get("Access-Control-Allow-Methods"); got != method {
				t.Errorf("Access-Control-Allow-Methods = %q, want %q", got, method)
			}
			if got := h.Get("Access-Control-Allow-Headers"); got != "authorization,content-type" {
				t.Errorf("Access-Control-Allow-Headers = %q, want authorization,content-type", got)
			}
			if h.Get("Access-Control-Allow-Credentials") != "" {
				t.Error("preflight allows credentials")
			}
			if !varies(h, "Origin") {
				t.Errorf("Vary = %q, want it to list Origin", h.Values("Vary"))
			}
		})
	}
}

// The preflight a browser sends for an upload with progress: an
// XMLHttpRequest with an upload listener preflights a POST of a raw file
// body, typed with the file's Content-Type and carrying the bearer token.
func TestCORS_PreflightForUploadWithProgress(t *testing.T) {
	req := preflight(allowed, http.MethodPost, "authorization,content-type")
	rec := do(t, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != allowed {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, allowed)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got != http.MethodPost {
		t.Errorf("Access-Control-Allow-Methods = %q, want POST", got)
	}
	allowedHeaders := strings.Split(rec.Header().Get("Access-Control-Allow-Headers"), ",")
	for _, want := range []string{"authorization", "content-type"} {
		if !slices.Contains(allowedHeaders, want) {
			t.Errorf("Access-Control-Allow-Headers = %q, want it to admit %s", allowedHeaders, want)
		}
	}
}

// A preflight the middleware refuses gets no CORS header at all, which the
// browser reads as the refusal, and never reaches the handler.
func TestCORS_PreflightRefused(t *testing.T) {
	cases := map[string]*http.Request{
		"disallowed origin":   preflight(disallowed, http.MethodPost, "authorization,content-type"),
		"origin with a path":  preflight(allowed+"/", http.MethodPost, ""),
		"method not in API":   preflight(allowed, "PROPFIND", ""),
		"header not admitted": preflight(allowed, http.MethodPost, "authorization,x-custom"),
		"no origin":           preflight("", http.MethodPost, "authorization"),
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			rec := do(t, req)
			assertNoCORS(t, rec.Header())
			if rec.Header().Get("X-Served") != "" {
				t.Error("refused preflight reached the handler")
			}
		})
	}
}

func TestCORS_RequestFromAllowedOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/documents", strings.NewReader("{}"))
	req.Header.Set("Origin", allowed)
	rec := do(t, req)

	if rec.Code != http.StatusTeapot || rec.Header().Get("X-Served") != "yes" {
		t.Fatalf("status = %d, served = %q; want the handler's 418", rec.Code, rec.Header().Get("X-Served"))
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != allowed {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, allowed)
	}
	if !varies(rec.Header(), "Origin") {
		t.Errorf("Vary = %q, want it to list Origin", rec.Header().Values("Vary"))
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Error("response allows credentials")
	}
}

// A disallowed origin's request, and a same-origin or non-browser one with
// no Origin, reach the handler as they would without the middleware, with
// no CORS header.
func TestCORS_RequestPassesThroughWithoutCORS(t *testing.T) {
	for name, origin := range map[string]string{
		"disallowed origin": disallowed,
		"scheme mismatch":   "https://localhost:5173",
		"no origin":         "",
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/documents", nil)
			if origin != "" {
				req.Header.Set("Origin", origin)
			}
			rec := do(t, req)

			if rec.Code != http.StatusTeapot || rec.Header().Get("X-Served") != "yes" {
				t.Errorf("status = %d, served = %q; want the handler's 418", rec.Code, rec.Header().Get("X-Served"))
			}
			assertNoCORS(t, rec.Header())
		})
	}
}

// An empty list admits nothing, never every origin as rs/cors would read
// it, and leaves every request untouched, the preflight-shaped OPTIONS
// included.
func TestCORS_EmptyListAdmitsNothing(t *testing.T) {
	for _, origins := range [][]string{nil, {}} {
		rec := httptest.NewRecorder()
		sdk.CORS(origins)(served).ServeHTTP(rec, preflight(allowed, http.MethodPost, "authorization"))

		assertNoCORS(t, rec.Header())
		if rec.Header().Get("X-Served") != "yes" {
			t.Errorf("CORS(%#v) intercepted the request", origins)
		}
		if len(rec.Header().Values("Vary")) != 0 {
			t.Errorf("CORS(%#v) added Vary %q", origins, rec.Header().Values("Vary"))
		}
	}
}

func TestCORS_PanicsOnInvalidOrigin(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("CORS accepted the wildcard origin")
		}
	}()
	sdk.CORS([]string{allowed, "*"})
}

func TestValidateOrigin(t *testing.T) {
	for _, origin := range []string{
		"http://localhost:5173",
		"https://app.example",
		"https://app.example:8443",
		"http://127.0.0.1:8080",
		"http://[::1]:5173",
	} {
		if err := sdk.ValidateOrigin(origin); err != nil {
			t.Errorf("ValidateOrigin(%q) = %v, want nil", origin, err)
		}
	}
	for _, origin := range []string{
		"",
		"*",
		"https://*.example",
		"null",
		"localhost:5173",
		"//app.example",
		"ftp://app.example",
		"https://",
		"https://:8443",
		"https://app.example/",
		"https://app.example/path",
		"https://app.example?q=1",
		"https://app.example#top",
		"https://user@app.example",
		"https://app.example:port",
		" https://app.example",
	} {
		if err := sdk.ValidateOrigin(origin); err == nil {
			t.Errorf("ValidateOrigin(%q) = nil, want an error", origin)
		}
	}
}
