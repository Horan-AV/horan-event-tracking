#!/usr/bin/env bash
# Horan Event Tracking — installer for macOS and Linux (Bazzite and other desktops).
# Installs into your home folder only: no root and no pip. (--headless asks for your admin password once,
# to set it to start at boot.)
#
# On a Mac, the easiest way is the Horan-Event-Tracking-<version>.pkg installer (double-click, no Terminal).
#
#   bash install.sh              install / update, start automatically at login
#   bash install.sh --no-service install without the background service (the launcher starts it on demand)
#   bash install.sh --headless   server with no screen (Ubuntu, Debian, Fedora, ...): starts at boot, and other
#                                devices on the network use it in their browser. Asks for a passcode.
#                                Add --port 8080 to use another port.
#
# Your data is never touched by install or update:
#   macOS:  ~/Library/Application Support/Horan Event Tracking/data
#   Linux:  ~/.local/share/horan-rms/data
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=1
HEADLESS=0
PORT=8765
while [ $# -gt 0 ]; do
  case "$1" in
    --no-service) SERVICE=0 ;;
    --headless) HEADLESS=1 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    --port=*) PORT="${1#--port=}" ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) echo "--port must be a number" >&2; exit 2 ;; esac

find_python() {
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 \
           /Library/Frameworks/Python.framework/Versions/Current/bin/python3 "$(command -v python3 || true)"; do
    if [ -n "$p" ] && [ -x "$p" ] && "$p" - <<'EOF' >/dev/null 2>&1
import sys, sqlite3
assert sys.version_info >= (3, 9)
EOF
    then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# ------------------------------------------------------------------ macOS
# (Most Mac users should use the Horan-Event-Tracking .pkg installer instead - no Terminal needed.)
install_mac() {
  local BUNDLE_DIR="$HOME/Applications"
  local PY
  if ! PY="$(find_python)"; then
    echo
    echo "Horan Event Tracking needs Python 3.9 or newer, which macOS provides with its free developer tools."
    echo "If a window has popped up asking to install the “command line developer tools”, click Install,"
    echo "wait for it to finish, then run this installer again."
    xcode-select --install >/dev/null 2>&1 || true
    exit 1
  fi
  echo "Installing Horan Event Tracking for macOS"
  "$PY" "$SRC/macos/build_pkg.py" --bundle-to "$BUNDLE_DIR" >/dev/null
  xattr -cr "$BUNDLE_DIR/Horan Event Tracking.app" >/dev/null 2>&1 || true
  touch "$BUNDLE_DIR/Horan Event Tracking.app"
  echo "Done. Opening Horan Event Tracking — next time, open it from Launchpad or Spotlight."
  open "$BUNDLE_DIR/Horan Event Tracking.app"
}

# ------------------------------------------------------------------ Linux
install_linux() {
  local BASE="$HOME/.local/share/horan-rms"
  local APP="$BASE/app"
  local BIN="$HOME/.local/bin"
  local APPS="$HOME/.local/share/applications"
  local UNIT_DIR="$HOME/.config/systemd/user"
  local PY

  if ! PY="$(find_python)"; then
    echo "Python 3.9 or newer wasn't found. It ships with Bazzite, so this is unusual —"
    echo "try running this from a normal terminal (Konsole/Ptyxis) rather than inside a container."
    exit 1
  fi

  echo "Installing Horan Event Tracking into $APP"
  mkdir -p "$APP/static" "$BIN" "$APPS" "$BASE/data"
  cp "$SRC/server.py" "$APP/server.py"
  cp -r "$SRC/static/." "$APP/static/"
  cp "$SRC/uninstall.sh" "$APP/uninstall.sh"
  install -m 755 "$SRC/horan-rms" "$BIN/horan-rms"
  chmod 755 "$APP/server.py" "$APP/uninstall.sh"

  cat > "$APPS/horan-rms.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Horan Event Tracking
GenericName=Event & Rental Tracking
Comment=Stock, prep, jobs and availability — runs offline on this computer
Exec=$BIN/horan-rms
Icon=$APP/static/icon-512.png
Terminal=false
Categories=Office;Finance;
Keywords=rental;hire;av;quote;invoice;stock;event;prep;
StartupNotify=false
EOF
  chmod 644 "$APPS/horan-rms.desktop"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

  rm -f "$HOME/.local/share/horan-rms/data/server-mode"
  if [ "$SERVICE" = 1 ] && command -v systemctl >/dev/null 2>&1; then
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/horan-rms.service" <<EOF
[Unit]
Description=Horan Event Tracking (local server)

[Service]
ExecStart=$PY $APP/server.py --port $PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable horan-rms.service >/dev/null 2>&1
    systemctl --user restart horan-rms.service
    echo "Background service enabled — it starts when you log in."
  fi

  case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: $BIN isn't on your PATH; the app menu launcher still works." ;; esac

  echo
  echo "Done. Open “Horan Event Tracking” from your app menu, or go to http://127.0.0.1:$PORT"
  echo "Your data: $BASE/data   (daily snapshots in $BASE/data/backups)"
}

# ------------------------------------------------------------------ Linux server with no screen
install_headless() {
  local BASE="$HOME/.local/share/horan-rms"
  local APP="$BASE/app"
  local BIN="$HOME/.local/bin"
  local PY
  if ! PY="$(find_python)"; then
    echo "Python 3.9 or newer is needed. Install it, then run this again:"
    echo "  Ubuntu / Debian:  sudo apt install python3"
    echo "  Fedora / RHEL:    sudo dnf install python3"
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
    echo "This server doesn't use systemd, so Horan Event Tracking can't set itself to start at boot."
    echo "It'll be started now; after a reboot, start it again with:  horan-rms"
    SERVICE=0
  fi

  echo "Installing Horan Event Tracking (server mode) into $APP"
  mkdir -p "$APP/static" "$BIN" "$BASE/data"
  cp "$SRC/server.py" "$APP/server.py"
  cp -r "$SRC/static/." "$APP/static/"
  cp "$SRC/uninstall.sh" "$APP/uninstall.sh"
  install -m 755 "$SRC/horan-rms" "$BIN/horan-rms"
  chmod 755 "$APP/server.py" "$APP/uninstall.sh"

  # Passcode for other devices (kept if one is already set)
  if "$PY" "$APP/server.py" --port "$PORT" --status 2>/dev/null | grep -q "Passcode set:    yes"; then
    echo "Keeping the passcode you already set. Change it any time with:  horan-rms passcode"
  elif [ -n "${HORAN_RMS_PASSCODE:-}" ] || [ -t 0 ]; then
    echo
    echo "Choose a passcode. Phones, tablets and computers enter it once to sign in."
    until "$PY" "$APP/server.py" --port "$PORT" --set-passcode; do
      [ -n "${HORAN_RMS_PASSCODE:-}" ] && exit 1
      echo "Let's try that again."
    done
  else
    echo "No passcode set yet (no terminal to ask). Set one with:  horan-rms passcode"
  fi
  "$PY" "$APP/server.py" --port "$PORT" --network on >/dev/null 2>&1 || true
  # Remember server mode in the data folder, so however it's restarted admins can still update it from any device.
  "$PY" "$APP/server.py" --port "$PORT" --headless-mode on >/dev/null 2>&1 || true

  if [ "$SERVICE" = 1 ] && [ "$(id -u)" != 0 ]; then
    # Setting it to start at boot needs root once. Debian containers (e.g. Proxmox LXC) often have no sudo,
    # or you're not allowed to use it - then just start it now and say how to finish.
    local why=""
    if ! command -v sudo >/dev/null 2>&1; then
      why="sudo isn't installed"
    else
      echo
      echo "Setting it to start when the server boots (this may ask for your password)..."
      if [ -t 0 ]; then sudo -v || why="sudo didn't work for $(id -un)"
      else sudo -n true 2>/dev/null || why="sudo needs a password and there's no terminal to ask"; fi
    fi
    if [ -n "$why" ]; then
      echo
      echo "$why, so it can't be set to start at boot yet. It's been started for now."
      echo "To have it start at boot, either run this installer as root, or as root run:"
      echo "  apt install sudo && usermod -aG sudo $(id -un)"
      echo "then log in again as $(id -un) and run  bash install.sh --headless  once more."
      SERVICE=0
    fi
  fi

  if [ "$SERVICE" = 1 ]; then
    # A system service starts at boot, even when nobody is logged in. It runs as you, not as root.
    local UNIT=/etc/systemd/system/horan-rms.service
    local SUDO=""
    [ "$(id -u)" = 0 ] || SUDO="sudo"
    printf '%s\n' \
      "[Unit]" \
      "Description=Horan Event Tracking (server)" \
      "After=network-online.target" \
      "Wants=network-online.target" \
      "" \
      "[Service]" \
      "User=$(id -un)" \
      "Group=$(id -gn)" \
      "Environment=HOME=$HOME" \
      "ExecStart=$PY $APP/server.py --headless --port $PORT" \
      "Restart=on-failure" \
      "RestartSec=3" \
      "" \
      "[Install]" \
      "WantedBy=multi-user.target" | $SUDO tee "$UNIT" >/dev/null
    # An older per-user service would clash over the port.
    systemctl --user disable --now horan-rms.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/horan-rms.service"
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable horan-rms.service >/dev/null 2>&1
    # Stop any copy started by hand (it would hold the port), then start the service.
    pkill -f "$APP/server.py" >/dev/null 2>&1 || true
    sleep 1
    $SUDO systemctl restart horan-rms.service

    # Open the port in the firewall if one is running.
    if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
      $SUDO ufw allow "$PORT/tcp" >/dev/null && echo "Opened port $PORT in the firewall (ufw)."
    elif command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
      if $SUDO firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null && $SUDO firewall-cmd --reload >/dev/null; then
        echo "Opened port $PORT in the firewall (firewalld)."
      fi
    fi
  fi

  if [ "$SERVICE" = 0 ]; then
    pkill -f "$APP/server.py" >/dev/null 2>&1 || true
    sleep 1
    nohup "$PY" "$APP/server.py" --headless --port "$PORT" >>"$BASE/server.log" 2>&1 &
  fi

  case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: $BIN isn't on your PATH yet. Use $BIN/horan-rms, or log out and back in." ;; esac
  sleep 2
  echo
  echo "Done. Horan Event Tracking is running as a server."
  "$PY" "$APP/server.py" --port "$PORT" --status | grep -E "^Open on" || echo "Open http://<this-server's-address>:$PORT/ on any device on your network."
  echo
  echo "Manage it with:  horan-rms status | passcode | restart | logs | network on|off"
  echo "Your data: $BASE/data   (daily snapshots in $BASE/data/backups)"
}

if [ "$(uname -s)" = "Darwin" ]; then
  [ "$HEADLESS" = 1 ] && { echo "Headless mode is for Linux servers. On a Mac, turn on Settings > Network access instead."; exit 2; }
  install_mac
elif [ "$HEADLESS" = 1 ]; then
  install_headless
else
  install_linux
fi
