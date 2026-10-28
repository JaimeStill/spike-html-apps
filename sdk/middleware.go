package sdk

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/rs/cors"
	"github.com/standards-lab/go-web-sdk"
)

// corsMethods are the methods a preflight may ask for: the API's verbs. GET,
// HEAD, and POST are CORS-safelisted, but a request carrying Authorization
// is preflighted whatever its method, so they are listed with the rest.
var corsMethods = []string{
	http.MethodGet,
	http.MethodHead,
	http.MethodPost,
	http.MethodPut,
	http.MethodPatch,
	http.MethodDelete,
}

// corsHeaders are the request headers a preflight may ask for: Authorization
// for the bearer token, and Content-Type for a JSON body or a raw upload's
// file type, which is not a CORS-safelisted value. An upload sent with an
// XMLHttpRequest upload progress listener is preflighted on any body, so
// both arrive together in Access-Control-Request-Headers.
var corsHeaders = []string{"Authorization", "Content-Type"}

// CORS returns the middleware that admits cross-origin browser requests from
// allowedOrigins, over github.com/rs/cors.
//
// A preflight from an allowed origin, asking for one of the API's methods
// (GET, HEAD, POST, PUT, PATCH, DELETE) and no request headers beyond
// Authorization and Content-Type, is answered 204 with
// Access-Control-Allow-Origin naming the origin and the asked-for method and
// headers allowed; it never reaches the wrapped handler. Any other request
// from an allowed origin reaches the handler with Access-Control-Allow-Origin
// naming the origin. A disallowed origin gets no Access-Control-* header: its
// preflight is answered 204 bare, which the browser reads as a refusal, and
// its other requests reach the handler as they would without the middleware.
// A request with no Origin, a same-origin or non-browser one, reaches the
// handler with no Access-Control-* header (an OPTIONS carrying
// Access-Control-Request-Method is the exception: rs/cors reads it as a
// preflight and answers it 204 bare whatever its Origin). Every response that passes
// through, allowed or not, carries Vary: Origin, since whether it carries
// Access-Control-Allow-Origin depends on that header; a preflight carries
// Vary on its request headers as well.
//
// The middleware admits no credentials mode and no wildcard: it never sends
// Access-Control-Allow-Credentials, and every origin is matched exactly. An
// empty allowedOrigins admits no cross-origin request and returns a
// middleware that passes every request through untouched; rs/cors itself
// reads an empty list as every origin, which this function never hands it.
//
// CORS panics on an origin [ValidateOrigin] rejects. A configuration
// validates its origins with ValidateOrigin when it finalizes, so the panic
// marks a caller that skipped the check.
func CORS(allowedOrigins []string) web.Middleware {
	if len(allowedOrigins) == 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	for _, origin := range allowedOrigins {
		if err := ValidateOrigin(origin); err != nil {
			panic("sdk: CORS: " + err.Error())
		}
	}
	c := cors.New(cors.Options{
		AllowedOrigins: allowedOrigins,
		AllowedMethods: corsMethods,
		AllowedHeaders: corsHeaders,
	})
	return c.Handler
}

// ValidateOrigin reports whether origin is a serialized web origin CORS can
// match exactly: an http or https scheme, a host, and an optional port, as
// scheme://host[:port], with no userinfo, path (a trailing slash included),
// query, or fragment. It rejects "*" and any origin containing it, since the
// middleware admits no wildcard, and "null", which names no origin.
func ValidateOrigin(origin string) error {
	if origin == "" {
		return errors.New("origin is empty")
	}
	if strings.Contains(origin, "*") {
		return fmt.Errorf("origin %q: wildcards are not allowed", origin)
	}
	u, err := url.Parse(origin)
	if err != nil {
		return fmt.Errorf("origin %q: %w", origin, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("origin %q: want an http or https scheme://host[:port]", origin)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("origin %q: no host", origin)
	}
	// The serialized origin is exactly scheme://host[:port]; anything past
	// the host, a bare "/", "?", or "#" included, is not part of it.
	if u.User != nil || origin != u.Scheme+"://"+u.Host {
		return fmt.Errorf("origin %q: want scheme://host[:port], with no userinfo, path, query, or fragment", origin)
	}
	return nil
}
