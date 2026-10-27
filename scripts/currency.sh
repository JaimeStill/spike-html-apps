#!/usr/bin/env bash
# The currency command, outside the check: reports every mise.toml pin, package.json pin, and
# go.mod's go directive and direct requirements, that trail their latest release, as
# `<file>: ITEM PIN -> LATEST`, one line each, and exits nonzero when it reports any; with
# everything current it prints nothing and exits 0. It reads the network and writes nothing. Run it
# through `mise run currency`, which sets GOWORK=off.
# Adapted from spike-html-apps-foundation (12f4d53): scripts/currency.sh, its package.json scan;
# and from go-web-sdk-template (b6ad574): template/scripts/currency.sh, its go.mod scans, for the
# root's one module, with JSON read by node.
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

# Each package.json pin against its latest on the registry.
pins=$(node -p '
  const { dependencies, devDependencies } = require("./package.json");
  Object.entries({ ...dependencies, ...devDependencies })
    .map(([name, pin]) => name + " " + pin)
    .join("\n")
')
typescript_eslint=$(node -p 'require("./package.json").devDependencies["typescript-eslint"]')
while read -r package pin; do
  [[ -n "$package" ]] || continue
  latest=$(pnpm view "$package" version)
  # typescript is held to the newest version typescript-eslint's peer range accepts.
  if [[ $package == typescript ]]; then
    range=$(pnpm view "typescript-eslint@$typescript_eslint" peerDependencies.typescript)
    accepted=$(pnpm view "typescript@$range" version --json)
    latest=$(node -p '[].concat(JSON.parse(process.argv[1])).join("\n")' "$accepted" |
      sort -V | tail -n 1)
  fi
  [[ $pin == "$latest" ]] || report "package.json: $package $pin -> $latest"
done <<<"$pins"

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
