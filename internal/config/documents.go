package config

import (
	"fmt"
	"strconv"

	libconfig "github.com/standards-lab/go-core/config"
)

// defaultDocumentsMaxSize is the largest upload the documents block accepts
// when the configuration leaves it unset: 32 MiB.
const defaultDocumentsMaxSize int64 = 32 << 20

// DocumentsConfig is the document store's policy: the largest upload, in
// bytes, the upload route accepts. The route checks it against the declared
// Content-Length before it reads a byte, and sizes the upload's connection
// deadlines from it. A pointer field distinguishes unset from zero.
type DocumentsConfig struct {
	MaxSize *int64 `json:"max_size"`
	// Env records the environment-variable names Finalize composed and read.
	Env DocumentsEnv `json:"-"`
}

// DocumentsEnv holds the environment-variable names of the documents block.
type DocumentsEnv struct {
	MaxSize string
}

// Merge overlays src's set fields onto the receiver.
func (c *DocumentsConfig) Merge(src *DocumentsConfig) {
	if src == nil {
		return
	}
	if src.MaxSize != nil {
		c.MaxSize = new(*src.MaxSize)
	}
}

// Finalize applies the default, reads <PREFIX>_DOCUMENTS_MAX_SIZE, and
// validates: the limit is at least 1 byte. An empty prefix composes an
// empty name, which disables the override.
func (c *DocumentsConfig) Finalize(envPrefix string) error {
	if c.MaxSize == nil {
		c.MaxSize = new(defaultDocumentsMaxSize)
	}
	c.Env.MaxSize = libconfig.EnvName(envPrefix, "documents", "max_size")
	parse := func(s string) (int64, error) { return strconv.ParseInt(s, 10, 64) }
	if err := libconfig.SetFromEnv(&c.MaxSize, c.Env.MaxSize, parse); err != nil {
		return err
	}
	if *c.MaxSize < 1 {
		return fmt.Errorf("max_size must be at least 1, got %d", *c.MaxSize)
	}
	return nil
}
