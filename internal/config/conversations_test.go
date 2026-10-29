package config_test

import (
	"strings"
	"testing"
	"time"

	libconfig "github.com/standards-lab/go-core/config"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// Pins the documented default: a 50ms delta interval, with no variable
// names under the empty prefix.
func TestConversations_FinalizeDefaults(t *testing.T) {
	cfg := withToken()
	if err := cfg.Finalize(""); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if got := cfg.Conversations.DeltaInterval.Duration(); got != 50*time.Millisecond {
		t.Errorf("Conversations.DeltaInterval = %s, want 50ms", got)
	}
	if cfg.Conversations.Env != (config.ConversationsEnv{}) {
		t.Errorf("Conversations.Env = %+v, want empty under the empty prefix", cfg.Conversations.Env)
	}
}

func TestConversations_FinalizeEnvOverride(t *testing.T) {
	t.Setenv("EMULATOR_CONVERSATIONS_DELTA_INTERVAL", "5ms")

	cfg := withToken()
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if got := cfg.Conversations.DeltaInterval.Duration(); got != 5*time.Millisecond {
		t.Errorf("Conversations.DeltaInterval = %s, want 5ms", got)
	}
	want := config.ConversationsEnv{DeltaInterval: "EMULATOR_CONVERSATIONS_DELTA_INTERVAL"}
	if cfg.Conversations.Env != want {
		t.Errorf("Conversations.Env = %+v, want %+v", cfg.Conversations.Env, want)
	}
}

func TestConversations_FinalizeRejectsInvalidInterval(t *testing.T) {
	cases := map[string]struct{ value, want string }{
		"zero":       {"0s", "conversations: delta_interval must be positive"},
		"negative":   {"-1ms", "conversations: delta_interval must be positive"},
		"unparsable": {"briskly", "EMULATOR_CONVERSATIONS_DELTA_INTERVAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("EMULATOR_CONVERSATIONS_DELTA_INTERVAL", tc.value)
			err := withToken().Finalize("emulator")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Finalize = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func TestConversations_MergeOverlaysSetInterval(t *testing.T) {
	base := withToken()
	base.Conversations.DeltaInterval = libconfig.Duration(time.Second)

	base.Merge(&config.Config{})
	if got := base.Conversations.DeltaInterval.Duration(); got != time.Second {
		t.Errorf("merged an empty overlay: DeltaInterval = %s, want the base's 1s", got)
	}

	overlay := &config.Config{}
	overlay.Conversations.DeltaInterval = libconfig.Duration(time.Millisecond)
	base.Merge(overlay)
	if got := base.Conversations.DeltaInterval.Duration(); got != time.Millisecond {
		t.Errorf("merged = %s, want the overlay's 1ms", got)
	}
}

// conversations is a file key, with delta_interval beneath it.
func TestLoad_ConversationsKey(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"conversations": {"delta_interval": "20ms"}}`})
	t.Setenv("EMULATOR_CONVERSATIONS_DELTA_INTERVAL", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.Conversations.DeltaInterval.Duration(); got != 20*time.Millisecond {
		t.Errorf("Conversations.DeltaInterval = %s, want the file's 20ms", got)
	}
}
