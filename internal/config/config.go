package config

import (
	"fmt"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-core/lifecycle"
	"github.com/standards-lab/go-core/logging"
	"github.com/standards-lab/go-web-sdk"
)

// envPrefix namespaces the emulator's environment variables ("emulator" →
// EMULATOR_LOG_LEVEL), renamed from the template's "app"; it is the single
// place the namespace is named.
const envPrefix = "emulator"

// Config is the service's root configuration: the library capability blocks
// plus the service-owned read and cross-origin policies, the embedded NATS
// server's block, the emulated pipeline's documents and runs blocks, the
// scripted replies' conversations block, and the pipeline app's app block.
// It embeds the lifecycle Coordinator's configuration by value and untagged, so its
// shutdown_timeout is a top-level key and ShutdownTimeout a promoted field;
// Config.Config is that lifecycle block, the one the composition root hands
// the Coordinator.
type Config struct {
	lifecycle.Config

	Log       logging.Config  `json:"log"`
	Server    web.Config      `json:"server"`
	Reads     ReadsConfig     `json:"reads"`
	CORS      CORSConfig      `json:"cors"`
	NATS      NATSConfig      `json:"nats"`
	Documents DocumentsConfig `json:"documents"`
	Runs      RunsConfig      `json:"runs"`
	App       AppConfig       `json:"app"`

	Conversations ConversationsConfig `json:"conversations"`
}

// Merge overlays src's set fields onto the receiver, delegating each block
// to its own Merge.
func (c *Config) Merge(src *Config) {
	if src == nil {
		return
	}
	c.Config.Merge(&src.Config)
	c.Log.Merge(&src.Log)
	c.Server.Merge(&src.Server)
	c.Reads.Merge(&src.Reads)
	c.CORS.Merge(&src.CORS)
	c.NATS.Merge(&src.NATS)
	c.Documents.Merge(&src.Documents)
	c.Runs.Merge(&src.Runs)
	c.App.Merge(&src.App)
	c.Conversations.Merge(&src.Conversations)
}

// Finalize finalizes each block under the same prefix, the lifecycle block
// first, and validates. It satisfies the config package's Load contract.
// The lifecycle block's error returns as it is, unlabelled, since it names
// its own key or variable: it applies the 10s default shutdown timeout,
// reads <PREFIX>_SHUTDOWN_TIMEOUT, and rejects a non-positive timeout, on
// which the lifecycle coordinator panics. An empty prefix composes empty
// variable names, which read as no override, so it disables every
// environment override; tests use this hermetic form.
func (c *Config) Finalize(envPrefix string) error {
	if err := c.Config.Finalize(envPrefix); err != nil {
		return err
	}
	if err := c.Log.Finalize(envPrefix); err != nil {
		return fmt.Errorf("log: %w", err)
	}
	if err := c.Server.Finalize(envPrefix); err != nil {
		return fmt.Errorf("server: %w", err)
	}
	if err := c.Reads.Finalize(envPrefix); err != nil {
		return fmt.Errorf("reads: %w", err)
	}
	if err := c.CORS.Finalize(envPrefix); err != nil {
		return fmt.Errorf("cors: %w", err)
	}
	if err := c.NATS.Finalize(envPrefix); err != nil {
		return fmt.Errorf("nats: %w", err)
	}
	if err := c.Documents.Finalize(envPrefix); err != nil {
		return fmt.Errorf("documents: %w", err)
	}
	if err := c.Runs.Finalize(envPrefix); err != nil {
		return fmt.Errorf("runs: %w", err)
	}
	if err := c.Conversations.Finalize(envPrefix); err != nil {
		return fmt.Errorf("conversations: %w", err)
	}
	if err := c.App.Finalize(envPrefix); err != nil {
		return fmt.Errorf("app: %w", err)
	}
	return nil
}

// Load reads the layered configuration files and finalizes the result under
// the service's env prefix.
func Load() (*Config, error) {
	return libconfig.Load[Config](libconfig.Options{
		EnvPrefix: envPrefix,
	})
}
