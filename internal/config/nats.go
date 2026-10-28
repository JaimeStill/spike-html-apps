package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-messaging/nats"
)

// The nats block's defaults, applied by Finalize when the configuration
// leaves a field unset. The token has none: it is required.
const (
	defaultNATSPort          = 4222
	defaultNATSWebSocketHost = "0.0.0.0"
	defaultNATSWebSocketPort = 4223
	defaultNATSStream        = "EMULATOR"
	defaultNATSPrefix        = "emulator"
)

// natsLoopback is the host the embedded server's client listener binds and
// the broker connects to: the core protocol never leaves the machine.
const natsLoopback = "127.0.0.1"

// NATSConfig configures the emulator's embedded NATS server and the broker
// that owns its event stream. The server has two listeners: the core client
// listener, on loopback only, which the emulator's own broker connects to,
// and the WebSocket listener browsers reach, on its configured host. Both
// require Token, the one static credential, and the WebSocket listener
// admits an upgrade only from an origin on the cors block's list.
//
// Ports are explicit, never 0: the broker's URL is fixed when the graph is
// built, before the server binds, so a kernel-chosen port could not reach
// it.
type NATSConfig struct {
	// Token is the static credential every connection to either listener
	// presents. Required; the local overlay sets a demo value.
	Token string `json:"token"`
	// Port is the core client listener's port, bound on 127.0.0.1.
	Port *int `json:"port"`
	// WebSocket is the browser-facing listener.
	WebSocket NATSWebSocketConfig `json:"websocket"`
	// Stream is the event stream the broker owns and provisions.
	Stream string `json:"stream"`
	// Prefix is the namespace of the stream's event types: it captures
	// Prefix.>.
	Prefix string `json:"prefix"`
	// Env records the environment-variable names Finalize composed and read.
	Env NATSEnv `json:"-"`
}

// NATSWebSocketConfig is the WebSocket listener's address. It serves
// without TLS: the emulator is a local development and test fixture.
type NATSWebSocketConfig struct {
	Host string `json:"host"`
	Port *int   `json:"port"`
}

// NATSEnv holds the environment-variable names of the nats block.
type NATSEnv struct {
	Token         string
	Port          string
	WebSocketHost string
	WebSocketPort string
	Stream        string
	Prefix        string
}

// Merge overlays src's set fields onto the receiver: a non-empty string and
// a non-nil port.
func (c *NATSConfig) Merge(src *NATSConfig) {
	if src == nil {
		return
	}
	mergeString(&c.Token, src.Token)
	mergeString(&c.WebSocket.Host, src.WebSocket.Host)
	mergeString(&c.Stream, src.Stream)
	mergeString(&c.Prefix, src.Prefix)
	if src.Port != nil {
		c.Port = new(*src.Port)
	}
	if src.WebSocket.Port != nil {
		c.WebSocket.Port = new(*src.WebSocket.Port)
	}
}

// mergeString overlays src onto dst when src is set.
func mergeString(dst *string, src string) {
	if src != "" {
		*dst = src
	}
}

// Finalize applies the defaults, reads the block's environment overrides
// (<PREFIX>_NATS_TOKEN, …_PORT, …_WEBSOCKET_HOST, …_WEBSOCKET_PORT,
// …_STREAM, and …_PREFIX), and validates: the token is set, both ports are
// in 1–65535, the WebSocket host is set, and the stream name and prefix pass
// go-messaging's own checks, the ones its broker applies, so a bad one fails
// here as configuration rather than at Build. An empty prefix composes
// empty names, which disable the overrides.
func (c *NATSConfig) Finalize(envPrefix string) error {
	if c.Port == nil {
		c.Port = new(defaultNATSPort)
	}
	if c.WebSocket.Host == "" {
		c.WebSocket.Host = defaultNATSWebSocketHost
	}
	if c.WebSocket.Port == nil {
		c.WebSocket.Port = new(defaultNATSWebSocketPort)
	}
	if c.Stream == "" {
		c.Stream = defaultNATSStream
	}
	if c.Prefix == "" {
		c.Prefix = defaultNATSPrefix
	}

	c.Env = NATSEnv{
		Token:         libconfig.EnvName(envPrefix, "nats", "token"),
		Port:          libconfig.EnvName(envPrefix, "nats", "port"),
		WebSocketHost: libconfig.EnvName(envPrefix, "nats", "websocket", "host"),
		WebSocketPort: libconfig.EnvName(envPrefix, "nats", "websocket", "port"),
		Stream:        libconfig.EnvName(envPrefix, "nats", "stream"),
		Prefix:        libconfig.EnvName(envPrefix, "nats", "prefix"),
	}
	for dst, name := range map[*string]string{
		&c.Token:          c.Env.Token,
		&c.WebSocket.Host: c.Env.WebSocketHost,
		&c.Stream:         c.Env.Stream,
		&c.Prefix:         c.Env.Prefix,
	} {
		if err := setStringFromEnv(dst, name); err != nil {
			return err
		}
	}
	if err := libconfig.SetFromEnv(&c.Port, c.Env.Port, strconv.Atoi); err != nil {
		return err
	}
	if err := libconfig.SetFromEnv(&c.WebSocket.Port, c.Env.WebSocketPort, strconv.Atoi); err != nil {
		return err
	}
	return c.validate()
}

// setStringFromEnv points dst at the variable name's value when it is set
// and non-empty.
func setStringFromEnv(dst *string, name string) error {
	var v *string
	if err := libconfig.SetFromEnv(&v, name, func(s string) (string, error) { return s, nil }); err != nil {
		return err
	}
	if v != nil {
		*dst = *v
	}
	return nil
}

// validate reports every way the finalized block is unusable.
func (c *NATSConfig) validate() error {
	var errs []error
	if c.Token == "" {
		errs = append(errs, errors.New("token is required"))
	}
	if err := checkPort(*c.Port); err != nil {
		errs = append(errs, fmt.Errorf("port: %w", err))
	}
	if c.WebSocket.Host == "" {
		errs = append(errs, errors.New("websocket.host is required"))
	}
	if err := checkPort(*c.WebSocket.Port); err != nil {
		errs = append(errs, fmt.Errorf("websocket.port: %w", err))
	}
	if err := messaging.CheckName(c.Stream); err != nil {
		errs = append(errs, fmt.Errorf("stream: %w", err))
	}
	if err := messaging.CheckType(c.Prefix); err != nil {
		errs = append(errs, fmt.Errorf("prefix: %w", err))
	}
	return errors.Join(errs...)
}

// checkPort fails on a port outside 1–65535.
func checkPort(p int) error {
	if p < 1 || p > 65535 {
		return fmt.Errorf("must be in 1-65535, got %d", p)
	}
	return nil
}

// Addr is the core client listener's address, on loopback.
func (c NATSConfig) Addr() string {
	return net.JoinHostPort(natsLoopback, strconv.Itoa(*c.Port))
}

// WebSocketAddr is the WebSocket listener's address.
func (c NATSConfig) WebSocketAddr() string {
	return net.JoinHostPort(c.WebSocket.Host, strconv.Itoa(*c.WebSocket.Port))
}

// Broker derives the configuration of the broker that owns the stream: it
// connects to the client listener with the token as the URL's user, which
// nats.go reads as a token (go-messaging's Config carries no credential of
// its own), names its connection "emulator", and owns Stream under Prefix.
func (c NATSConfig) Broker() nats.Config {
	u := url.URL{Scheme: "nats", User: url.User(c.Token), Host: c.Addr()}
	return nats.Config{
		URL:    u.String(),
		Name:   "emulator",
		Stream: c.Stream,
		Prefix: c.Prefix,
		Owner:  new(true),
	}
}
