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
DAB_CHAIN_TARGET=""
DAB_WRAPPER_TARGET=""
DAB_DLS_BINARY="/usr/local/lib/openwebrx/dablin-dls"
DSP_TARGET=""
MODES_TARGET=""
SETTINGS_FILE="/var/lib/openwebrx/settings.json"
if ((INSTALL_BACKEND)); then
    BACKEND_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/csdr/module/toolbox.py' -print -quit 2>/dev/null || true)"
    [[ -n "$BACKEND_TARGET" ]] || die "csdr/module/toolbox.py not found; use --no-backend for UI-only installation"
    BACKEND_TARGET="$(readlink -f "$BACKEND_TARGET")"
    ANALOG_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/csdr/chain/analog.py' -print -quit 2>/dev/null || true)"
    [[ -n "$ANALOG_TARGET" ]] || die "csdr/chain/analog.py not found; FM stereo cannot be installed"
    ANALOG_TARGET="$(readlink -f "$ANALOG_TARGET")"
    DAB_CHAIN_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/csdr/chain/dablin.py' -print -quit 2>/dev/null || true)"
    [[ -n "$DAB_CHAIN_TARGET" ]] || die "csdr/chain/dablin.py not found; DAB stereo cannot be installed"
    DAB_CHAIN_TARGET="$(readlink -f "$DAB_CHAIN_TARGET")"
    DAB_WRAPPER_TARGET="$(dirname "$BACKEND_TARGET")/dablin-metadata-wrapper"
    DSP_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/owrx/dsp.py' -print -quit 2>/dev/null || true)"
    MODES_TARGET="$(find /usr/lib/python3/dist-packages /usr/local/lib/python3/dist-packages \
        -type f -path '*/owrx/modes.py' -print -quit 2>/dev/null || true)"
    [[ -n "$DSP_TARGET" && -n "$MODES_TARGET" ]] || die "OpenWebRX mode registry files not found; C-QUAM cannot be installed"
    DSP_TARGET="$(readlink -f "$DSP_TARGET")"
    MODES_TARGET="$(readlink -f "$MODES_TARGET")"
    [[ -f "$SETTINGS_FILE" ]] || die "OpenWebRX settings not found: $SETTINGS_FILE"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/openwebrx-plus-tactical-interface/$STAMP"

log "OpenWebRX+ web directory: $TARGET"
if ((INSTALL_BACKEND)); then
    log "DAB csdr module: $BACKEND_TARGET"
    log "FM stereo chain: $ANALOG_TARGET"
    log "DAB stereo chain: $DAB_CHAIN_TARGET"
    log "DAB DLS wrapper: $DAB_WRAPPER_TARGET"
    log "C-QUAM mode registry: $DSP_TARGET, $MODES_TARGET"
    log "OpenWebRX settings: $SETTINGS_FILE"
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

for command in tar find install cp grep python3 curl seq; do
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
grep -Fq "'am','sam','cquam'" "$SOURCE_DIR/js/mm4.js" || die "C-QUAM FILTER BW control is missing from the downloaded interface"
grep -q 'formattedEnsembleId' "$SOURCE_DIR/lib/MetaPanel.js" || die "DAB Ensemble ID normalization is missing"
if ((INSTALL_BACKEND)); then
    [[ -f "$SOURCE_DIR/backend/csdr/module/toolbox.py" ]] || die "DAB backend file is missing"
    [[ -f "$SOURCE_DIR/backend/csdr/chain/analog.py" ]] || die "FM stereo backend file is missing"
    [[ -f "$SOURCE_DIR/backend/csdr/chain/dablin.py" ]] || die "DAB stereo chain file is missing"
    [[ -f "$SOURCE_DIR/backend/csdr/module/dablin-metadata-wrapper" ]] || die "DAB metadata wrapper is missing"
    [[ -f "$SOURCE_DIR/backend/build_dablin_dls.sh" && -f "$SOURCE_DIR/backend/dablin-dls.patch" ]] || die "DAB DLS build files are missing"
    [[ -f "$SOURCE_DIR/backend/enable_cquam.py" ]] || die "C-QUAM mode installer is missing"
    grep -q 'channels=int(match.group(2))' "$SOURCE_DIR/backend/csdr/module/toolbox.py" || die "DAB channel detection is missing"
    grep -q 'setHdInputRate' "$SOURCE_DIR/lib/AudioEngine.js" || die "DAB 32/48 kHz switching is missing"
    grep -q 'StereoResampler' "$SOURCE_DIR/lib/AudioEngine.js" || die "DAB stereo resampler is missing"
    grep -q 'StereoBiquadLowpass' "$SOURCE_DIR/lib/AudioEngine.js" || die "DAB anti-imaging audio filter is missing"
    ! grep -Eq 'from pycsdr.modules import.*Downmix|workers.*Downmix' "$SOURCE_DIR/backend/csdr/chain/dablin.py" || die "DAB chain still contains a mono downmix"
    grep -q 'Gain(Format.FLOAT, 10 \*\* (-9 / 20))' "$SOURCE_DIR/backend/csdr/chain/dablin.py" || die "DAB float-domain headroom is missing"
    grep -q 'DablinModule(self.processor.setAudioFormat)' "$SOURCE_DIR/backend/csdr/chain/dablin.py" || die "DAB sample-rate reporting is missing"
    grep -q '"dab_details": dict(details)' "$SOURCE_DIR/backend/csdr/chain/dablin.py" || die "DAB metadata envelope is missing"
    grep -q 'DynamicLabel:' "$SOURCE_DIR/backend/csdr/module/toolbox.py" || die "DAB Radiotext parser is missing"
    grep -q 'dab-radiotext' "$SOURCE_DIR/lib/MetaPanel.js" || die "DAB Radiotext UI is missing"
    grep -q 'class Cquam' "$SOURCE_DIR/backend/csdr/chain/analog.py" || die "C-QUAM decoder is missing"
    grep -q "modulation === 'cquam'" "$SOURCE_DIR/lib/AudioEngine.js" || die "browser C-QUAM stereo support is missing"
    grep -q 'new AudioRecorder(48000, 192, 2)' "$SOURCE_DIR/lib/AudioEngine.js" || die "192 kb/s, 48 kHz stereo MP3 recording is missing"
    grep -q 'Mp3Encoder(this.channels, sampleRate, kbps)' "$SOURCE_DIR/lib/AudioEngine.js" || die "stereo MP3 encoder is missing"
    python3 -m py_compile "$SOURCE_DIR/backend/csdr/module/toolbox.py"
    python3 -m py_compile "$SOURCE_DIR/backend/csdr/chain/analog.py"
    python3 -m py_compile "$SOURCE_DIR/backend/csdr/chain/dablin.py"
    python3 -m py_compile "$SOURCE_DIR/backend/enable_cquam.py"
    python3 -m json.tool "$SETTINGS_FILE" >/dev/null || die "OpenWebRX settings JSON is invalid"
fi

mkdir -p "$BACKUP_DIR"
cp -a "$TARGET" "$BACKUP_DIR/htdocs"
if ((INSTALL_BACKEND)); then
    mkdir -p "$BACKUP_DIR/backend"
    cp -a "$BACKEND_TARGET" "$BACKUP_DIR/backend/toolbox.py"
    cp -a "$ANALOG_TARGET" "$BACKUP_DIR/backend/analog.py"
    cp -a "$DAB_CHAIN_TARGET" "$BACKUP_DIR/backend/dablin.py"
    [[ ! -f "$DAB_WRAPPER_TARGET" ]] || cp -a "$DAB_WRAPPER_TARGET" "$BACKUP_DIR/backend/dablin-metadata-wrapper"
    [[ ! -f "$DAB_DLS_BINARY" ]] || cp -a "$DAB_DLS_BINARY" "$BACKUP_DIR/backend/dablin-dls"
    cp -a "$DSP_TARGET" "$BACKUP_DIR/backend/dsp.py"
    cp -a "$MODES_TARGET" "$BACKUP_DIR/backend/modes.py"
    cp -a "$SETTINGS_FILE" "$BACKUP_DIR/settings.json"
fi

if ((INSTALL_BACKEND)); then
    log "building DAB 1.14 Dynamic Label support when needed"
    bash "$SOURCE_DIR/backend/build_dablin_dls.sh" "$SOURCE_DIR/backend/dablin-dls.patch"
    grep -a -q 'DABlin v1.14.0' "$DAB_DLS_BINARY" || die "DAB Dynamic Label decoder is not based on version 1.14.0"
    grep -a -q '32bit float' "$DAB_DLS_BINARY" || die "DAB Dynamic Label decoder lacks float PCM output"
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
    install -m 0644 "$SOURCE_DIR/backend/csdr/chain/dablin.py" "$DAB_CHAIN_TARGET"
    install -m 0755 "$SOURCE_DIR/backend/csdr/module/dablin-metadata-wrapper" "$DAB_WRAPPER_TARGET"
    log "registering the C-QUAM demodulator"
    python3 "$SOURCE_DIR/backend/enable_cquam.py" --dsp "$DSP_TARGET" --modes "$MODES_TARGET"
    python3 "$SOURCE_DIR/backend/enable_cquam.py" --check --dsp "$DSP_TARGET" --modes "$MODES_TARGET"
    python3 -m py_compile "$DSP_TARGET" "$MODES_TARGET"
    log "disabling mono ADPCM compression for DAB stereo"
    python3 - "$SETTINGS_FILE" <<'PY'
import json
import os
import sys
import tempfile

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as source:
    settings = json.load(source)
settings["audio_compression"] = "none"
fd, temporary = tempfile.mkstemp(prefix="settings.", suffix=".json", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as target:
        json.dump(settings, target, indent=4)
        target.write("\n")
    os.chmod(temporary, os.stat(path).st_mode)
    os.chown(temporary, os.stat(path).st_uid, os.stat(path).st_gid)
    os.replace(temporary, path)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY
fi

[[ -s "$TARGET/index.html" && -s "$TARGET/lib/AudioProcessor.js" ]] || die "post-installation file check failed"
grep -Fq "'am','sam','cquam'" "$TARGET/js/mm4.js" || die "installed C-QUAM FILTER BW control is missing"
grep -q 'formattedEnsembleId' "$TARGET/lib/MetaPanel.js" || die "installed DAB Ensemble ID normalization is missing"
if ((INSTALL_BACKEND)); then
    python3 - "$SETTINGS_FILE" <<'PY' || die "DAB stereo post-installation check failed"
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as source:
    assert json.load(source).get("audio_compression") == "none"
PY
    grep -q 'setHdInputRate' "$TARGET/lib/AudioEngine.js" || die "installed DAB sample-rate switching is missing"
    grep -q 'StereoResampler' "$TARGET/lib/AudioEngine.js" || die "installed DAB stereo resampler is missing"
    grep -q 'StereoBiquadLowpass' "$TARGET/lib/AudioEngine.js" || die "installed DAB anti-imaging audio filter is missing"
    ! grep -Eq 'from pycsdr.modules import.*Downmix|workers.*Downmix' "$DAB_CHAIN_TARGET" || die "installed DAB chain still forces mono"
    grep -q 'Gain(Format.FLOAT, 10 \*\* (-9 / 20))' "$DAB_CHAIN_TARGET" || die "installed DAB float-domain headroom is missing"
    grep -q 'DablinModule(self.processor.setAudioFormat)' "$DAB_CHAIN_TARGET" || die "installed DAB chain does not report its sample rate"
    grep -q '"dab_details": dict(details)' "$DAB_CHAIN_TARGET" || die "installed DAB chain does not expose service metadata"
    grep -q 'DynamicLabel:' "$BACKEND_TARGET" || die "installed DAB backend does not parse Radiotext"
    grep -q 'dab-radiotext' "$TARGET/lib/MetaPanel.js" || die "installed DAB panel has no Radiotext field"
    [[ -x "$DAB_DLS_BINARY" ]] || die "DAB Dynamic Label decoder is not installed"
    grep -a -q 'DABlin v1.14.0' "$DAB_DLS_BINARY" || die "installed DAB Dynamic Label decoder has the wrong version"
    grep -a -q '32bit float' "$DAB_DLS_BINARY" || die "installed DAB Dynamic Label decoder lacks float PCM output"
    grep -q 'dablin-dls' "$DAB_WRAPPER_TARGET" || die "DAB metadata wrapper does not use the Dynamic Label decoder"
    grep -q 'class Cquam' "$ANALOG_TARGET" || die "installed C-QUAM decoder is missing"
    grep -q 'elif demod == "cquam"' "$DSP_TARGET" || die "installed C-QUAM DSP registration is missing"
    grep -q 'AnalogMode("cquam", "C-QUAM"' "$MODES_TARGET" || die "installed C-QUAM mode registration is missing"
fi

if ((SERVICE_EXISTS)); then
    systemctl start openwebrx.service
    sleep 1
    systemctl is-active --quiet openwebrx.service || die "OpenWebRX failed to start; backup: $BACKUP_DIR"
    if ((INSTALL_BACKEND)); then
        LIVE_BUNDLE="$WORK_DIR/receiver.js"
        BUNDLE_READY=0
        for _ in $(seq 1 45); do
            if curl -fs "http://127.0.0.1:8073/compiled/receiver.js?installer=$STAMP" -o "$LIVE_BUNDLE"; then
                BUNDLE_READY=1
                break
            fi
            sleep 1
        done
        ((BUNDLE_READY)) || die "could not verify the live receiver bundle; backup: $BACKUP_DIR"
        grep -q 'StereoResampler' "$LIVE_BUNDLE" || die "live receiver bundle has no DAB stereo support; backup: $BACKUP_DIR"
        grep -q 'setHdInputRate' "$LIVE_BUNDLE" || die "live receiver bundle has no DAB 32/48 kHz switching; backup: $BACKUP_DIR"
        grep -q 'new AudioRecorder(48000, 192, 2)' "$LIVE_BUNDLE" || die "live receiver bundle has no 192 kb/s stereo recorder; backup: $BACKUP_DIR"
        grep -q "modulation === 'cquam'" "$LIVE_BUNDLE" || die "live receiver bundle has no C-QUAM stereo support; backup: $BACKUP_DIR"
        grep -q 'formattedEnsembleId' "$LIVE_BUNDLE" || die "live receiver bundle has no DAB Ensemble ID normalization; backup: $BACKUP_DIR"
        grep -q 'dab-radiotext' "$LIVE_BUNDLE" || die "live receiver bundle has no DAB Radiotext UI; backup: $BACKUP_DIR"
    fi
elif ((SERVICE_ACTIVE)); then
    log "OpenWebRX service was active but could not be restarted automatically"
fi

log "installation complete"
log "backup saved in $BACKUP_DIR"
log "reload the receiver page with Ctrl+F5"
