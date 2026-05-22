#!/usr/bin/env bash
# DiskWatch installer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/instance"
SERVICE_FILE="diskwatch.service"
SERVICE_EXAMPLE="diskwatch.service.example"

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

# Create instance directory (holds venv, config, and database only)
echo "Creating ${DATA_DIR}..."
mkdir -p "${DATA_DIR}"

# Create Python venv
if [[ ! -d "${DATA_DIR}/venv" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "${DATA_DIR}/venv"
fi

# Install Python dependencies
echo "Installing Python dependencies..."
"${DATA_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${DATA_DIR}/venv/bin/pip" install --quiet -r "${SCRIPT_DIR}/requirements.txt"

# Write default config if none exists
if [[ ! -f "${DATA_DIR}/config.yaml" ]]; then
  echo "Writing default config.yaml..."
  cp "${SCRIPT_DIR}/config_default.yaml" "${DATA_DIR}/config.yaml"
else
  echo "config.yaml already exists, skipping."
fi

# Pre-create the database file owned by the service user.
# The collector runs as root and would otherwise create it as root-owned,
# preventing the web server from reading it.
if [[ ! -f "${DATA_DIR}/diskwatch.db" ]]; then
  echo "Pre-creating database file..."
  touch "${DATA_DIR}/diskwatch.db"
fi

# Generate collect.sh with real paths substituted
sed \
  "s|__REPO_DIR__|${SCRIPT_DIR}|g; s|__DATA_DIR__|${DATA_DIR}|g; s|__SERVICE_USER__|${SERVICE_USER}|g" \
  "${SCRIPT_DIR}/collect.sh" > "${DATA_DIR}/collect.sh"
chmod +x "${DATA_DIR}/collect.sh"

# Set ownership of instance directory
echo "Setting ownership to ${SERVICE_USER}:${SERVICE_USER}..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chmod 750 "${DATA_DIR}"
chmod 640 "${DATA_DIR}/config.yaml" 2>/dev/null || true

# Install systemd service (generated from example with actual paths/user)
echo "Installing systemd service..."
sed \
  "s|__REPO_DIR__|${SCRIPT_DIR}|g; s|__DATA_DIR__|${DATA_DIR}|g; s|__SERVICE_USER__|${SERVICE_USER}|g" \
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
echo "   0 4 * * * ${DATA_DIR}/collect.sh >> /var/log/diskwatch-collector.log 2>&1"
echo ""
echo "3. Run the first collection manually (as root):"
echo "   sudo ${DATA_DIR}/collect.sh"
echo ""
echo "4. Access the UI at: http://localhost:8070"
echo "   (or via your reverse proxy)"
echo "   On first visit, you will be prompted to set the admin password."
echo ""
echo "5. Configure scan roots, alerts, and notifications in the Settings view."
