# DiskWatch — Claude Code Guide

DiskWatch is a self-hosted disk usage monitoring webapp. A privileged collector walks configured filesystem trees on a schedule and stores directory sizes in SQLite. A lightweight FastAPI server exposes a REST API consumed by a single-page frontend.

## Repository layout

```
collector.py          # Data collector — walks filesystems, stores results, detects anomalies
server.py             # FastAPI backend — REST API + serves the SPA
notifications.py      # Email (SMTP) and ntfy push notification helpers
static/
  index.html          # SPA shell
  app.js              # All frontend logic (vanilla JS, Bootstrap 5, Plotly)
  style.css           # Custom styles
config_default.yaml   # Template config shipped with the repo
diskwatch.service     # systemd unit file
install.sh            # Installer — copies source files into app/, creates venv, installs service
collect.sh            # Thin root-owned wrapper around collector.py (used by cron)
requirements.txt      # Python dependencies
app/                  # Runtime directory — created by install.sh, NOT in git
```

The `app/` directory is the live installation. It contains copies of the source files, the Python venv, `config.yaml`, and `diskwatch.db`. It is excluded from git.

## File sync rule — IMPORTANT

`app/` holds copies of the source files. After editing any source file, Claude must immediately copy it to `app/` to keep the running app in sync. Never ask the user to do this manually.

| Source file            | Copy to                     |
|------------------------|-----------------------------|
| `collector.py`         | `app/collector.py`          |
| `server.py`            | `app/server.py`             |
| `notifications.py`     | `app/notifications.py`      |
| `collect.sh`           | `app/collect.sh`            |
| `static/index.html`    | `app/static/index.html`     |
| `static/style.css`     | `app/static/style.css`      |
| `static/app.js`        | `app/static/app.js`         |

`config_default.yaml` is the template; `app/config.yaml` is the live config managed by the user and never overwritten by Claude.

After copying `server.py` or any `static/` file, tell the user to restart the service:

```bash
sudo systemctl restart diskwatch
```

After copying `diskwatch.service`, tell the user to reload systemd first:

```bash
sudo systemctl daemon-reload && sudo systemctl restart diskwatch
```

## sudo constraint

Claude cannot use `sudo` and therefore cannot:

- Run `collector.py` or `collect.sh` (requires root)
- Restart or reload the systemd service (requires root)

After copying changed files to `app/`, always tell the user to restart the service themselves:

```bash
sudo systemctl restart diskwatch
```

If a test collection is needed, tell the user to run it themselves:

```bash
sudo /var/www/diskwatch/app/collect.sh
# or for a dry run:
sudo /var/www/diskwatch/app/venv/bin/python /var/www/diskwatch/app/collector.py --dry-run
# or to scan only specific roots:
sudo /var/www/diskwatch/app/collect.sh --only /
```

## Architecture notes

### collector.py

- Runs as root via cron (see `collect.sh`).
- Reads `app/config.yaml`; writes to `app/diskwatch.db`.
- For each configured scan root it spawns a recursive `os.scandir` walk.
- **Sibling-root exclusion**: any configured root whose path falls inside another configured root is automatically added to that root's exclusion list. No manual config needed — scanning `/` will never recurse into `/mnt/somedrve` if that path is itself a configured root.
- Commits each top-level subdirectory incrementally so a long scan can be interrupted without losing all data.
- Detects growth spikes, new directories, and deleted directories by comparing against the previous scan for the same root.
- Evaluates alert rules (`absolute_growth`, `usage_percent`) and calls `notifications.py` when triggered.

### server.py

- FastAPI app served by uvicorn (see `diskwatch.service`).
- Stateless: reads config and DB on each request; no in-process state except the cached config dict.
- Auth: bcrypt password, cookie-based session token. Password set via UI on first login.
- Key endpoints: `/api/overview`, `/api/partitions`, `/api/tree`, `/api/trend`, `/api/scan-info`, `/api/biggest-growers`, `/api/anomalies`, `/api/alerts`, `/api/scans`, `/api/settings`.
- SPA catchall: all non-API routes return `index.html`.

### Frontend (static/app.js)

- Hash-based router (`#/dashboard`, `#/browse`, `#/anomalies`, `#/alerts`, `#/scans`, `#/settings`).
- Browse view always opens at filesystem root `/` regardless of previous navigation.
- Directory links use `#/browse<path>` (e.g. `#/browse/var/log`).
- Plotly is loaded from CDN for trend charts.

### Database schema (SQLite, WAL mode)

| Table              | Purpose                                          |
|--------------------|--------------------------------------------------|
| `scans`            | One row per completed scan of a root path        |
| `directory_sizes`  | Per-directory size + file count for each scan    |
| `anomalies`        | Growth spikes, new/deleted directories detected  |
| `alerts_log`       | Triggered alert rules with notification status   |

### config.yaml structure

```yaml
auth:          # password_hash (bcrypt), session_secret, session_timeout_hours
scan:
  roots:       # list of {path, label, exclude:[]}
retention:     # keep_days, cleanup_after_scan
email:         # SMTP settings
ntfy:          # ntfy push settings
alerts:
  rules:       # list of {name, path, type, threshold_*, notify:[]}
display:       # default_time_range_days, default_view, theme
```

## Service

The systemd unit (`diskwatch.service`) runs `uvicorn` as a non-root service user. The cron job in `collect.sh` runs as root and restores DB file ownership to the service user after each collection so the server can read/write the database.

## Development workflow

1. Edit source files in the repo root.
2. Copy changed files to `app/` per the table above.
3. Restart the service if server or frontend files changed.
4. Ask the user to run `collect.sh` manually if collector changes need testing.
