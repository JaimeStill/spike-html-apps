package config_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

func TestCORS_FinalizeDefaultsToNoOrigins(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if len(cfg.CORS.AllowedOrigins) != 0 {
		t.Errorf("CORS.AllowedOrigins = %q, want none by default", cfg.CORS.AllowedOrigins)
	}
	if cfg.CORS.Env != (config.CORSEnv{}) {
		t.Errorf("CORS.Env = %+v, want empty under the empty prefix", cfg.CORS.Env)
	}
}

// The environment's comma-separated list replaces the configured one,
// entries trimmed and empty entries dropped.
func TestCORS_FinalizeEnvListReplacesConfigured(t *testing.T) {
	t.Setenv("EMULATOR_CORS_ALLOWED_ORIGINS", " http://localhost:5173, ,https://app.example:8443,")

	cfg := withToken()
	cfg.CORS.AllowedOrigins = []string{"https://configured.example"}
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}

	want := []string{"http://localhost:5173", "https://app.example:8443"}
	if !slices.Equal(cfg.CORS.AllowedOrigins, want) {
		t.Errorf("CORS.AllowedOrigins = %q, want %q", cfg.CORS.AllowedOrigins, want)
	}
	if got := cfg.CORS.Env.AllowedOrigins; got != "EMULATOR_CORS_ALLOWED_ORIGINS" {
		t.Errorf("CORS.Env.AllowedOrigins = %q, want EMULATOR_CORS_ALLOWED_ORIGINS", got)
	}
}

// A value of separators alone is set, and clears the configured list.
func TestCORS_FinalizeEnvSeparatorsClearList(t *testing.T) {
	t.Setenv("EMULATOR_CORS_ALLOWED_ORIGINS", " , ")

	cfg := withToken()
	cfg.CORS.AllowedOrigins = []string{"https://configured.example"}
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if len(cfg.CORS.AllowedOrigins) != 0 {
		t.Errorf("CORS.AllowedOrigins = %q, want it cleared", cfg.CORS.AllowedOrigins)
	}
}

func TestCORS_FinalizeRejectsInvalidOrigin(t *testing.T) {
	cases := map[string]struct {
		configured []string
		env        string
		index      string
	}{
		"wildcard in file":       {configured: []string{"http://localhost:5173", "*"}, index: "allowed_origins[1]"},
		"path in file":           {configured: []string{"https://app.example/"}, index: "allowed_origins[0]"},
		"wildcard subdomain env": {env: "https://*.example", index: "allowed_origins[0]"},
		"no scheme in env":       {env: "http://localhost:5173,localhost:8080", index: "allowed_origins[1]"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("EMULATOR_CORS_ALLOWED_ORIGINS", tc.env)

			cfg := withToken()
			cfg.CORS.AllowedOrigins = tc.configured
			err := cfg.Finalize("emulator")
			if err == nil {
				t.Fatal("Finalize accepted an invalid origin")
			}
			if want := "cors: " + tc.index; !strings.Contains(err.Error(), want) {
				t.Errorf("error = %v, want it to name %s", err, want)
			}
		})
	}
}

// An overlay's list replaces the base's, an empty one included; an overlay
// that leaves it unset keeps the base's.
func TestCORS_MergeOverlay(t *testing.T) {
	cases := map[string]struct {
		overlay []string
		want    []string
	}{
		"overlay sets it":    {[]string{"https://b.example"}, []string{"https://b.example"}},
		"overlay empties it": {[]string{}, []string{}},
		"overlay leaves it":  {nil, []string{"https://a.example"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			base := &config.Config{}
			base.CORS.AllowedOrigins = []string{"https://a.example"}
			overlay := &config.Config{}
			overlay.CORS.AllowedOrigins = tc.overlay

			base.Merge(overlay)

			if !slices.Equal(base.CORS.AllowedOrigins, tc.want) {
				t.Errorf("CORS.AllowedOrigins = %q, want %q", base.CORS.AllowedOrigins, tc.want)
			}
		})
	}
}

// cors.allowed_origins is the file key.
func TestLoad_CORSAllowedOriginsKey(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"cors": {"allowed_origins": ["http://localhost:5173"]}}`})
	t.Setenv("EMULATOR_CORS_ALLOWED_ORIGINS", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if want := []string{"http://localhost:5173"}; !slices.Equal(cfg.CORS.AllowedOrigins, want) {
		t.Errorf("CORS.AllowedOrigins = %q, want %q", cfg.CORS.AllowedOrigins, want)
	}
}
