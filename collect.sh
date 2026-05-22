#!/usr/bin/env bash
# Run as root via cron.
# After the collector finishes, restores database file ownership to the
# service user so the web server (running as uscloud) can read/write it.
# SQLite WAL mode creates .db-wal and .db-shm alongside the main db file;
# all three must be uscloud-owned when the server accesses them.
set -uo pipefail

INSTALL_DIR="__INSTALL_DIR__"
SERVICE_USER="__SERVICE_USER__"

"${INSTALL_DIR}/venv/bin/python" "${INSTALL_DIR}/collector.py" "$@"
EXIT_CODE=$?

chown "${SERVICE_USER}:${SERVICE_USER}" \
    "${INSTALL_DIR}/diskwatch.db" \
    "${INSTALL_DIR}/diskwatch.db-wal" \
    "${INSTALL_DIR}/diskwatch.db-shm" 2>/dev/null || true

exit $EXIT_CODE
