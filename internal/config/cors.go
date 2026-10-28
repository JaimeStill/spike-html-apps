package config

import (
	"fmt"
	"strings"

	libconfig "github.com/standards-lab/go-core/config"

	"github.com/JaimeStill/spike-html-apps/sdk"
)

// CORSConfig is the service's cross-origin policy: the browser origins,
// other than the service's own, allowed to call it. It is one setting for
// every surface a browser reaches the service through, the HTTP router's
// CORS middleware and, as the pipeline grows, the NATS WebSocket listener's
// allowed origins, so one list admits a client everywhere. An empty list,
// the default, admits no cross-origin client.
type CORSConfig struct {
	// AllowedOrigins lists each origin exactly, as scheme://host[:port]. A
	// nil slice is unset, so an overlay's empty list replaces the base's and
	// admits nothing.
	AllowedOrigins []string `json:"allowed_origins"`
	// Env records the environment-variable names Finalize composed and read.
	Env CORSEnv `json:"-"`
}

// CORSEnv holds the environment-variable names of the cors block.
type CORSEnv struct {
	AllowedOrigins string
}

// Merge overlays src's set fields onto the receiver.
func (c *CORSConfig) Merge(src *CORSConfig) {
	if src == nil {
		return
	}
	if src.AllowedOrigins != nil {
		c.AllowedOrigins = append([]string{}, src.AllowedOrigins...)
	}
}

// Finalize reads the block's environment override, a comma-separated list
// that replaces the configured one (spaces around an entry and empty entries
// are dropped), and validates each origin with sdk.ValidateOrigin, so an
// origin the middleware cannot match exactly fails here as configuration
// rather than as a panic at composition. An empty prefix composes an empty
// name, which disables the override.
func (c *CORSConfig) Finalize(envPrefix string) error {
	c.Env.AllowedOrigins = libconfig.EnvName(envPrefix, "cors_allowed_origins")
	var fromEnv *[]string
	if err := libconfig.SetFromEnv(&fromEnv, c.Env.AllowedOrigins, parseList); err != nil {
		return err
	}
	if fromEnv != nil {
		c.AllowedOrigins = *fromEnv
	}
	for i, origin := range c.AllowedOrigins {
		if err := sdk.ValidateOrigin(origin); err != nil {
			return fmt.Errorf("allowed_origins[%d]: %w", i, err)
		}
	}
	return nil
}

// parseList splits a comma-separated environment value into its trimmed,
// non-empty entries. It never fails; a value of separators alone parses to
// an empty list, which clears the configured one.
func parseList(v string) ([]string, error) {
	list := []string{}
	for entry := range strings.SplitSeq(v, ",") {
		if entry = strings.TrimSpace(entry); entry != "" {
			list = append(list, entry)
		}
	}
	return list, nil
}
