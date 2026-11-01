//go:build integration

package integration_test

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"syscall"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/standards-lab/go-web-sdk"
	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/integration"
)

// The browser origin these cases admit, a Vite dev server's.
const allowedOrigin = "http://localhost:5173"

// storeRecord matches the store attribute of the embedded server's start
// record in the text log format.
var storeRecord = regexp.MustCompile(`msg="nats started" .*store=(\S+)`)

// dial connects to url with the nats.go client, presenting tok when it is
// set; the connection is nil when err isn't.
func dial(url, tok string) (*natsgo.Conn, error) {
	opts := []natsgo.Option{natsgo.Timeout(2 * time.Second), natsgo.NoReconnect()}
	if tok != "" {
		opts = append(opts, natsgo.Token(tok))
	}
	return natsgo.Connect(url, opts...)
}

// connect dials url presenting tok, and closes the connection on success.
func connect(url, tok string) error {
	nc, err := dial(url, tok)
	if err != nil {
		return err
	}
	nc.Close()
	return nil
}

// refusal says how the server refused a connection whose CONNECT carried a
// missing or wrong token, or why err is no refusal. The client writes
// CONNECT and then PING, each a write of its own (over WebSocket, a frame of
// its own), and reads the server's answer to them. The server answers the
// CONNECT with -ERR 'Authorization Violation' and closes the connection, so
// the client sees one of two things, by the race between that close and its
// PING:
//
//   - the -ERR, read before the close lands: nats.ErrAuthorization;
//   - the close, which lands first: the PING's write fails with EPIPE, or the
//     read fails with ECONNRESET (the PING arriving at a closed socket resets
//     it, discarding the -ERR unread) or with io.EOF (the end of the stream,
//     or over WebSocket the server's close frame).
//
// Both are the server ending the connection before the client could use it.
// Anything else, a timeout, a refused dial, another protocol error, is no
// refusal: the server never answered the CONNECT, or didn't end it.
func refusal(err error) (string, bool) {
	switch {
	case errors.Is(err, natsgo.ErrAuthorization):
		return "authorization violation", true
	case errors.Is(err, syscall.EPIPE), errors.Is(err, syscall.ECONNRESET), errors.Is(err, io.EOF):
		return "connection closed before the handshake completed", true
	}
	return "", false
}

// upgrade sends a WebSocket upgrade from origin to addr and returns the
// response's status code.
func upgrade(t *testing.T, addr, origin string) int {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/", nil)
	if err != nil {
		t.Fatalf("new upgrade request: %v", err)
	}
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Origin", origin)
	if err := req.Write(conn); err != nil {
		t.Fatalf("write upgrade request: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		t.Fatalf("read upgrade response: %v", err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

// The emulator boots with its embedded NATS server, and the readiness
// probe reports the server and the broker that owns the stream, both
// ready, beside the coordinator.
func TestNATS_ReadinessListsServerAndBroker(t *testing.T) {
	s := integration.Start(t, integration.Options{})

	ready := webtest.Decode[readiness](t, s.Client().Get(t, web.ReadyPath), http.StatusOK)
	got := map[string]bool{}
	for _, ch := range ready.Checks {
		got[ch.Name] = ch.Ready
	}
	for _, name := range []string{"lifecycle", "nats", "broker"} {
		if !got[name] {
			t.Errorf("readyz checks = %+v, want %s listed and ready", ready.Checks, name)
		}
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
}

// A WebSocket client with the configured token connects; one with no
// token, or another, is refused: the server ends the connection before the
// handshake completes, so the client never holds a connection to publish or
// subscribe on (refusal names the two ways the client sees it). The client
// listener holds the same line.
func TestNATS_TokenRequired(t *testing.T) {
	s := integration.Start(t, integration.Options{})

	for listener, url := range map[string]string{"websocket": s.WebSocketURL(), "client": s.NATSURL()} {
		if err := connect(url, integration.Token); err != nil {
			t.Errorf("%s: connect with the token: %v", listener, err)
		}
		for name, tok := range map[string]string{"no token": "", "wrong token": "not-the-token"} {
			nc, err := dial(url, tok)
			if nc != nil {
				// Connected: a publish would land, the server having authenticated it.
				nc.Close()
				t.Errorf("%s: connect with %s succeeded, want it refused", listener, name)
				continue
			}
			if how, ok := refusal(err); !ok {
				t.Errorf("%s: connect with %s = %v, want an authorization violation or the server closing the connection", listener, name, err)
			} else {
				t.Logf("%s: connect with %s refused: %s (%v)", listener, name, how, err)
			}
		}
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
}

// The WebSocket listener upgrades only an origin on the cors block's list;
// with the list empty, the default, it upgrades no cross-origin request.
func TestNATS_WebSocketOrigins(t *testing.T) {
	cases := map[string]struct {
		env  []string
		want map[string]int
	}{
		"origin configured": {
			env: []string{"EMULATOR_CORS_ALLOWED_ORIGINS=" + allowedOrigin},
			want: map[string]int{
				allowedOrigin:          http.StatusSwitchingProtocols,
				"https://evil.example": http.StatusForbidden,
			},
		},
		"no origins": {
			want: map[string]int{
				allowedOrigin:          http.StatusForbidden,
				"https://evil.example": http.StatusForbidden,
			},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			s := integration.Start(t, integration.Options{Env: tc.env})
			for origin, want := range tc.want {
				if got := upgrade(t, s.WebSocketAddr(), origin); got != want {
					t.Errorf("upgrade from %q = %d, want %d", origin, got, want)
				}
			}
			if code := s.Stop(t); code != 0 {
				t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
			}
		})
	}
}

// The JetStream store the emulator logs at start exists while it runs, and
// once the drain finishes it no longer does.
func TestNATS_StoreRemovedAfterDrain(t *testing.T) {
	s := integration.Start(t, integration.Options{})

	m := storeRecord.FindStringSubmatch(s.Output())
	if m == nil {
		t.Fatalf("no store in the start record:\n%s", s.Output())
	}
	store := m[1]
	if info, err := os.Stat(store); err != nil || !info.IsDir() {
		t.Fatalf("store %s while running: %v, want a directory", store, err)
	}

	if code := s.Stop(t); code != 0 {
		t.Fatalf("exit = %d, want 0:\n%s", code, s.Output())
	}
	if _, err := os.Stat(store); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("store %s after the drain: %v, want it removed", store, err)
	}
}
