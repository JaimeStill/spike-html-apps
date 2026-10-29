package config

import (
	"fmt"
	"path"
	"slices"
	"strings"

	libconfig "github.com/standards-lab/go-core/config"
)

// defaultAppMount is where the pipeline app is served when the
// configuration leaves the mount unset.
const defaultAppMount = "/app"

// reservedMounts are the paths the service serves outside the app: the API
// and admin mounts and the two probes. A mount at one of them would shadow
// it, or, for a module prefix, panic as a second module at the same prefix.
var reservedMounts = []string{"/api", "/admin", "/healthz", "/readyz"}

// AppConfig configures how the service serves the pipeline app, the
// embedded Vite build in apps/pipeline.
type AppConfig struct {
	// Mount is the path the app is served at: "/" for the server's root,
	// where the app answers every path nothing else claims, or a prefix
	// such as "/app", with no trailing slash. The app's shell writes it as
	// its <base href>. Default "/app".
	Mount string `json:"mount"`
	// Env records the environment-variable names Finalize composed and read.
	Env AppEnv `json:"-"`
}

// AppEnv holds the environment-variable names of the app block.
type AppEnv struct {
	Mount string
}

// Merge overlays src's set fields onto the receiver.
func (c *AppConfig) Merge(src *AppConfig) {
	if src == nil {
		return
	}
	mergeString(&c.Mount, src.Mount)
}

// Finalize applies the default, reads <PREFIX>_APP_MOUNT, and validates:
// the mount is "/" or a clean absolute path with no trailing slash, the form
// go-web-sdk's module prefixes take, and is none of the API's, the admin
// mount's, or the probes' paths. An empty prefix composes an empty name,
// which disables the override.
func (c *AppConfig) Finalize(envPrefix string) error {
	if c.Mount == "" {
		c.Mount = defaultAppMount
	}
	c.Env.Mount = libconfig.EnvName(envPrefix, "app", "mount")
	if err := setStringFromEnv(&c.Mount, c.Env.Mount); err != nil {
		return err
	}
	if c.Mount == "/" {
		return nil
	}
	if !strings.HasPrefix(c.Mount, "/") || path.Clean(c.Mount) != c.Mount || strings.ContainsAny(c.Mount, "?#") {
		return fmt.Errorf("mount %q: want \"/\" or a clean absolute path with no trailing slash, such as /app", c.Mount)
	}
	if slices.Contains(reservedMounts, c.Mount) {
		return fmt.Errorf("mount %q: the service serves %v outside the app", c.Mount, reservedMounts)
	}
	return nil
}

// AtRoot reports whether the app is served at the server's root.
func (c AppConfig) AtRoot() bool { return c.Mount == "/" }
