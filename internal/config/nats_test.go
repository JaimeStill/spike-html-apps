package config_test

import (
	"net/url"
	"strings"
	"testing"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// Pins the documented defaults: the client listener on 127.0.0.1:4222, the
// WebSocket listener on 0.0.0.0:4223, and the EMULATOR stream under the
// emulator prefix.
func TestNATS_FinalizeDefaults(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	n := cfg.NATS
	if got := n.Addr(); got != "127.0.0.1:4222" {
		t.Errorf("NATS.Addr() = %s, want 127.0.0.1:4222", got)
	}
	if got := n.WebSocketAddr(); got != "0.0.0.0:4223" {
		t.Errorf("NATS.WebSocketAddr() = %s, want 0.0.0.0:4223", got)
	}
	if n.Stream != "EMULATOR" || n.Prefix != "emulator" {
		t.Errorf("NATS stream, prefix = %q, %q, want EMULATOR, emulator", n.Stream, n.Prefix)
	}
	if n.Env != (config.NATSEnv{}) {
		t.Errorf("NATS.Env = %+v, want empty under the empty prefix", n.Env)
	}
}

func TestNATS_FinalizeEnvOverrides(t *testing.T) {
	t.Setenv("EMULATOR_NATS_TOKEN", "from-env")
	t.Setenv("EMULATOR_NATS_PORT", "14222")
	t.Setenv("EMULATOR_NATS_WEBSOCKET_HOST", "127.0.0.1")
	t.Setenv("EMULATOR_NATS_WEBSOCKET_PORT", "14223")
	t.Setenv("EMULATOR_NATS_STREAM", "EVENTS")
	t.Setenv("EMULATOR_NATS_PREFIX", "pipeline")

	cfg := &config.Config{}
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	n := cfg.NATS
	if n.Token != "from-env" {
		t.Errorf("NATS.Token = %q, want from-env", n.Token)
	}
	if n.Addr() != "127.0.0.1:14222" || n.WebSocketAddr() != "127.0.0.1:14223" {
		t.Errorf("NATS addrs = %s, %s, want 127.0.0.1:14222, 127.0.0.1:14223", n.Addr(), n.WebSocketAddr())
	}
	if n.Stream != "EVENTS" || n.Prefix != "pipeline" {
		t.Errorf("NATS stream, prefix = %q, %q, want EVENTS, pipeline", n.Stream, n.Prefix)
	}
	want := config.NATSEnv{
		Token:         "EMULATOR_NATS_TOKEN",
		Port:          "EMULATOR_NATS_PORT",
		WebSocketHost: "EMULATOR_NATS_WEBSOCKET_HOST",
		WebSocketPort: "EMULATOR_NATS_WEBSOCKET_PORT",
		PublicURL:     "EMULATOR_NATS_WEBSOCKET_PUBLIC_URL",
		Stream:        "EMULATOR_NATS_STREAM",
		Prefix:        "EMULATOR_NATS_PREFIX",
	}
	if n.Env != want {
		t.Errorf("NATS.Env = %+v, want %+v", n.Env, want)
	}
}

func TestNATS_FinalizeRejectsInvalidBlock(t *testing.T) {
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"no token":            {map[string]string{"EMULATOR_NATS_TOKEN": ""}, "token is required"},
		"port zero":           {map[string]string{"EMULATOR_NATS_PORT": "0"}, "nats: port: must be in 1-65535"},
		"websocket port high": {map[string]string{"EMULATOR_NATS_WEBSOCKET_PORT": "70000"}, "websocket.port: must be in 1-65535"},
		"port not a number":   {map[string]string{"EMULATOR_NATS_PORT": "many"}, "EMULATOR_NATS_PORT"},
		"stream with a dot":   {map[string]string{"EMULATOR_NATS_STREAM": "a.b"}, "stream:"},
		"prefix wildcard":     {map[string]string{"EMULATOR_NATS_PREFIX": "emulator.*"}, "prefix:"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("EMULATOR_NATS_TOKEN", "a-token")
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			err := (&config.Config{}).Finalize("emulator")
			if err == nil {
				t.Fatal("Finalize accepted an invalid nats block")
			}
			if !strings.Contains(err.Error(), "nats:") || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want the nats block wrap naming %q", err, tc.want)
			}
		})
	}
}

func TestNATS_MergeOverlaysSetFields(t *testing.T) {
	base := &config.Config{}
	base.NATS.Token = "base"
	base.NATS.Port = new(4222)
	base.NATS.WebSocket.Host = "0.0.0.0"

	overlay := &config.Config{}
	overlay.NATS.Token = "overlay"
	overlay.NATS.WebSocket.Host = "127.0.0.1"
	overlay.NATS.WebSocket.Port = new(5000)

	base.Merge(overlay)

	n := base.NATS
	if n.Token != "overlay" || n.WebSocket.Host != "127.0.0.1" || *n.WebSocket.Port != 5000 {
		t.Errorf("NATS = %+v, want the overlay's token, websocket host, and port", n)
	}
	// A field the overlay leaves unset keeps the base value.
	if *n.Port != 4222 {
		t.Errorf("NATS.Port = %d, want the base's 4222", *n.Port)
	}
}

// The broker connects to the client listener with the token as the URL's
// user, escaped, so a token with URL syntax in it still parses back to
// itself; it owns the block's stream under its prefix.
func TestNATS_BrokerConfig(t *testing.T) {
	cfg := withToken()
	cfg.NATS.Token = "s3cret/@:token"
	cfg.NATS.Port = new(14222)
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	b := cfg.NATS.Broker()
	u, err := url.Parse(b.URL)
	if err != nil {
		t.Fatalf("parse broker URL %q: %v", b.URL, err)
	}
	if u.Scheme != "nats" || u.Host != "127.0.0.1:14222" {
		t.Errorf("broker URL = %s, want nats://…@127.0.0.1:14222", b.URL)
	}
	if _, hasPass := u.User.Password(); u.User.Username() != cfg.NATS.Token || hasPass {
		t.Errorf("broker URL user = %v, want the token alone", u.User)
	}
	if b.Stream != "EMULATOR" || b.Prefix != "emulator" || b.Owner == nil || !*b.Owner {
		t.Errorf("broker config = %+v, want the owner of EMULATOR under emulator", b)
	}
	if err := b.Validate(); err != nil {
		t.Errorf("broker config Validate: %v", err)
	}
}

// nats is the file key, with token, port, websocket.host, and
// websocket.port beneath it.
func TestLoad_NATSKeys(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"nats": {"token": "from-file", "port": 14222,
		"websocket": {"host": "127.0.0.1", "port": 14223}, "stream": "EVENTS", "prefix": "pipeline"}}`})
	t.Setenv("EMULATOR_NATS_TOKEN", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	n := cfg.NATS
	if n.Token != "from-file" || n.Addr() != "127.0.0.1:14222" || n.WebSocketAddr() != "127.0.0.1:14223" ||
		n.Stream != "EVENTS" || n.Prefix != "pipeline" {
		t.Errorf("NATS = %+v, want the file's block", n)
	}
}

// The public URL defaults to the listener's own address, with localhost in
// place of a host that binds every interface, which no browser can dial; it
// follows the host and port the environment set, and an explicit one wins.
func TestNATS_PublicURL(t *testing.T) {
	cases := map[string]struct {
		host, set string
		env       map[string]string
		want      string
	}{
		"default every interface": {want: "ws://localhost:4223"},
		"IPv6 every interface":    {host: "::", want: "ws://localhost:4223"},
		"loopback":                {host: "127.0.0.1", want: "ws://127.0.0.1:4223"},
		"IPv6 loopback":           {host: "::1", want: "ws://[::1]:4223"},
		"env host and port": {
			env:  map[string]string{"EMULATOR_NATS_WEBSOCKET_HOST": "127.0.0.2", "EMULATOR_NATS_WEBSOCKET_PORT": "14223"},
			want: "ws://127.0.0.2:14223",
		},
		"explicit":     {set: "wss://events.example/nats", want: "wss://events.example/nats"},
		"env explicit": {env: map[string]string{"EMULATOR_NATS_WEBSOCKET_PUBLIC_URL": "ws://box:9"}, want: "ws://box:9"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			cfg := withToken()
			cfg.NATS.WebSocket.Host = tc.host
			cfg.NATS.WebSocket.PublicURL = tc.set
			if err := cfg.Finalize("emulator"); err != nil {
				t.Fatalf("Finalize: %v", err)
			}
			if got := cfg.NATS.WebSocket.PublicURL; got != tc.want {
				t.Errorf("NATS.WebSocket.PublicURL = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNATS_PublicURLRejected(t *testing.T) {
	for _, raw := range []string{"http://localhost:4223", "localhost:4223", "ws://", "ws://%zz"} {
		cfg := withToken()
		cfg.NATS.WebSocket.PublicURL = raw
		err := cfg.Finalize("")
		if err == nil || !strings.Contains(err.Error(), "nats: websocket.public_url:") {
			t.Errorf("Finalize with public_url %q = %v, want the nats block's websocket.public_url error", raw, err)
		}
	}
}
