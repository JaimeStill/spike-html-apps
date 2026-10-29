//go:build integration

package integration_test

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/standards-lab/go-core/process/processtest"
	"github.com/standards-lab/go-web-sdk"
	"github.com/standards-lab/go-web-sdk/webtest"

	"github.com/JaimeStill/spike-html-apps/integration"
)

// reserving returns a Reserve that hands out held as its first address and
// a freshly reserved loopback address after, and counts its calls.
func reserving(held string, calls *int) func(testing.TB) string {
	return func(t testing.TB) string {
		*calls++
		if *calls == 1 {
			return held
		}
		return net.JoinHostPort("127.0.0.1", strconv.Itoa(processtest.FreePort(t)))
	}
}

// A boot whose first reserved port another socket took, as a concurrent
// tier's process can between the reservation and the bind, relaunches on
// fresh ports and reaches live there.
func TestHarness_BootRetriesTakenPort(t *testing.T) {
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("hold a port: %v", err)
	}
	defer func() { _ = held.Close() }()

	var calls int
	s := integration.Start(t, integration.Options{Reserve: reserving(held.Addr().String(), &calls)})
	if got := s.Launches(); got != 2 {
		t.Errorf("launches = %d, want 2: the held port, then fresh ones", got)
	}
	if calls != 6 {
		t.Errorf("reserved %d addresses, want 6: three per launch", calls)
	}
	if s.Addr() == held.Addr().String() {
		t.Errorf("service at %s, the held address", s.Addr())
	}
	webtest.Decode[map[string]string](t, s.Client().Get(t, web.HealthPath), http.StatusOK)
	if code := s.Stop(t); code != 0 {
		t.Errorf("exit = %d:\n%s", code, s.Output())
	}
}

// A boot that fails for any reason but a taken port is not relaunched: a
// configuration with no nats token fails the load, and Boot reports that
// exit from the first launch.
func TestHarness_BootDoesNotRetryOtherFailure(t *testing.T) {
	var calls int
	reserve := func(t testing.TB) string {
		calls++
		return net.JoinHostPort("127.0.0.1", strconv.Itoa(processtest.FreePort(t)))
	}
	s := integration.Launch(t, integration.Options{Env: []string{"EMULATOR_NATS_TOKEN="}, Reserve: reserve})
	err := s.Boot(t)
	if err == nil {
		t.Fatal("Boot succeeded with no nats token")
	}
	if got := s.Launches(); got != 1 {
		t.Errorf("launches = %d, want 1:\n%v", got, err)
	}
	if calls != 3 {
		t.Errorf("reserved %d addresses, want 3: one launch's", calls)
	}
	if !strings.Contains(err.Error(), "token") {
		t.Errorf("Boot = %v, want the load's failure naming the token", err)
	}
}
