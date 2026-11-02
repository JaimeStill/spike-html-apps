#!/usr/bin/env bash
# mise run demo, after build:app and build:external: the external client hosted apart, by Vite's
# preview of its build on http://127.0.0.1:4180, beside two emulators, each on ports of its own,
# its own NATS token, and its own JetStream store, and each admitting the client's origin in its
# CORS and its NATS WebSocket listener (cors.allowed_origins, one list for both). The emulators run
# under the local overlay, with the EMULATOR_ variables over it.
#
#   Service A: API http://127.0.0.1:8181/api, NATS 4281, WebSocket ws://127.0.0.1:4282
#   Service B: API http://127.0.0.1:8182/api, NATS 4291, WebSocket ws://127.0.0.1:4292
#
# apps/external/demo/services.json, committed, describes that layout; the script copies it beside
# the build, into apps/external/dist/ (gitignored), where the client fetches it relative to its
# page. Ctrl-C, or any of the three exiting, drains the emulators and ends the preview; the
# script removes the binary and the stores' directories and leaves no process behind.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

origin="http://127.0.0.1:4180"
temp=$(mktemp -d)
pids=()

stop() {
  trap - EXIT INT TERM
  if [ "${#pids[@]}" -gt 0 ]; then
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  rm -rf "$temp"
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

go build -o "$temp/server" ./cmd/server
cp apps/external/demo/services.json apps/external/dist/services.json

# emulator <instance> <port> <nats port> <websocket port> <token>
emulator() {
  mkdir -p "$temp/$1"
  TMPDIR="$temp/$1" \
    EMULATOR_SERVER_PORT="$2" \
    EMULATOR_NATS_PORT="$3" \
    EMULATOR_NATS_WEBSOCKET_PORT="$4" \
    EMULATOR_NATS_TOKEN="$5" \
    EMULATOR_RUNS_INSTANCE="$1" \
    EMULATOR_CORS_ALLOWED_ORIGINS="$origin" \
    "$temp/server" &
  pids+=("$!")
}

emulator a 8181 4281 4282 demo-token-a
emulator b 8182 4291 4292 demo-token-b
node_modules/.bin/vite preview -c vite.external.config.ts --port 4180 &
pids+=("$!")

echo "demo: the external client at $origin/, over Service A (:8181) and Service B (:8182)"
# Until any of the three exits, or a signal ends the script.
wait -n "${pids[@]}"
