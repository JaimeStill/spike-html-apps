#!/usr/bin/env bash
# Fails naming mise run install when a tool a task needs is missing: the node_modules tooling, and
# with `browser`, the pinned chrome-headless-shell.
# Adapted from spike-html-apps-foundation (12f4d53): scripts/preflight.sh; and from
# spike-html-apps-sdk (be6341d): scripts/preflight.sh, its browser check.
set -euo pipefail

fail() {
  echo "preflight: $1 isn't installed; run mise run install" >&2
  exit 1
}

for bin in eslint prettier vite; do
  [[ -x node_modules/.bin/$bin ]] || fail "$bin (devDependencies)"
done

[[ "${1:-}" == browser ]] || exit 0
shell=$(mise which chrome-headless-shell 2>/dev/null) || fail "chrome-headless-shell"
# mise caches downloads by checksum: a version bumped without its sha256 installs the old build.
pin=$(mise current http:chrome-headless-shell)
if [[ "$("$shell" --version)" != *" $pin" ]]; then
  echo "preflight: $shell isn't chrome-headless-shell $pin; give the pin its own sha256" >&2
  exit 1
fi
