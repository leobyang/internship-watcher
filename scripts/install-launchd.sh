#!/bin/bash
# Install the watcher as a macOS background daemon (runs once every hour).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="com.internship.watcher.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST"
PYTHON_BIN="$(which python3)"

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"

if [ ! -f "$DIR/.env" ]; then
  echo "error: $DIR/.env does not exist. Fill in .env first." >&2
  exit 1
fi

cat <<EOF > "$TARGET"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.internship.watcher</string>

  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_BIN</string>
    <string>$DIR/cli.py</string>
    <string>scan</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$DIR</string>

  <!-- Run once every hour (3600 seconds). Fires on wake if Mac was asleep. -->
  <key>StartInterval</key>
  <integer>3600</integer>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>$DIR/logs/watcher.log</string>
  <key>StandardErrorPath</key>
  <string>$DIR/logs/watcher.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/com.internship.watcher" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.pmintern.watcher" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/com.internship.watcher"

echo "Installed successfully! The watcher will run automatically once every hour."
echo "  Logs:      tail -f $DIR/logs/watcher.log"
echo "  Stop:      launchctl bootout gui/\$(id -u)/com.internship.watcher"
echo "  Run now:   launchctl kickstart -k gui/\$(id -u)/com.internship.watcher"
