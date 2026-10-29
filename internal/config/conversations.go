package config

import (
	"fmt"
	"os"
	"time"

	libconfig "github.com/standards-lab/go-core/config"
)

// defaultConversationsDeltaInterval is the pause between a scripted reply's
// text deltas when the configuration leaves it unset.
const defaultConversationsDeltaInterval = 50 * time.Millisecond

// ConversationsConfig configures the scripted replies the conversations and
// the stateless responses route stream: the pace of their text deltas.
type ConversationsConfig struct {
	// DeltaInterval is the pause before each text delta of a scripted reply.
	// Positive.
	DeltaInterval libconfig.Duration `json:"delta_interval"`
	// Env records the environment-variable names Finalize composed and read.
	Env ConversationsEnv `json:"-"`
}

// ConversationsEnv holds the environment-variable names of the
// conversations block.
type ConversationsEnv struct {
	DeltaInterval string
}

// Merge overlays src's set fields onto the receiver: a non-zero interval.
func (c *ConversationsConfig) Merge(src *ConversationsConfig) {
	if src == nil {
		return
	}
	if src.DeltaInterval != 0 {
		c.DeltaInterval = src.DeltaInterval
	}
}

// Finalize applies the default interval, reads
// <PREFIX>_CONVERSATIONS_DELTA_INTERVAL, and validates: the interval is
// positive. An empty prefix composes an empty name, which disables the
// override.
func (c *ConversationsConfig) Finalize(envPrefix string) error {
	c.Env = ConversationsEnv{
		DeltaInterval: libconfig.EnvName(envPrefix, "conversations", "delta_interval"),
	}
	if c.DeltaInterval == 0 {
		c.DeltaInterval = libconfig.Duration(defaultConversationsDeltaInterval)
	}
	if err := c.DeltaInterval.Set(os.Getenv(c.Env.DeltaInterval)); err != nil {
		return fmt.Errorf("%s: %w", c.Env.DeltaInterval, err)
	}
	if c.DeltaInterval <= 0 {
		return fmt.Errorf("delta_interval must be positive, got %s", c.DeltaInterval)
	}
	return nil
}
