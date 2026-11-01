package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode"
	"uuid"

	libconfig "github.com/standards-lab/go-core/config"
)

// defaultRunsStageInterval is how long each stage of a run takes when the
// configuration leaves it unset.
const defaultRunsStageInterval = 750 * time.Millisecond

// RunsConfig configures the emulated pipeline runs: how long each stage
// takes, the instance name that sources their stage events, and the rules
// that fail a run.
type RunsConfig struct {
	// StageInterval is how long a run waits after one stage completes before
	// it completes the next. Positive.
	StageInterval libconfig.Duration `json:"stage_interval"`
	// Instance names this emulator process in the source of every stage
	// event it publishes, /emulator/<instance>, so the events of two
	// emulators on one stream are told apart. Unset, Finalize names the
	// process with a fresh UUID, distinct for every process; a deployment
	// that needs a stable source sets it.
	Instance string `json:"instance"`
	// Fail lists the fail rules, the emulator's test seam for a failed
	// run: each <pattern>:<stage>, a path.Match pattern over an uploaded
	// document's name and the stage its run fails at, so under
	// fail-at-*:extraction an upload named fail-at-extraction.txt starts a
	// run that fails at extraction. The run layer parses and validates
	// them. It is configuration, never anything a client sends, and empty,
	// the default, no run fails. A nil slice is unset, so an overlay's
	// empty list replaces the base's.
	Fail []string `json:"fail"`
	// Env records the environment-variable names Finalize composed and read.
	Env RunsEnv `json:"-"`
}

// RunsEnv holds the environment-variable names of the runs block.
type RunsEnv struct {
	StageInterval string
	Instance      string
	Fail          string
}

// Merge overlays src's set fields onto the receiver: a non-zero interval,
// a non-empty instance, and a non-nil fail list.
func (c *RunsConfig) Merge(src *RunsConfig) {
	if src == nil {
		return
	}
	if src.StageInterval != 0 {
		c.StageInterval = src.StageInterval
	}
	mergeString(&c.Instance, src.Instance)
	if src.Fail != nil {
		c.Fail = append([]string{}, src.Fail...)
	}
}

// Finalize applies the default interval, reads <PREFIX>_RUNS_STAGE_INTERVAL,
// <PREFIX>_RUNS_INSTANCE, and <PREFIX>_RUNS_FAIL, a comma-separated list
// that replaces the configured rules (spaces around a rule and empty rules
// are dropped), names an unset instance, and validates: the
// interval is positive, and the instance is a single URI path segment, with
// no '/', whitespace, or control character. An empty prefix composes empty names, which disable
// the overrides.
func (c *RunsConfig) Finalize(envPrefix string) error {
	c.Env = RunsEnv{
		StageInterval: libconfig.EnvName(envPrefix, "runs", "stage_interval"),
		Instance:      libconfig.EnvName(envPrefix, "runs", "instance"),
		Fail:          libconfig.EnvName(envPrefix, "runs", "fail"),
	}
	if c.StageInterval == 0 {
		c.StageInterval = libconfig.Duration(defaultRunsStageInterval)
	}
	if err := c.StageInterval.Set(os.Getenv(c.Env.StageInterval)); err != nil {
		return fmt.Errorf("%s: %w", c.Env.StageInterval, err)
	}
	if err := setStringFromEnv(&c.Instance, c.Env.Instance); err != nil {
		return err
	}
	var fail *[]string
	if err := libconfig.SetFromEnv(&fail, c.Env.Fail, parseList); err != nil {
		return err
	}
	if fail != nil {
		c.Fail = *fail
	}
	if c.Instance == "" {
		c.Instance = uuid.NewV7().String()
	}

	var errs []error
	if c.StageInterval <= 0 {
		errs = append(errs, fmt.Errorf("stage_interval must be positive, got %s", c.StageInterval))
	}
	if strings.ContainsFunc(c.Instance, func(r rune) bool {
		return r == '/' || unicode.IsSpace(r) || unicode.IsControl(r)
	}) {
		errs = append(errs, fmt.Errorf("instance %q must not contain '/', whitespace, or a control character", c.Instance))
	}
	return errors.Join(errs...)
}

// Source is the CloudEvents source of the stage events this instance
// publishes.
func (c RunsConfig) Source() string {
	return "/emulator/" + c.Instance
}
