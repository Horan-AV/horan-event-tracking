#!/usr/bin/env bash
# Horan Event Tracking — uninstaller (macOS and Linux).
#   bash uninstall.sh          remove the app but KEEP your data
#   bash uninstall.sh --purge  remove the app AND all data (database, logo, backups)
set -uo pipefail

if [ "$(uname -s)" = "Darwin" ]; then
  BASE="$HOME/Library/Application Support/Horan Event Tracking"
  LABEL="com.horanav.eventtracking"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$HOME/Library/LaunchAgents/$LABEL.plist" >/dev/null 2>&1
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
  pkill -f "$BASE/app/server.py" >/dev/null 2>&1
  rm -rf "$HOME/Applications/Horan Event Tracking.app" "$BASE/app" "$BASE/.bundle-version"
  rm -rf "/Applications/Horan Event Tracking.app" 2>/dev/null || echo "To remove the copy in /Applications, drag it to the Bin."
else
  BASE="$HOME/.local/share/horan-rms"
  if [ -f /etc/systemd/system/horan-rms.service ]; then  # headless server install
    SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
    $SUDO systemctl disable --now horan-rms.service >/dev/null 2>&1
    $SUDO rm -f /etc/systemd/system/horan-rms.service
    $SUDO systemctl daemon-reload >/dev/null 2>&1
    echo "If you opened a firewall port for it, you can close it again (e.g. sudo ufw delete allow 8765/tcp)."
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now horan-rms.service >/dev/null 2>&1
    rm -f "$HOME/.config/systemd/user/horan-rms.service"
    systemctl --user daemon-reload >/dev/null 2>&1
  fi
  pkill -f "$BASE/app/server.py" >/dev/null 2>&1
  rm -f "$HOME/.local/bin/horan-rms" "$HOME/.local/share/applications/horan-rms.desktop" "$BASE/custom-icon.png"
  rm -rf "$BASE/app" "$BASE/server.log"
fi

if [ "${1:-}" = "--purge" ]; then
  read -r -p "Delete ALL your Horan Event Tracking data in $BASE/data? Type DELETE to confirm: " ans
  if [ "$ans" = "DELETE" ]; then
    rm -rf "$BASE"
    echo "App and data removed."
    exit 0
  fi
  echo "Data kept."
fi
echo "Horan Event Tracking removed. Your data is still in $BASE/data"
