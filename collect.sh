#!/usr/bin/env bash
# Run as root via cron.
# After the collector finishes, restores database file ownership to the
# service user so the web server can read/write it.
# SQLite WAL mode creates .db-wal and .db-shm alongside the main db file;
# all three must be owned by the service user when the server accesses them.
set -uo pipefail

REPO_DIR="__REPO_DIR__"
DATA_DIR="__DATA_DIR__"
SERVICE_USER="__SERVICE_USER__"

"${DATA_DIR}/venv/bin/python" "${REPO_DIR}/collector.py" "$@"
EXIT_CODE=$?

chown "${SERVICE_USER}:${SERVICE_USER}" \
    "${DATA_DIR}/diskwatch.db" \
    "${DATA_DIR}/diskwatch.db-wal" \
    "${DATA_DIR}/diskwatch.db-shm" 2>/dev/null || true

exit $EXIT_CODE
