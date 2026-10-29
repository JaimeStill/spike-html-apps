package configtest

import (
	"testing"

	"github.com/standards-lab/go-core/logging"
	"github.com/standards-lab/go-core/process/processtest"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// Token is the nats block's token in the configuration [Config] returns.
const Token = "configtest-token"

// Config returns a finalized Config whose composition reaches only
// loopback: the server on an ephemeral port, the embedded NATS server's
// client and WebSocket listeners on 127.0.0.1 ports reserved here (the
// block takes no 0, since the broker's URL names the port before the server
// binds it), the token [Token], and debug logging so requests leave
// records. The empty prefix disables environment overrides. The unit tier
// never binds the reserved NATS ports: an app it runs replaces the broker
// with the in-memory one, or ends before startup, so no test here can lose
// a reserved port to another process; internal/natsserver's tests, which
// do bind theirs, start again on fresh ports when they lose one.
func Config(t *testing.T) *config.Config {
	t.Helper()
	cfg := &config.Config{}
	cfg.Server.Host = "127.0.0.1"
	cfg.Server.Port = new(int)
	cfg.Log.Level = logging.LevelDebug
	cfg.NATS.Token = Token
	cfg.NATS.Port = new(processtest.FreePort(t))
	cfg.NATS.WebSocket.Host = "127.0.0.1"
	cfg.NATS.WebSocket.Port = new(processtest.FreePort(t))
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("finalize hermetic config: %v", err)
	}
	return cfg
}
