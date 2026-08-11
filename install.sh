#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ARCHIVE="https://codeload.github.com/epelic/Openwebrx-plus-tactical-interface/tar.gz/refs/heads/main"
TARGET=""
INSTALL_BACKEND=1
ASSUME_YES=0
DRY_RUN=0
WORK_DIR=""
SOURCE_DIR=""

usage() {
    cat <<'EOF'
OpenWebRX+ Tactical Interface installer

Usage: sudo ./install.sh [options]

Options:
  --target PATH    OpenWebRX+ htdocs directory (normally auto-detected)
  --no-backend     Install only the web interface, without the DAB csdr module
  --yes, -y        Do not ask for confirmation
  --dry-run        Detect paths and show the planned operation without writing
  --help, -h       Show this help
EOF
}

log() { printf '[OpenWebRX+ Tactical Interface] %s\n' "$*"; }
die() { printf '[OpenWebRX+ Tactical Interface] ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
    if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}
trap cleanup EXIT

while (($#)); do
    case "$1" in
        --target) [[ $# -ge 2 ]] || die "--target requires a path"; TARGET="$2"; shift 2 ;;
        --no-backend) INSTALL_BACKEND=0; shift ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ "${EUID}" -eq 0 ]] || die "run this installer with sudo"

detect_htdocs() {
    local candidate
    for candidate in \
        /usr/lib/python3/dist-packages/htdocs \
        /usr/local/lib/python3/dist-packages/htdocs \
        /opt/openwebrx/htdocs; do
        if [[ -f "$candidate/index.html" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    candidate="$(find /usr/lib/python3 /usr/local/lib/python3 /opt/openwebrx \
        -maxdepth 5 -type f -path '*/htdocs/index.html' -print -quit 2>/dev/null || true)"
    [[ -n "$candidate" ]] && dirname "$candidate"
}

if [[ -z "$TARGET" ]]; then
    TARGET="$(detect_htdocs)"
fi
[[ -n "$TARGET" ]] || die "OpenWebRX+ htdocs not found; use --target PATH"
TARGET="$(readlink -f "$TARGET")"
[[ -d "$TARGET" && -f "$TARGET/index.html" ]] || die "invalid htdocs directory: $TARGET"
grep -q 'openwebrx_init' "$TARGET/index.html" || die "$TARGET does not look like an OpenWebRX+ web directory"

BACKEND_TARGET=""
ANALOG_TARGET=""
if ((INSTALL_BACKEND)); then
    BACKEND_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/csdr/module/toolbox.py' -print -quit 2>/dev/null || true)"
    [[ -n "$BACKEND_TARGET" ]] || die "csdr/module/toolbox.py not found; use --no-backend for UI-only installation"
    BACKEND_TARGET="$(readlink -f "$BACKEND_TARGET")"
    ANALOG_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/csdr/chain/analog.py' -print -quit 2>/dev/null || true)"
    [[ -n "$ANALOG_TARGET" ]] || die "csdr/chain/analog.py not found; FM stereo cannot be installed"
    ANALOG_TARGET="$(readlink -f "$ANALOG_TARGET")"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/openwebrx-plus-tactical-interface/$STAMP"

log "OpenWebRX+ web directory: $TARGET"
if ((INSTALL_BACKEND)); then
    log "DAB csdr module: $BACKEND_TARGET"
    log "FM stereo chain: $ANALOG_TARGET"
fi
log "Backup directory: $BACKUP_DIR"

if ((DRY_RUN)); then
    log "dry run complete; no files were changed"
    exit 0
fi

if ((ASSUME_YES == 0)); then
    printf 'Install OpenWebRX+ Tactical Interface and restart OpenWebRX? [y/N] '
    read -r answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log "cancelled"; exit 0; }
fi

for command in tar find install cp; do
    command -v "$command" >/dev/null || die "required command not found: $command"
done

WORK_DIR="$(mktemp -d /tmp/openwebrx-plus-tactical-interface.XXXXXX)"
ARCHIVE="$WORK_DIR/source.tar.gz"
if command -v curl >/dev/null; then
    curl -fL --retry 3 --connect-timeout 15 "$REPO_ARCHIVE" -o "$ARCHIVE"
elif command -v wget >/dev/null; then
    wget -O "$ARCHIVE" "$REPO_ARCHIVE"
else
    die "curl or wget is required to download the release"
fi

tar -tzf "$ARCHIVE" >/dev/null || die "downloaded archive is not a valid gzip tar archive"
tar -xzf "$ARCHIVE" -C "$WORK_DIR"
SOURCE_DIR="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$SOURCE_DIR" && -f "$SOURCE_DIR/index.html" ]] || die "downloaded archive is incomplete"
[[ -f "$SOURCE_DIR/lib/AudioProcessor.js" && -f "$SOURCE_DIR/js/mm4.js" ]] || die "required UI files are missing"
if ((INSTALL_BACKEND)); then
    [[ -f "$SOURCE_DIR/backend/csdr/module/toolbox.py" ]] || die "DAB backend file is missing"
    [[ -f "$SOURCE_DIR/backend/csdr/chain/analog.py" ]] || die "FM stereo backend file is missing"
    python3 -m py_compile "$SOURCE_DIR/backend/csdr/module/toolbox.py"
    python3 -m py_compile "$SOURCE_DIR/backend/csdr/chain/analog.py"
fi

mkdir -p "$BACKUP_DIR"
cp -a "$TARGET" "$BACKUP_DIR/htdocs"
if ((INSTALL_BACKEND)); then
    mkdir -p "$BACKUP_DIR/backend"
    cp -a "$BACKEND_TARGET" "$BACKUP_DIR/backend/toolbox.py"
    cp -a "$ANALOG_TARGET" "$BACKUP_DIR/backend/analog.py"
fi

SERVICE_EXISTS=0
SERVICE_ACTIVE=0
if command -v systemctl >/dev/null && systemctl cat openwebrx.service >/dev/null 2>&1; then
    SERVICE_EXISTS=1
    if systemctl is-active --quiet openwebrx.service; then SERVICE_ACTIVE=1; fi
    systemctl stop openwebrx.service
fi

log "installing web interface"
tar -C "$SOURCE_DIR" \
    --exclude='./.git' --exclude='./.gitignore' --exclude='./README.md' \
    --exclude='./install.sh' --exclude='./backend' \
    -cf - . | tar --no-same-owner -C "$TARGET" -xf -

if ((INSTALL_BACKEND)); then
    log "installing DAB and FM stereo csdr modules"
    install -m 0644 "$SOURCE_DIR/backend/csdr/module/toolbox.py" "$BACKEND_TARGET"
    install -m 0644 "$SOURCE_DIR/backend/csdr/chain/analog.py" "$ANALOG_TARGET"
fi

[[ -s "$TARGET/index.html" && -s "$TARGET/lib/AudioProcessor.js" ]] || die "post-installation file check failed"

if ((SERVICE_EXISTS)); then
    systemctl start openwebrx.service
    sleep 1
    systemctl is-active --quiet openwebrx.service || die "OpenWebRX failed to start; backup: $BACKUP_DIR"
elif ((SERVICE_ACTIVE)); then
    log "OpenWebRX service was active but could not be restarted automatically"
fi

log "installation complete"
log "backup saved in $BACKUP_DIR"
log "reload the receiver page with Ctrl+F5"
