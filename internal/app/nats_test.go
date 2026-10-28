package app_test

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"strconv"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/JaimeStill/spike-html-apps/internal/app"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// Once ready, the embedded server accepts the configured token on its
// client listener, and the stream the broker owns is provisioned on it: the
// configured name, capturing the configured prefix, on file storage.
func TestRun_BrokerOwnsStreamOnEmbeddedServer(t *testing.T) {
	cfg := configtest.Config(t)
	r := start(t, cfg)
	waitForReady(t, r.log)

	nc, err := natsgo.Connect(fmt.Sprintf("nats://127.0.0.1:%d", *cfg.NATS.Port), natsgo.Token(configtest.Token))
	if err != nil {
		t.Fatalf("connect to the embedded server: %v", err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatalf("jetstream: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), failsafe)
	defer cancel()
	s, err := js.Stream(ctx, cfg.NATS.Stream)
	if err != nil {
		t.Fatalf("stream %s: %v", cfg.NATS.Stream, err)
	}
	got := s.CachedInfo().Config
	if want := []string{cfg.NATS.Prefix + ".>"}; !slices.Equal(got.Subjects, want) {
		t.Errorf("stream subjects = %q, want %q", got.Subjects, want)
	}
	if got.Storage != jetstream.FileStorage {
		t.Errorf("stream storage = %v, want file", got.Storage)
	}
}

// The cors block's origins reach the WebSocket listener too: it upgrades
// the allowed origin and refuses another.
func TestRun_WebSocketAdmitsCORSOrigins(t *testing.T) {
	cfg := configtest.Config(t)
	cfg.CORS.AllowedOrigins = []string{allowedOrigin}
	r := start(t, cfg)
	waitForReady(t, r.log)

	addr := net.JoinHostPort(cfg.NATS.WebSocket.Host, strconv.Itoa(*cfg.NATS.WebSocket.Port))
	for origin, want := range map[string]int{
		allowedOrigin:          http.StatusSwitchingProtocols,
		"https://evil.example": http.StatusForbidden,
	} {
		if got := wsUpgrade(t, addr, origin); got != want {
			t.Errorf("upgrade from %q = %d, want %d", origin, got, want)
		}
	}
}

// wsUpgrade sends a WebSocket upgrade from origin to addr and returns the
// response's status code.
func wsUpgrade(t *testing.T, addr, origin string) int {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, failsafe)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(failsafe))
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

// The broker sits in a layer above the embedded server, so the Coordinator
// starts the server before the broker connects, and drains the broker
// before the server stops.
func TestGraph_BrokerAboveNATS(t *testing.T) {
	a := app.New(configtest.Config(t), io.Discard)
	n := a.Nodes()
	sys := buildAsRun(t, a)
	if b, s := layerOf(sys, n.Broker.Name()), layerOf(sys, n.NATS.Name()); s < 0 || b <= s {
		t.Errorf("broker in layer %d, nats in layer %d; want the broker above the server", b, s)
	}
}
