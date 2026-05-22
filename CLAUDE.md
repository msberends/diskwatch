# DiskWatch — Claude Code Guide

DiskWatch is a self-hosted disk usage monitoring webapp. A privileged collector walks configured filesystem trees on a schedule and stores directory sizes in SQLite. A lightweight FastAPI server exposes a REST API consumed by a single-page frontend.

## Repository layout

```
collector.py               # Data collector — walks filesystems, stores results, detects anomalies
server.py                  # FastAPI backend — REST API + serves the SPA
notifications.py           # Email (SMTP) and ntfy push notification helpers
static/
  index.html               # SPA shell
  app.js                   # All frontend logic (vanilla JS, Bootstrap 5, Plotly)
  style.css                # Custom styles
config_default.yaml        # Template config shipped with the repo
diskwatch.service.example  # systemd unit template (placeholders substituted at install time)
install.sh                 # Installer — creates instance/, installs venv, generates service
collect.sh                 # Template for the root-owned cron wrapper (placeholders substituted at install time)
requirements.txt           # Python dependencies
instance/                  # Runtime data directory — created by install.sh, NOT in git
  venv/                    #   Python virtualenv
  config.yaml              #   Live config (never overwritten by Claude)
  diskwatch.db             #   SQLite database
  collect.sh               #   Generated cron wrapper with real paths
```

Source files run directly from the repo root — there is no copying. Editing a file here is immediately reflected on the next service restart (or next collector run).

## No file-sync needed

The service's `WorkingDirectory` is the repo root. `server.py`, `collector.py`, `notifications.py`, and `static/` are used in place. After editing any of these, just tell the user to restart the service — no copying required.

`instance/collect.sh` and `/etc/systemd/system/diskwatch.service` are generated once by `install.sh` with real paths substituted. They do not need to be regenerated unless `install.sh` is re-run.

`config_default.yaml` is the template; `instance/config.yaml` is the live config managed by the user and never overwritten by Claude.

## sudo constraint

Claude cannot use `sudo` and therefore cannot:

- Run `collector.py` or `collect.sh` (requires root)
- Restart or reload the systemd service (requires root)

After editing `server.py` or any `static/` file, tell the user to restart the service:

```bash
sudo systemctl restart diskwatch
```

If a test collection is needed, tell the user to run it themselves:

```bash
sudo /var/www/diskwatch/instance/collect.sh
# or for a dry run:
sudo /var/www/diskwatch/instance/venv/bin/python /var/www/diskwatch/collector.py --dry-run
# or to scan only specific roots:
sudo /var/www/diskwatch/instance/collect.sh --only /
```

## Architecture notes

### collector.py

- Runs as root via cron (see `instance/collect.sh`).
- Reads `instance/config.yaml`; writes to `instance/diskwatch.db`.
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

The systemd unit (`diskwatch.service`) runs `uvicorn` as a non-root service user with `WorkingDirectory` set to the repo root. The cron job in `instance/collect.sh` runs as root and restores DB file ownership to the service user after each collection so the server can read/write the database.

## Development workflow

1. Edit source files in the repo root.
2. If `server.py` or any `static/` file changed, tell the user to restart the service.
3. If `collector.py` changed, ask the user to run a manual collection to test.
