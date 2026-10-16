#!/bin/sh
# The standalone binaries: one file per target, the Bun runtime inside, so the machine that
# runs mockd needs no Node. https://mock-d.com/install downloads them from the releases of this
# repository. CI builds and starts the file of its own system on every pull request (ci.yml),
# the release builds all five targets (release.yml); locally this needs bun. bin/mockd.js
# imports nothing from node_modules, so the build needs no `npm ci`.
#
#   scripts/build-binaries.sh linux-x64   ->  dist/mockd-linux-x64
#
# Targets: darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 (Bun adds the .exe).
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <os-arch>... (darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64)" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

for target in "$@"; do
  # bin/mockd.js with everything it imports. The .env and bunfig.toml of the directory mockd
  # runs in stay unread: a Bun binary would load them by default, node never did.
  bun build ./bin/mockd.js --compile \
    --target "bun-$target" \
    --no-compile-autoload-dotenv \
    --no-compile-autoload-bunfig \
    --outfile "dist/mockd-$target"
done
