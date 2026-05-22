#!/usr/bin/env bash
# DiskWatch installer
set -euo pipefail

INSTALL_DIR="/var/www/diskwatch/app"
SERVICE_FILE="diskwatch.service"
SERVICE_EXAMPLE="diskwatch.service.example"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: install.sh must be run as root (e.g. sudo bash install.sh)." >&2
  exit 1
fi

# Detect the non-root user who invoked sudo; fall back to prompting.
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  SERVICE_USER="${SUDO_USER}"
else
  read -rp "Enter the service username (the non-root user that will run DiskWatch): " SERVICE_USER
fi
echo "Using service user: ${SERVICE_USER}"

echo "=== DiskWatch installer ==="
echo ""

# Create directory structure
echo "Creating ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}/static"

# Create Python venv
if [[ ! -d "${INSTALL_DIR}/venv" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "${INSTALL_DIR}/venv"
fi

# Install Python dependencies
echo "Installing Python dependencies..."
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${SCRIPT_DIR}/requirements.txt"

# Copy app files
echo "Copying application files..."
cp "${SCRIPT_DIR}/server.py"           "${INSTALL_DIR}/server.py"
cp "${SCRIPT_DIR}/collector.py"        "${INSTALL_DIR}/collector.py"
cp "${SCRIPT_DIR}/notifications.py"    "${INSTALL_DIR}/notifications.py"
sed "s|__INSTALL_DIR__|${INSTALL_DIR}|g; s|__SERVICE_USER__|${SERVICE_USER}|g" \
    "${SCRIPT_DIR}/collect.sh" > "${INSTALL_DIR}/collect.sh"
cp "${SCRIPT_DIR}/static/index.html"   "${INSTALL_DIR}/static/index.html"
cp "${SCRIPT_DIR}/static/style.css"    "${INSTALL_DIR}/static/style.css"
cp "${SCRIPT_DIR}/static/app.js"       "${INSTALL_DIR}/static/app.js"

# Write default config if none exists
if [[ ! -f "${INSTALL_DIR}/config.yaml" ]]; then
  echo "Writing default config.yaml..."
  cp "${SCRIPT_DIR}/config_default.yaml" "${INSTALL_DIR}/config.yaml"
else
  echo "config.yaml already exists, skipping."
fi

# Pre-create the database file owned by the service user.
# The collector runs as root and would otherwise create it as root-owned,
# preventing the web server (uscloud) from reading it.
if [[ ! -f "${INSTALL_DIR}/diskwatch.db" ]]; then
  echo "Pre-creating database file..."
  touch "${INSTALL_DIR}/diskwatch.db"
fi

# Set ownership
echo "Setting ownership to ${SERVICE_USER}:${SERVICE_USER}..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chmod 750 "${INSTALL_DIR}"
chmod 640 "${INSTALL_DIR}/config.yaml" 2>/dev/null || true

# Make scripts executable
chmod +x "${INSTALL_DIR}/collector.py"
chmod +x "${INSTALL_DIR}/collect.sh"

# Install systemd service (generated from example with actual paths/user)
echo "Installing systemd service..."
sed \
  "s|__INSTALL_DIR__|${INSTALL_DIR}|g; s|__SERVICE_USER__|${SERVICE_USER}|g" \
  "${SCRIPT_DIR}/${SERVICE_EXAMPLE}" \
  > "/etc/systemd/system/${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable diskwatch
systemctl restart diskwatch

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. The DiskWatch service is now running."
echo "   Check status: systemctl status diskwatch"
echo "   View logs:    journalctl -u diskwatch -f"
echo ""
echo "2. Add the cron job for data collection (runs as root at 04:00 daily):"
echo "   Run: sudo crontab -e"
echo "   Add this line:"
echo "   0 4 * * * ${INSTALL_DIR}/collect.sh >> /var/log/diskwatch-collector.log 2>&1"
echo ""
echo "3. Run the first collection manually (as root):"
echo "   sudo ${INSTALL_DIR}/collect.sh"
echo ""
echo "4. Access the UI at: http://localhost:8070"
echo "   (or via your reverse proxy)"
echo "   On first visit, you will be prompted to set the admin password."
echo ""
echo "5. Configure scan roots, alerts, and notifications in the Settings view."
