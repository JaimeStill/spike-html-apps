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
// that fail a run or hold it.
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
	// Hold lists the hold rules, the emulator's test seam for a run under
	// way: each <pattern>:<stage>, as a fail rule is, the stage its run
	// holds at, so under held-*:extraction an upload named held-brief.txt
	// starts a run that completes upload and metadata, then stays running
	// with extraction pending, the stage under way, for as long as the
	// emulator runs. The run layer parses and validates them, and settles
	// a name both kinds of rule match. It is configuration, never anything
	// a client sends, and nothing releases a hold; empty, the default, no
	// run holds. A nil slice is unset, so an overlay's empty list replaces
	// the base's.
	Hold []string `json:"hold"`
	// Env records the environment-variable names Finalize composed and read.
	Env RunsEnv `json:"-"`
}

// RunsEnv holds the environment-variable names of the runs block.
type RunsEnv struct {
	StageInterval string
	Instance      string
	Fail          string
	Hold          string
}

// Merge overlays src's set fields onto the receiver: a non-zero interval,
// a non-empty instance, and a non-nil fail or hold list.
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
	if src.Hold != nil {
		c.Hold = append([]string{}, src.Hold...)
	}
}

// Finalize applies the default interval, reads <PREFIX>_RUNS_STAGE_INTERVAL,
// <PREFIX>_RUNS_INSTANCE, and <PREFIX>_RUNS_FAIL and <PREFIX>_RUNS_HOLD,
// each a comma-separated list that replaces the configured rules of its
// kind (spaces around a rule and empty rules are dropped), names an unset instance, and validates: the
// interval is positive, and the instance is a single URI path segment, with
// no '/', whitespace, or control character. An empty prefix composes empty names, which disable
// the overrides.
func (c *RunsConfig) Finalize(envPrefix string) error {
	c.Env = RunsEnv{
		StageInterval: libconfig.EnvName(envPrefix, "runs", "stage_interval"),
		Instance:      libconfig.EnvName(envPrefix, "runs", "instance"),
		Fail:          libconfig.EnvName(envPrefix, "runs", "fail"),
		Hold:          libconfig.EnvName(envPrefix, "runs", "hold"),
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
	var fail, hold *[]string
	if err := libconfig.SetFromEnv(&fail, c.Env.Fail, parseList); err != nil {
		return err
	}
	if fail != nil {
		c.Fail = *fail
	}
	if err := libconfig.SetFromEnv(&hold, c.Env.Hold, parseList); err != nil {
		return err
	}
	if hold != nil {
		c.Hold = *hold
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
