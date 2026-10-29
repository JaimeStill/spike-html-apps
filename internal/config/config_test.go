package config_test

import (
	"strings"
	"testing"
	"time"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-core/logging"
	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// withToken returns an unfinalized Config with the one field Finalize
// requires and has no default for, the nats token, set.
func withToken() *config.Config {
	cfg := &config.Config{}
	cfg.NATS.Token = "test-token"
	return cfg
}

func TestConfig_MergeOverlaysSetFields(t *testing.T) {
	base := &config.Config{ShutdownTimeout: libconfig.Duration(10 * time.Second)}
	base.Log.Level = logging.LevelInfo
	base.Server.Host = "0.0.0.0"

	overlay := &config.Config{}
	overlay.Log.Level = logging.LevelDebug
	overlay.Server.Host = "127.0.0.1"

	base.Merge(overlay)

	if base.Log.Level != logging.LevelDebug {
		t.Errorf("Log.Level = %s, want debug", base.Log.Level)
	}
	if base.Server.Host != "127.0.0.1" {
		t.Errorf("Server.Host = %s, want 127.0.0.1", base.Server.Host)
	}
	// A field the overlay leaves unset keeps the base value.
	if got := base.ShutdownTimeout.Duration(); got != 10*time.Second {
		t.Errorf("ShutdownTimeout = %s, want 10s", got)
	}
}

func TestConfig_FinalizeDefaults(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	// Pins the documented default shutdown timeout.
	if got := cfg.ShutdownTimeout.Duration(); got != 10*time.Second {
		t.Errorf("ShutdownTimeout = %s, want 10s", got)
	}
	if cfg.Log.Level != logging.LevelInfo {
		t.Errorf("Log.Level = %s, want info", cfg.Log.Level)
	}
	if got := cfg.Server.Addr(); got != "0.0.0.0:8080" {
		t.Errorf("Server.Addr() = %s, want 0.0.0.0:8080", got)
	}
}

// Every environment-variable name derives from the prefix Finalize receives —
// in production, the one envPrefix const Load passes, the single place a
// seeded service renames — so a renamed prefix reads its own variables and
// ignores the default namespace.
func TestConfig_FinalizeReadsEnvUnderPrefix(t *testing.T) {
	t.Setenv("SVC_LOG_LEVEL", "debug")
	t.Setenv("SVC_SERVER_PORT", "9090")
	t.Setenv("EMULATOR_LOG_LEVEL", "error")
	t.Setenv("EMULATOR_SERVER_PORT", "7070")

	cfg := withToken()
	if err := cfg.Finalize("svc"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	if cfg.Log.Level != logging.LevelDebug {
		t.Errorf("Log.Level = %s, want debug from SVC_LOG_LEVEL", cfg.Log.Level)
	}
	if cfg.Server.Port == nil || *cfg.Server.Port != 9090 {
		t.Errorf("Server.Port = %v, want 9090 from SVC_SERVER_PORT", cfg.Server.Port)
	}
}

func TestConfig_FinalizeEnvOverrides(t *testing.T) {
	t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", "30s")
	t.Setenv("EMULATOR_LOG_LEVEL", "debug")
	t.Setenv("EMULATOR_SERVER_PORT", "9090")

	cfg := withToken()
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	if got := cfg.ShutdownTimeout.Duration(); got != 30*time.Second {
		t.Errorf("ShutdownTimeout = %s, want 30s", got)
	}
	if cfg.Log.Level != logging.LevelDebug {
		t.Errorf("Log.Level = %s, want debug", cfg.Log.Level)
	}
	if cfg.Server.Port == nil || *cfg.Server.Port != 9090 {
		t.Errorf("Server.Port = %v, want 9090", cfg.Server.Port)
	}
}

func TestConfig_FinalizeRejectsNonPositiveShutdownTimeout(t *testing.T) {
	for _, v := range []string{"-5s", "0s"} {
		t.Run(v, func(t *testing.T) {
			t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", v)

			cfg := withToken()
			err := cfg.Finalize("emulator")
			if err == nil {
				t.Fatalf("Finalize accepted shutdown_timeout %s", v)
			}
			if !strings.Contains(err.Error(), "shutdown_timeout must be positive") {
				t.Errorf("error = %v, want \"shutdown_timeout must be positive\"", err)
			}
		})
	}
}

// A file's non-positive timeout fails the same check as the environment's.
func TestConfig_FinalizeRejectsNonPositiveFileShutdownTimeout(t *testing.T) {
	cfg := &config.Config{ShutdownTimeout: libconfig.Duration(-time.Second)}
	err := cfg.Finalize("")
	if err == nil || !strings.Contains(err.Error(), "shutdown_timeout must be positive") {
		t.Errorf("Finalize = %v, want \"shutdown_timeout must be positive\"", err)
	}
}

func TestConfig_FinalizeRejectsUnparsableShutdownTimeout(t *testing.T) {
	t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", "soon")

	cfg := withToken()
	err := cfg.Finalize("emulator")
	if err == nil {
		t.Fatal("Finalize accepted an unparsable EMULATOR_SHUTDOWN_TIMEOUT")
	}
	if !strings.Contains(err.Error(), "EMULATOR_SHUTDOWN_TIMEOUT") {
		t.Errorf("error = %v, want it to name EMULATOR_SHUTDOWN_TIMEOUT", err)
	}
}

// The empty prefix composes no variable name, so no environment value —
// under the default namespace or none — overrides the timeout.
func TestConfig_FinalizeEmptyPrefixReadsNoShutdownOverride(t *testing.T) {
	t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", "30s")
	t.Setenv("SHUTDOWN_TIMEOUT", "30s")

	cfg := withToken()
	cfg.ShutdownTimeout = libconfig.Duration(3 * time.Second)
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if got := cfg.ShutdownTimeout.Duration(); got != 3*time.Second {
		t.Errorf("ShutdownTimeout = %s, want the configured 3s", got)
	}
}

func TestConfig_MergeOverlayShutdownTimeoutReplacesBase(t *testing.T) {
	base := &config.Config{ShutdownTimeout: libconfig.Duration(10 * time.Second)}
	base.Merge(&config.Config{ShutdownTimeout: libconfig.Duration(3 * time.Second)})

	if got := base.ShutdownTimeout.Duration(); got != 3*time.Second {
		t.Errorf("ShutdownTimeout = %s, want the overlay's 3s", got)
	}
}

func TestConfig_FinalizeWrapsChildErrors(t *testing.T) {
	t.Setenv("EMULATOR_LOG_LEVEL", "verbose")

	cfg := withToken()
	err := cfg.Finalize("emulator")
	if err == nil {
		t.Fatal("Finalize accepted an invalid log level")
	}
	if !strings.Contains(err.Error(), "log:") {
		t.Errorf("error = %v, want the log block wrap", err)
	}
}

func TestReads_FinalizeDefaults(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	// Pins the documented paging defaults.
	if got := cfg.Reads.Limits(); got != (web.Limits{DefaultSize: 20, MaxSize: 100}) {
		t.Errorf("Reads.Limits() = %+v, want {20 100}", got)
	}
	if cfg.Reads.Env != (config.ReadsEnv{}) {
		t.Errorf("Reads.Env = %+v, want empty under the empty prefix", cfg.Reads.Env)
	}
}

func TestReads_MergeOverlaysSetFields(t *testing.T) {
	base := &config.Config{}
	base.Reads.DefaultSize = new(10)
	base.Reads.MaxSize = new(50)

	overlay := &config.Config{}
	overlay.Reads.MaxSize = new(200)

	base.Merge(overlay)

	if got := *base.Reads.MaxSize; got != 200 {
		t.Errorf("Reads.MaxSize = %d, want 200", got)
	}
	// A field the overlay leaves unset keeps the base value.
	if got := *base.Reads.DefaultSize; got != 10 {
		t.Errorf("Reads.DefaultSize = %d, want 10", got)
	}
}

func TestReads_FinalizeEnvOverrides(t *testing.T) {
	t.Setenv("EMULATOR_READS_DEFAULT_SIZE", "25")
	t.Setenv("EMULATOR_READS_MAX_SIZE", "250")

	cfg := withToken()
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	if got := cfg.Reads.Limits(); got != (web.Limits{DefaultSize: 25, MaxSize: 250}) {
		t.Errorf("Reads.Limits() = %+v, want {25 250}", got)
	}
	want := config.ReadsEnv{DefaultSize: "EMULATOR_READS_DEFAULT_SIZE", MaxSize: "EMULATOR_READS_MAX_SIZE"}
	if cfg.Reads.Env != want {
		t.Errorf("Reads.Env = %+v, want %+v", cfg.Reads.Env, want)
	}
}

func TestReads_FinalizeRejectsInvalidPolicy(t *testing.T) {
	cases := map[string]struct {
		defaultSize, maxSize string
		want                 string
	}{
		"default below one":    {"0", "100", "default_size"},
		"max below default":    {"20", "10", "max_size"},
		"default not a number": {"twenty", "100", "EMULATOR_READS_DEFAULT_SIZE"},
		"max not a number":     {"20", "many", "EMULATOR_READS_MAX_SIZE"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("EMULATOR_READS_DEFAULT_SIZE", tc.defaultSize)
			t.Setenv("EMULATOR_READS_MAX_SIZE", tc.maxSize)

			cfg := withToken()
			err := cfg.Finalize("emulator")
			if err == nil {
				t.Fatal("Finalize accepted an invalid reads policy")
			}
			if !strings.Contains(err.Error(), "reads:") || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want the reads block wrap naming %s", err, tc.want)
			}
		})
	}
}
