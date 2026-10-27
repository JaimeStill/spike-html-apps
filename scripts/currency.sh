#!/usr/bin/env bash
# The currency command, outside the check: reports every mise.toml pin that trails its latest
# release, as `mise.toml: TOOL PIN -> LATEST`, one line each, and exits nonzero when it reports any;
# with everything current it prints nothing and exits 0. It reads the network and writes nothing.
# Run it through `mise run currency`. The layers task extends it to the package dependencies and go.mod.
set -euo pipefail

cd "$(dirname "$0")/.."

# Errors only: mise warns on every run that npm's GitHub release has no assets as it falls back to
# another source for npm's latest, which would break the silence of a current tree. JSON is read
# with node, a mise pin, not jq.
outdated=$(MISE_LOG_LEVEL=error mise outdated --bump --local --json)
lines=$(node -e '
  const out = JSON.parse(process.argv[1]);
  for (const [tool, v] of Object.entries(out)) console.log(tool + " " + v.requested + " -> " + v.bump);
' "$outdated")

stale=0
while read -r line; do
  if [[ -n "$line" ]]; then
    echo "mise.toml: $line"
    stale=1
  fi
done <<<"$lines"
exit "$stale"
