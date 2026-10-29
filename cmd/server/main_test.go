package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A configuration the loader rejects stops the process at the entrypoint:
// run exits nonzero and reports the failure on stderr, before any app is
// built.
func TestRun_ConfigLoadFailureExitsNonzero(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{"Config": {}}`), 0o600); err != nil {
		t.Fatalf("write config.json: %v", err)
	}
	t.Chdir(dir)
	t.Setenv("EMULATOR_ENV", "")

	var stdout, stderr strings.Builder
	if code := run(&stdout, &stderr); code == 0 {
		t.Errorf("run = 0, want nonzero")
	}
	if got := stderr.String(); !strings.HasPrefix(got, "config load failed: ") {
		t.Errorf("stderr = %q, want a \"config load failed\" report", got)
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout = %q, want nothing: no app was built", stdout.String())
	}
}
