#!/usr/bin/env bash
set -euo pipefail

PATCH_FILE="${1:?DABlin patch path is required}"
DESTINATION="/usr/local/lib/openwebrx/dablin-dls"
MARKER="${DESTINATION}.patch-sha256"
SOURCE_COMMIT="96ae480f7ff6c20c9c3cdbcc35c80cf88f5ab750"
PATCH_SHA256="$(sha256sum "$PATCH_FILE" | cut -d' ' -f1)"

if [[ -x "$DESTINATION" && -f "$MARKER" ]] &&
        [[ "$(cat "$MARKER")" == "$PATCH_SHA256" ]] &&
        grep -a -q 'DynamicLabel:' "$DESTINATION"; then
    exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl patch cmake make g++ libfaad-dev libmpg123-dev

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
curl -fsSL "https://github.com/Opendigitalradio/dablin/archive/${SOURCE_COMMIT}.tar.gz" -o "$WORK_DIR/dablin.tar.gz"
tar -xzf "$WORK_DIR/dablin.tar.gz" -C "$WORK_DIR"
SOURCE_DIR="$WORK_DIR/dablin-${SOURCE_COMMIT}"
patch -d "$SOURCE_DIR" -p1 < "$PATCH_FILE"
cmake -S "$SOURCE_DIR" -B "$WORK_DIR/build" -DDISABLE_SDL=1 -DCMAKE_BUILD_TYPE=Release
cmake --build "$WORK_DIR/build" --target dablin --parallel 2
install -d -m 0755 "$(dirname "$DESTINATION")"
install -m 0755 "$WORK_DIR/build/src/dablin" "$DESTINATION"
grep -a -q 'DynamicLabel:' "$DESTINATION"
printf '%s\n' "$PATCH_SHA256" > "$MARKER"
