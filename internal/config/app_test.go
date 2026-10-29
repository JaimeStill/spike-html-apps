package config_test

import (
	"strings"
	"testing"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

func TestApp_FinalizeDefaults(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if cfg.App.Mount != "/app" || cfg.App.AtRoot() {
		t.Errorf("App.Mount = %q, AtRoot %t; want /app, false", cfg.App.Mount, cfg.App.AtRoot())
	}
	if cfg.App.Env != (config.AppEnv{}) {
		t.Errorf("App.Env = %+v, want empty under the empty prefix", cfg.App.Env)
	}
}

func TestApp_FinalizeEnvOverride(t *testing.T) {
	t.Setenv("EMULATOR_APP_MOUNT", "/")
	cfg := withToken()
	cfg.App.Mount = "/console"
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if cfg.App.Mount != "/" || !cfg.App.AtRoot() {
		t.Errorf("App.Mount = %q, AtRoot %t; want /, true", cfg.App.Mount, cfg.App.AtRoot())
	}
	if cfg.App.Env.Mount != "EMULATOR_APP_MOUNT" {
		t.Errorf("App.Env.Mount = %q, want EMULATOR_APP_MOUNT", cfg.App.Env.Mount)
	}
}

func TestApp_MergeOverlaysSetMount(t *testing.T) {
	base, overlay := &config.Config{}, &config.Config{}
	base.App.Mount = "/app"
	base.Merge(overlay)
	if base.App.Mount != "/app" {
		t.Errorf("App.Mount = %q after an unset overlay, want the base's /app", base.App.Mount)
	}
	overlay.App.Mount = "/"
	base.Merge(overlay)
	if base.App.Mount != "/" {
		t.Errorf("App.Mount = %q, want the overlay's /", base.App.Mount)
	}
}

func TestApp_FinalizeRejectsMount(t *testing.T) {
	for _, mount := range []string{"app", "/app/", "/a/../app", "/app?x", "/api", "/admin", "/healthz", "/readyz"} {
		cfg := withToken()
		cfg.App.Mount = mount
		err := cfg.Finalize("")
		if err == nil || !strings.Contains(err.Error(), "app: mount") {
			t.Errorf("Finalize with mount %q = %v, want the app block's mount error", mount, err)
		}
	}
}
