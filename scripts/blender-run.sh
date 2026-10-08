#!/usr/bin/env bash
# Run a Python script in headless Windows Blender from WSL (works with the Microsoft Store build).
#   scripts/blender-run.sh assets-src/blender/build_dive_bar.py [script args...]
# Script args arrive in sys.argv[1:]. Output is captured and printed after Blender exits.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$(realpath "$1")"; shift
log="$(mktemp --tmpdir="$here/.." .blender-XXXXXX.log)"
trap 'rm -f "$log"' EXIT
winq() { printf "'%s'" "$(wslpath -w "$1" | sed "s/'/''/g")"; }
args="'--background','--factory-startup','--python-exit-code','1','--python',$(winq "$here/blender_bootstrap.py"),'--',$(winq "$log"),$(winq "$script")"
for a in "$@"; do args+=",'$(printf '%s' "$a" | sed "s/'/''/g")'"; done
code=$(powershell.exe -NoProfile -Command "\$p = Start-Process -FilePath 'blender-launcher.exe' -ArgumentList $args -PassThru -Wait -WindowStyle Hidden; \$p.ExitCode" | tr -d '\r')
cat "$log"
exit "${code:-1}"
