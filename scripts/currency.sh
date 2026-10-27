#!/usr/bin/env bash
# The currency command, outside the check: reports every mise.toml pin, and go.mod's go directive
# and direct requirements, that trail their latest release, as `<file>: ITEM PIN -> LATEST`, one
# line each, and exits nonzero when it reports any; with everything current it prints nothing and
# exits 0. It reads the network and writes nothing. Run it through `mise run currency`, which sets
# GOWORK=off. The layers task extends it to the package dependencies.
# The go.mod scans are adapted from go-web-sdk-template (b6ad574, template/v0.13.0):
# template/scripts/currency.sh, for the root's one module, with JSON read by node.
set -euo pipefail

cd "$(dirname "$0")/.."

stale=0
report() {
  echo "$1"
  stale=1
}

# Errors only: mise warns on every run that npm's GitHub release has no assets as it falls back to
# another source for npm's latest, which would break the silence of a current tree. JSON is read
# with node, a mise pin, not jq.
outdated=$(MISE_LOG_LEVEL=error mise outdated --bump --local --json)
lines=$(node -e '
  const out = JSON.parse(process.argv[1]);
  for (const [tool, v] of Object.entries(out)) console.log(tool + " " + v.requested + " -> " + v.bump);
' "$outdated")
while read -r line; do
  [[ -z "$line" ]] || report "mise.toml: $line"
done <<<"$lines"

# Each scan captures its output before reading it, so under set -e a scan that fails (a go list
# missing a go.sum entry) fails currency instead of reporting nothing.
# Direct requirements with a newer version within their major.
updates=$(go list -m -u -f \
  '{{if and (not .Main) (not .Indirect) .Update}}{{.Path}} {{.Version}} -> {{.Update.Version}}{{end}}' all)
while read -r line; do
  [[ -z "$line" ]] || report "go.mod: $line"
done <<<"$updates"

# The go directive's minor against the latest Go's minor: the directive names a minor, with no
# toolchain line.
go_minor=$(MISE_LOG_LEVEL=error mise latest go | cut -d. -f1,2)
module=$(go mod edit -json)
directive=$(node -p 'JSON.parse(process.argv[1]).Go' "$module" | cut -d. -f1,2)
[[ "$directive" == "$go_minor" ]] || report "go.mod: go $directive -> $go_minor"

exit "$stale"
