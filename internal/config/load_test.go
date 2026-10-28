package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// These tests drive Load over real files in a scratch working directory,
// pinning the file contract — the keys config.json accepts and how an
// overlay layers on it — independent of how Config is declared.

// inDir writes files into a fresh working directory, enters it, and clears
// the variables that would select an overlay or override the timeout, so
// the files alone configure the load.
func inDir(t *testing.T, files map[string]string) {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	t.Chdir(dir)
	t.Setenv("EMULATOR_ENV", "")
	t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", "")
}

// shutdown_timeout is a top-level key of config.json.
func TestLoad_ShutdownTimeoutIsTopLevelKey(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"shutdown_timeout": "3s"}`})

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.ShutdownTimeout.Duration(); got != 3*time.Second {
		t.Errorf("ShutdownTimeout = %s, want 3s from the file", got)
	}
}

func TestLoad_ShutdownTimeoutDefaultsTo10s(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{}`})

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.ShutdownTimeout.Duration(); got != 10*time.Second {
		t.Errorf("ShutdownTimeout = %s, want the 10s default", got)
	}
}

func TestLoad_EnvOverridesFileShutdownTimeout(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"shutdown_timeout": "3s"}`})
	t.Setenv("EMULATOR_SHUTDOWN_TIMEOUT", "4s")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.ShutdownTimeout.Duration(); got != 4*time.Second {
		t.Errorf("ShutdownTimeout = %s, want 4s from EMULATOR_SHUTDOWN_TIMEOUT", got)
	}
}

// An overlay's shutdown_timeout replaces the base file's; an overlay that
// leaves it unset keeps the base's.
func TestLoad_OverlayShutdownTimeout(t *testing.T) {
	cases := map[string]struct {
		overlay string
		want    time.Duration
	}{
		"overlay sets it":   {`{"shutdown_timeout": "7s"}`, 7 * time.Second},
		"overlay leaves it": {`{"log": {"level": "debug"}}`, 3 * time.Second},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			inDir(t, map[string]string{
				"config.json":      `{"shutdown_timeout": "3s"}`,
				"config.test.json": tc.overlay,
			})
			t.Setenv("EMULATOR_ENV", "test")

			cfg, err := config.Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := cfg.ShutdownTimeout.Duration(); got != tc.want {
				t.Errorf("ShutdownTimeout = %s, want %s", got, tc.want)
			}
		})
	}
}

// The file decodes strictly: a key naming a Go identifier rather than a
// declared JSON key is an unknown field, not a way into the struct.
func TestLoad_RejectsUnknownTopLevelKeys(t *testing.T) {
	for _, key := range []string{"Config", "Env"} {
		t.Run(key, func(t *testing.T) {
			inDir(t, map[string]string{"config.json": `{"` + key + `": {}}`})

			_, err := config.Load()
			if err == nil {
				t.Fatalf("Load accepted a %q key", key)
			}
			if want := `unknown field "` + key + `"`; !strings.Contains(err.Error(), want) {
				t.Errorf("error = %v, want %s", err, want)
			}
		})
	}
}
