package config_test

import (
	"strings"
	"testing"
	"time"
	"uuid"

	libconfig "github.com/standards-lab/go-core/config"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// Pins the documented defaults: a 750ms stage interval, a 32 MiB upload
// limit, and an instance named by a fresh UUID, distinct for each
// finalized configuration, so two emulators left unnamed source their
// events apart.
func TestRuns_FinalizeDefaults(t *testing.T) {
	a, b := withToken(), withToken()
	for _, cfg := range []*config.Config{a, b} {
		if err := cfg.Finalize(""); err != nil {
			t.Fatalf("Finalize: %v", err)
		}
	}
	if got := a.Runs.StageInterval.Duration(); got != 750*time.Millisecond {
		t.Errorf("Runs.StageInterval = %s, want 750ms", got)
	}
	if got := *a.Documents.MaxSize; got != 32<<20 {
		t.Errorf("Documents.MaxSize = %d, want %d", got, 32<<20)
	}
	if _, err := uuid.Parse(a.Runs.Instance); err != nil {
		t.Errorf("Runs.Instance = %q, want a UUID", a.Runs.Instance)
	}
	if a.Runs.Instance == b.Runs.Instance {
		t.Errorf("two unnamed instances are both %q, want them distinct", a.Runs.Instance)
	}
	if got := a.Runs.Source(); got != "/emulator/"+a.Runs.Instance {
		t.Errorf("Runs.Source() = %q, want /emulator/%s", got, a.Runs.Instance)
	}
	if a.Runs.Env != (config.RunsEnv{}) || a.Documents.Env != (config.DocumentsEnv{}) {
		t.Errorf("Env = %+v, %+v, want empty under the empty prefix", a.Runs.Env, a.Documents.Env)
	}
}

func TestRuns_FinalizeEnvOverrides(t *testing.T) {
	t.Setenv("EMULATOR_RUNS_STAGE_INTERVAL", "25ms")
	t.Setenv("EMULATOR_RUNS_INSTANCE", "lab-a")
	t.Setenv("EMULATOR_DOCUMENTS_MAX_SIZE", "1024")

	cfg := withToken()
	if err := cfg.Finalize("emulator"); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	if got := cfg.Runs.StageInterval.Duration(); got != 25*time.Millisecond {
		t.Errorf("Runs.StageInterval = %s, want 25ms", got)
	}
	if cfg.Runs.Instance != "lab-a" || cfg.Runs.Source() != "/emulator/lab-a" {
		t.Errorf("Runs.Instance, Source() = %q, %q, want lab-a, /emulator/lab-a", cfg.Runs.Instance, cfg.Runs.Source())
	}
	if *cfg.Documents.MaxSize != 1024 {
		t.Errorf("Documents.MaxSize = %d, want 1024", *cfg.Documents.MaxSize)
	}
	wantRuns := config.RunsEnv{StageInterval: "EMULATOR_RUNS_STAGE_INTERVAL", Instance: "EMULATOR_RUNS_INSTANCE"}
	if cfg.Runs.Env != wantRuns {
		t.Errorf("Runs.Env = %+v, want %+v", cfg.Runs.Env, wantRuns)
	}
	if cfg.Documents.Env.MaxSize != "EMULATOR_DOCUMENTS_MAX_SIZE" {
		t.Errorf("Documents.Env = %+v, want EMULATOR_DOCUMENTS_MAX_SIZE", cfg.Documents.Env)
	}
}

func TestRuns_FinalizeRejectsInvalidBlocks(t *testing.T) {
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"zero interval":       {map[string]string{"EMULATOR_RUNS_STAGE_INTERVAL": "0s"}, "runs: stage_interval must be positive"},
		"negative interval":   {map[string]string{"EMULATOR_RUNS_STAGE_INTERVAL": "-1s"}, "runs: stage_interval must be positive"},
		"unparsable interval": {map[string]string{"EMULATOR_RUNS_STAGE_INTERVAL": "soon"}, "EMULATOR_RUNS_STAGE_INTERVAL"},
		"slashed instance":    {map[string]string{"EMULATOR_RUNS_INSTANCE": "a/b"}, "runs: instance"},
		"spaced instance":     {map[string]string{"EMULATOR_RUNS_INSTANCE": "a b"}, "runs: instance"},
		"zero max size":       {map[string]string{"EMULATOR_DOCUMENTS_MAX_SIZE": "0"}, "documents: max_size must be at least 1"},
		"max size not number": {map[string]string{"EMULATOR_DOCUMENTS_MAX_SIZE": "lots"}, "EMULATOR_DOCUMENTS_MAX_SIZE"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			err := withToken().Finalize("emulator")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Finalize = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func TestRuns_MergeOverlaysSetFields(t *testing.T) {
	base := withToken()
	base.Runs.StageInterval = libconfig.Duration(time.Second)
	base.Runs.Instance = "base"
	base.Documents.MaxSize = new(int64(10))

	overlay := &config.Config{}
	overlay.Runs.Instance = "overlay"
	base.Merge(overlay)
	if base.Runs.Instance != "overlay" || base.Runs.StageInterval.Duration() != time.Second || *base.Documents.MaxSize != 10 {
		t.Errorf("merged = %+v, %+v; want the overlay's instance over the base's interval and limit", base.Runs, base.Documents)
	}

	overlay = &config.Config{}
	overlay.Runs.StageInterval = libconfig.Duration(time.Minute)
	overlay.Documents.MaxSize = new(int64(20))
	base.Merge(overlay)
	if base.Runs.Instance != "overlay" || base.Runs.StageInterval.Duration() != time.Minute || *base.Documents.MaxSize != 20 {
		t.Errorf("merged = %+v, %+v; want the overlay's interval and limit", base.Runs, base.Documents)
	}
}

// runs and documents are file keys, with stage_interval and instance, and
// max_size, beneath them.
func TestLoad_RunsAndDocumentsKeys(t *testing.T) {
	inDir(t, map[string]string{"config.json": `{"runs": {"stage_interval": "2s", "instance": "from-file"},
		"documents": {"max_size": 4096}}`})
	t.Setenv("EMULATOR_RUNS_STAGE_INTERVAL", "")
	t.Setenv("EMULATOR_RUNS_INSTANCE", "")
	t.Setenv("EMULATOR_DOCUMENTS_MAX_SIZE", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Runs.StageInterval.Duration() != 2*time.Second || cfg.Runs.Instance != "from-file" || *cfg.Documents.MaxSize != 4096 {
		t.Errorf("Runs, Documents = %+v, %+v, want the file's blocks", cfg.Runs, cfg.Documents)
	}
}
