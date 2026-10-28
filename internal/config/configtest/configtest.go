package configtest

import (
	"testing"

	"github.com/standards-lab/go-core/logging"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// Config returns a finalized Config whose composition performs no I/O: the
// server on a loopback ephemeral port, and debug logging so requests leave
// records. The empty prefix disables environment overrides.
func Config(t *testing.T) *config.Config {
	t.Helper()
	cfg := &config.Config{}
	cfg.Server.Host = "127.0.0.1"
	cfg.Server.Port = new(int)
	cfg.Log.Level = logging.LevelDebug
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("finalize hermetic config: %v", err)
	}
	return cfg
}
