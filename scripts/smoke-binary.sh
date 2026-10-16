#!/bin/sh
# Starts a standalone binary the way a user's machine does: from a directory outside the
# checkout, so nothing can come from the source tree. The version must be the package's, `--help`
# and the command table must list, and `mockd` alone must show its usage with exit 2. CI runs it
# on every build (ci.yml, release.yml).
#
#   scripts/smoke-binary.sh dist/mockd-linux-x64
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <binary>" >&2
  exit 2
fi

root=$(cd "$(dirname "$0")/.." && pwd)
bin="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
# The version is read with a relative path from inside the package: a native node on Windows
# cannot open the POSIX-style path a bash there reports.
want=$(cd "$root" && node -p "require('./package.json').version")
cd "$(mktemp -d)"
# Signed out and pointing nowhere: neither a client access nor another backend from the
# environment reaches the binary.
unset MOCKD_CLIENT_ID MOCKD_CLIENT_SECRET MOCKD_API_URL MOCKD_PROFILE

got=$("$bin" --version)
if [ "$got" != "$want" ]; then
  echo "$bin --version says $got, package.json $want" >&2
  exit 1
fi

help=$("$bin" --help)
for usage in "mockd guide [topic]" "mockd try run create" "mockd login" "mockd runs list"; do
  if ! printf '%s\n' "$help" | grep -qF "$usage"; then
    echo "$bin --help lists no '$usage':" >&2
    printf '%s\n' "$help" >&2
    exit 1
  fi
done

commands=$("$bin" commands --json)
for name in guide "catalog list" "try run create" login whoami logout "runs list"; do
  if ! printf '%s\n' "$commands" | grep -qF "\"name\": \"$name\""; then
    echo "$bin commands --json lists no '$name':" >&2
    printf '%s\n' "$commands" >&2
    exit 1
  fi
done

# Alone, `mockd` shows its usage and ends with exit 2.
status=0
alone=$("$bin" < /dev/null) || status=$?
if [ "$status" -ne 2 ] || ! printf '%s\n' "$alone" | grep -qF "mockd login"; then
  echo "$bin alone ended with $status instead of the usage and exit 2" >&2
  exit 1
fi

echo "$(basename "$bin") $got: $(du -h "$bin" | cut -f1), starts, shows its help, lists its commands, shows its usage alone"
