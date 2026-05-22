"""DiskWatch FastAPI backend."""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any

import bcrypt
import yaml
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from notifications import send_email, send_ntfy

# ---------------------------------------------------------------------------
# Paths (overridable via environment)
# ---------------------------------------------------------------------------

_instance = Path(__file__).parent / "instance"
CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", _instance / "config.yaml"))
DB_PATH = Path(os.environ.get("DB_PATH", _instance / "diskwatch.db"))
STATIC_DIR = Path(__file__).parent / "static"

# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

_config: dict = {}


def load_config() -> dict:
    global _config
    with open(CONFIG_PATH) as f:
        _config = yaml.safe_load(f) or {}
    # Auto-generate session_secret if missing
    if not _config.get("auth", {}).get("session_secret"):
        _config.setdefault("auth", {})["session_secret"] = secrets.token_hex(32)
        save_config(_config)
    return _config


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w") as f:
        yaml.safe_dump(cfg, f, default_flow_style=False, allow_unicode=True)
    global _config
    _config = cfg


def get_config() -> dict:
    return _config


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ---------------------------------------------------------------------------
# Session management — stateless HMAC-signed tokens
# ---------------------------------------------------------------------------
# Token format: "<expiry_unix_hex>.<hmac_sha256_hex>"
# Signed with session_secret from config. Survives service restarts.
# Logout is handled by deleting the cookie; the token itself expires naturally.


def _session_secret(cfg: dict) -> bytes:
    return cfg.get("auth", {}).get("session_secret", "").encode()


def create_session(cfg: dict) -> str:
    timeout_hours = cfg.get("auth", {}).get("session_timeout_hours", 72)
    expiry = int((datetime.now(timezone.utc) + timedelta(hours=timeout_hours)).timestamp())
    expiry_hex = format(expiry, '016x')
    sig = hmac.new(_session_secret(cfg), expiry_hex.encode(), hashlib.sha256).hexdigest()
    return f"{expiry_hex}.{sig}"


def validate_session(token: str) -> bool:
    if not token:
        return False
    try:
        expiry_hex, sig = token.split('.', 1)
    except ValueError:
        return False
    cfg = get_config()
    expected = hmac.new(_session_secret(cfg), expiry_hex.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    return datetime.now(timezone.utc).timestamp() < int(expiry_hex, 16)


def delete_session(token: str):
    pass  # cookie deletion handles logout


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="DiskWatch")


def _ensure_schema(conn: sqlite3.Connection):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS scans (
            scan_id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            root_path TEXT NOT NULL,
            duration_seconds REAL,
            directories_counted INTEGER,
            total_size_bytes INTEGER,
            errors INTEGER DEFAULT 0,
            metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_scans_timestamp ON scans(timestamp);
        CREATE INDEX IF NOT EXISTS idx_scans_root ON scans(root_path);

        CREATE TABLE IF NOT EXISTS directory_sizes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER NOT NULL REFERENCES scans(scan_id),
            path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            file_count INTEGER NOT NULL,
            UNIQUE(scan_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_dirsizes_path ON directory_sizes(path);
        CREATE INDEX IF NOT EXISTS idx_dirsizes_scan ON directory_sizes(scan_id);
        CREATE INDEX IF NOT EXISTS idx_dirsizes_scan_path ON directory_sizes(scan_id, path);

        CREATE TABLE IF NOT EXISTS anomalies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER NOT NULL REFERENCES scans(scan_id),
            timestamp TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT NOT NULL,
            details TEXT,
            acknowledged INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_anomalies_scan ON anomalies(scan_id);
        CREATE INDEX IF NOT EXISTS idx_anomalies_type ON anomalies(type);

        CREATE TABLE IF NOT EXISTS alerts_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            path TEXT NOT NULL,
            message TEXT NOT NULL,
            notification_sent INTEGER DEFAULT 0,
            notification_channels TEXT,
            acknowledged INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts_log(timestamp);
    """)
    conn.commit()


@app.on_event("startup")
def startup():
    if not CONFIG_PATH.exists():
        default = Path(__file__).parent / "config_default.yaml"
        if default.exists():
            import shutil
            shutil.copy(default, CONFIG_PATH)
        else:
            CONFIG_PATH.write_text("")
    load_config()
    conn = get_db()
    _ensure_schema(conn)
    conn.close()


# ---------------------------------------------------------------------------
# Auth middleware helper
# ---------------------------------------------------------------------------

def require_auth(token: str | None) -> None:
    if not token or not validate_session(token):
        raise HTTPException(status_code=401, detail="Not authenticated")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return {"status": "ok", "db_size_bytes": size}


@app.get("/api/auth/status")
def auth_status(diskwatch_session: str | None = Cookie(default=None)):
    cfg = get_config()
    has_password = bool(cfg.get("auth", {}).get("password_hash"))
    return {
        "authenticated": validate_session(diskwatch_session),
        "needs_setup": not has_password,
    }


@app.post("/api/login")
async def login(request: Request, response: Response):
    body = await request.json()
    password = body.get("password", "")
    cfg = get_config()
    stored_hash = cfg.get("auth", {}).get("password_hash", "")

    if not stored_hash:
        raise HTTPException(status_code=400, detail="No password set. Use setup endpoint.")

    if not bcrypt.checkpw(password.encode(), stored_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid password")

    token = create_session(cfg)
    response.set_cookie(
        "diskwatch_session",
        token,
        httponly=True,
        samesite="strict",
        max_age=int(cfg.get("auth", {}).get("session_timeout_hours", 72)) * 3600,
    )
    return {"status": "ok"}


@app.post("/api/setup")
async def setup(request: Request, response: Response):
    body = await request.json()
    password = body.get("password", "")
    cfg = get_config()

    if cfg.get("auth", {}).get("password_hash"):
        raise HTTPException(status_code=400, detail="Password already set. Use change-password.")

    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    cfg.setdefault("auth", {})["password_hash"] = hashed
    save_config(cfg)

    token = create_session(cfg)
    response.set_cookie(
        "diskwatch_session",
        token,
        httponly=True,
        samesite="strict",
        max_age=int(cfg.get("auth", {}).get("session_timeout_hours", 72)) * 3600,
    )
    return {"status": "ok"}


@app.post("/api/logout")
def logout(response: Response, diskwatch_session: str | None = Cookie(default=None)):
    if diskwatch_session:
        delete_session(diskwatch_session)
    response.delete_cookie("diskwatch_session")
    return {"status": "ok"}


@app.post("/api/auth/change-password")
async def change_password(request: Request,
                          diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    body = await request.json()
    current = body.get("current_password", "")
    new_pw = body.get("new_password", "")
    cfg = get_config()
    stored_hash = cfg.get("auth", {}).get("password_hash", "")

    if not bcrypt.checkpw(current.encode(), stored_hash.encode()):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(new_pw) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")

    hashed = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    cfg["auth"]["password_hash"] = hashed
    save_config(cfg)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def _child_patterns(parent_path: str) -> tuple[str, str]:
    """Return (LIKE pattern, anti-pattern) matching only immediate children."""
    p = parent_path.rstrip("/")
    prefix = p + "/" if p else "/"
    return (prefix + "%", prefix + "%/%")


# ---------------------------------------------------------------------------
# Dashboard & overview
# ---------------------------------------------------------------------------

@app.get("/api/overview")
def overview(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    roots = cfg.get("scan", {}).get("roots", [])
    conn = get_db()
    result = []

    for root_cfg in roots:
        root_path = os.path.normpath(root_cfg["path"])
        label = root_cfg.get("label", root_path)

        latest_scan = conn.execute(
            "SELECT * FROM scans WHERE root_path=? ORDER BY timestamp DESC LIMIT 1",
            (root_path,)
        ).fetchone()
        if not latest_scan:
            result.append({"root_path": root_path, "label": label,
                           "latest_scan": None, "directories": []})
            continue

        scan_id = latest_scan["scan_id"]
        cutoff_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        prev_scan = conn.execute(
            """SELECT scan_id FROM scans
               WHERE root_path=? AND timestamp <= ? AND scan_id != ?
               ORDER BY timestamp DESC LIMIT 1""",
            (root_path, cutoff_7d, scan_id)
        ).fetchone()

        pattern, anti = _child_patterns(root_path)

        if prev_scan:
            dirs = conn.execute(
                """SELECT curr.path, curr.size_bytes, curr.file_count,
                          prev.size_bytes AS prev_size_bytes
                   FROM directory_sizes curr
                   LEFT JOIN directory_sizes prev
                     ON prev.scan_id = ? AND prev.path = curr.path
                   WHERE curr.scan_id = ?
                     AND curr.path LIKE ? AND curr.path NOT LIKE ?
                   ORDER BY curr.size_bytes DESC""",
                (prev_scan["scan_id"], scan_id, pattern, anti)
            ).fetchall()
        else:
            dirs = conn.execute(
                """SELECT path, size_bytes, file_count, NULL AS prev_size_bytes
                   FROM directory_sizes
                   WHERE scan_id = ?
                     AND path LIKE ? AND path NOT LIKE ?
                   ORDER BY size_bytes DESC""",
                (scan_id, pattern, anti)
            ).fetchall()

        top_dirs = [{
            "path": d["path"],
            "size_bytes": d["size_bytes"],
            "file_count": d["file_count"],
            "change_7d": None if d["prev_size_bytes"] is None
                         else d["size_bytes"] - d["prev_size_bytes"],
        } for d in dirs]

        result.append({
            "root_path": root_path,
            "label": label,
            "latest_scan": latest_scan["timestamp"],
            "directories": top_dirs,
        })

    conn.close()
    return result


@app.get("/api/partitions")
def partitions(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    roots = cfg.get("scan", {}).get("roots", [])
    conn = get_db()
    result = []

    for root_cfg in roots:
        root_path = os.path.normpath(root_cfg["path"])
        label = root_cfg.get("label", root_path)
        latest = conn.execute(
            "SELECT metadata FROM scans WHERE root_path=? ORDER BY timestamp DESC LIMIT 1",
            (root_path,)
        ).fetchone()
        meta = {}
        if latest and latest["metadata"]:
            try:
                meta = json.loads(latest["metadata"])
            except (json.JSONDecodeError, TypeError):
                pass
        total = meta.get("partition_total", 0)
        used = meta.get("partition_used", 0)
        # macOS convention: available = total − used (ignores root-reserved blocks)
        free = total - used if total > 0 else 0
        pct = round(used / total * 100, 1) if total > 0 else 0
        result.append({
            "root_path": root_path,
            "label": label,
            "type": root_cfg.get("type", ""),
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
            "used_percent": pct,
        })

    conn.close()
    return result


@app.get("/api/scan-info")
def scan_info(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    roots = cfg.get("scan", {}).get("roots", [])
    conn = get_db()
    result = []

    for root_cfg in roots:
        root_path = os.path.normpath(root_cfg["path"])
        row = conn.execute(
            """SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest,
                      COUNT(*) as total_scans
               FROM scans WHERE root_path=?""",
            (root_path,)
        ).fetchone()
        latest_size = conn.execute(
            """SELECT total_size_bytes FROM scans
               WHERE root_path=? ORDER BY timestamp DESC LIMIT 1""",
            (root_path,)
        ).fetchone()
        result.append({
            "root_path": root_path,
            "label": root_cfg.get("label", root_path),
            "earliest_scan": row["earliest"] if row else None,
            "latest_scan": row["latest"] if row else None,
            "total_scans": row["total_scans"] if row else 0,
            "total_size_bytes": latest_size["total_size_bytes"] if latest_size else 0,
        })

    conn.close()
    return result


# ---------------------------------------------------------------------------
# Directory browsing
# ---------------------------------------------------------------------------

@app.get("/api/tree")
def tree(path: str, diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    norm = os.path.normpath(path)
    conn = get_db()

    # Find the root this path belongs to
    cfg = get_config()
    root_paths = [os.path.normpath(r["path"]) for r in cfg.get("scan", {}).get("roots", [])]
    root_path = None
    for rp in sorted(root_paths, key=len, reverse=True):
        if norm.startswith(rp):
            root_path = rp
            break

    if root_path is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Path not under a known scan root")

    latest = conn.execute(
        "SELECT scan_id FROM scans WHERE root_path=? ORDER BY timestamp DESC LIMIT 1",
        (root_path,)
    ).fetchone()
    if not latest:
        conn.close()
        return []

    scan_id = latest["scan_id"]
    cutoff_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    prev = conn.execute(
        """SELECT scan_id FROM scans
           WHERE root_path=? AND timestamp <= ?
           ORDER BY timestamp DESC LIMIT 1""",
        (root_path, cutoff_7d)
    ).fetchone()

    pattern, anti = _child_patterns(norm)

    if prev:
        rows = conn.execute(
            """SELECT curr.path, curr.size_bytes, curr.file_count,
                      prev.size_bytes AS prev_size_bytes
               FROM directory_sizes curr
               LEFT JOIN directory_sizes prev
                 ON prev.scan_id = ? AND prev.path = curr.path
               WHERE curr.scan_id = ?
                 AND curr.path LIKE ? AND curr.path NOT LIKE ?
               ORDER BY curr.size_bytes DESC""",
            (prev["scan_id"], scan_id, pattern, anti)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT path, size_bytes, file_count, NULL AS prev_size_bytes
               FROM directory_sizes
               WHERE scan_id = ?
                 AND path LIKE ? AND path NOT LIKE ?
               ORDER BY size_bytes DESC""",
            (scan_id, pattern, anti)
        ).fetchall()

    children = [{
        "path": r["path"],
        "name": os.path.basename(r["path"]),
        "size_bytes": r["size_bytes"],
        "file_count": r["file_count"],
        "change_7d": None if r["prev_size_bytes"] is None
                     else r["size_bytes"] - r["prev_size_bytes"],
    } for r in rows]

    conn.close()
    return children


@app.get("/api/suggest")
def suggest(path: str = "/", diskwatch_session: str | None = Cookie(default=None)):
    """Return up to 15 immediate child directory paths matching the typed prefix."""
    require_auth(diskwatch_session)

    if not path or path == "/":
        parent = "/"
        partial = ""
    elif path.endswith("/"):
        parent = os.path.normpath(path)
        partial = ""
    else:
        norm = os.path.normpath(path)
        parent = os.path.dirname(norm)
        partial = os.path.basename(norm)

    cfg = get_config()
    root_paths = [os.path.normpath(r["path"]) for r in cfg.get("scan", {}).get("roots", [])]
    if not root_paths:
        return []

    conn = get_db()
    results: set[str] = set()

    for rp in root_paths:
        covers = (parent == rp
                  or (rp != "/" and parent.startswith(rp + "/"))
                  or rp == "/")
        if not covers:
            continue
        latest = conn.execute(
            "SELECT scan_id FROM scans WHERE root_path=? ORDER BY timestamp DESC LIMIT 1",
            (rp,)
        ).fetchone()
        if not latest:
            continue
        pattern, anti = _child_patterns(parent)
        rows = conn.execute(
            """SELECT path FROM directory_sizes
               WHERE scan_id = ? AND path LIKE ? AND path NOT LIKE ?
               ORDER BY path LIMIT 50""",
            (latest["scan_id"], pattern, anti)
        ).fetchall()
        for r in rows:
            name = os.path.basename(r["path"])
            if not partial or name.lower().startswith(partial.lower()):
                results.add(r["path"])

    # Fallback: no DB match — suggest configured roots whose path starts with what was typed
    if not results:
        typed_norm = os.path.normpath(path) if path else "/"
        for rp in root_paths:
            if rp.startswith(typed_norm):
                results.add(rp)

    conn.close()
    return sorted(results)[:15]


@app.get("/api/trend")
def trend(path: str, days: int = None,
          diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    if days is None:
        days = cfg.get("display", {}).get("default_time_range_days", 90)

    norm = os.path.normpath(path)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    conn = get_db()
    rows = conn.execute(
        """SELECT s.timestamp, ds.size_bytes, ds.file_count
           FROM directory_sizes ds
           JOIN scans s ON s.scan_id = ds.scan_id
           WHERE ds.path = ? AND s.timestamp >= ?
           ORDER BY s.timestamp ASC""",
        (norm, cutoff)
    ).fetchall()
    conn.close()
    return [{"date": r["timestamp"], "size_bytes": r["size_bytes"],
             "file_count": r["file_count"]} for r in rows]


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

@app.get("/api/biggest-growers")
def biggest_growers(days: int = 7, limit: int = 20,
                    diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()

    cfg = get_config()
    roots = [os.path.normpath(r["path"]) for r in cfg.get("scan", {}).get("roots", [])]

    results = []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    for root_path in roots:
        latest = conn.execute(
            "SELECT scan_id FROM scans WHERE root_path=? ORDER BY timestamp DESC LIMIT 1",
            (root_path,)
        ).fetchone()
        earliest_in_period = conn.execute(
            """SELECT scan_id FROM scans
               WHERE root_path=? AND timestamp >= ?
               ORDER BY timestamp ASC LIMIT 1""",
            (root_path, cutoff)
        ).fetchone()

        if not latest or not earliest_in_period:
            continue
        if latest["scan_id"] == earliest_in_period["scan_id"]:
            continue

        rows = conn.execute(
            """SELECT curr.path,
                      curr.size_bytes AS current_size_bytes,
                      prev.size_bytes AS previous_size_bytes,
                      (curr.size_bytes - prev.size_bytes) AS growth_bytes
               FROM directory_sizes curr
               JOIN directory_sizes prev
                 ON prev.scan_id = ? AND prev.path = curr.path
               WHERE curr.scan_id = ?
                 AND curr.size_bytes > prev.size_bytes""",
            (earliest_in_period["scan_id"], latest["scan_id"])
        ).fetchall()

        for r in rows:
            results.append({
                "path": r["path"],
                "root_path": root_path,
                "growth_bytes": r["growth_bytes"],
                "current_size_bytes": r["current_size_bytes"],
                "previous_size_bytes": r["previous_size_bytes"],
            })

    results.sort(key=lambda x: x["growth_bytes"], reverse=True)
    conn.close()
    return results[:limit]


@app.get("/api/anomalies")
def get_anomalies(acknowledged: bool = None, limit: int = 50,
                  diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()
    query = "SELECT * FROM anomalies"
    params: list = []
    if acknowledged is not None:
        query += " WHERE acknowledged=?"
        params.append(1 if acknowledged else 0)
    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/anomalies/{anomaly_id}/acknowledge")
def acknowledge_anomaly(anomaly_id: int,
                        diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()
    conn.execute("UPDATE anomalies SET acknowledged=1 WHERE id=?", (anomaly_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/api/alerts")
def get_alerts(acknowledged: bool = None, limit: int = 50,
               diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()
    query = "SELECT * FROM alerts_log"
    params: list = []
    if acknowledged is not None:
        query += " WHERE acknowledged=?"
        params.append(1 if acknowledged else 0)
    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int,
                      diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()
    conn.execute("UPDATE alerts_log SET acknowledged=1 WHERE id=?", (alert_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Scan history
# ---------------------------------------------------------------------------

@app.get("/api/scans")
def list_scans(limit: int = 50, offset: int = 0,
               diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    conn = get_db()
    rows = conn.execute(
        """SELECT scan_id, timestamp, root_path, duration_seconds,
                  directories_counted, total_size_bytes, errors, metadata
           FROM scans ORDER BY timestamp DESC LIMIT ? OFFSET ?""",
        (limit, offset)
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0]
    conn.close()

    cfg = get_config()
    label_map = {
        os.path.normpath(r["path"]): r.get("label", r["path"])
        for r in cfg.get("scan", {}).get("roots", [])
    }

    result = []
    for r in rows:
        d = dict(r)
        d["label"] = label_map.get(d["root_path"], d["root_path"])
        result.append(d)
    return {"scans": result, "total": total}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

_SENSITIVE_KEYS = {"password_hash", "session_secret"}


def _strip_sensitive(cfg: dict) -> dict:
    out = {}
    for k, v in cfg.items():
        if k in _SENSITIVE_KEYS:
            continue
        if isinstance(v, dict):
            out[k] = _strip_sensitive(v)
        else:
            out[k] = v
    return out


def _validate_settings(data: dict) -> list[str]:
    errors = []
    email = data.get("email", {})
    if email.get("smtp_port") is not None:
        try:
            p = int(email["smtp_port"])
            if not (1 <= p <= 65535):
                errors.append("smtp_port must be between 1 and 65535")
        except (ValueError, TypeError):
            errors.append("smtp_port must be a number")

    import re
    email_re = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    from_addr = email.get("from_address", "")
    if from_addr and not email_re.match(from_addr):
        errors.append(f"from_address is not a valid email: {from_addr}")
    for addr in email.get("to_addresses", []):
        if not email_re.match(addr):
            errors.append(f"to_addresses contains invalid email: {addr}")

    for rule in data.get("alerts", {}).get("rules", []):
        if rule.get("type") == "absolute_growth":
            tb = rule.get("threshold_bytes", 0)
            try:
                if int(tb) <= 0:
                    errors.append(f"Alert rule '{rule.get('name')}': threshold_bytes must be > 0")
            except (ValueError, TypeError):
                errors.append(f"Alert rule '{rule.get('name')}': threshold_bytes must be a number")
        if rule.get("type") == "usage_percent":
            tp = rule.get("threshold_percent", 0)
            try:
                if not (0 < float(tp) <= 100):
                    errors.append(f"Alert rule '{rule.get('name')}': threshold_percent must be 0-100")
            except (ValueError, TypeError):
                errors.append(f"Alert rule '{rule.get('name')}': threshold_percent must be a number")

    return errors


@app.get("/api/settings")
def get_settings(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    return _strip_sensitive(get_config())


@app.put("/api/settings")
async def put_settings(request: Request,
                       diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    data = await request.json()

    errors = _validate_settings(data)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    current = get_config()
    # Preserve sensitive fields
    data.setdefault("auth", {})
    data["auth"]["password_hash"] = current.get("auth", {}).get("password_hash", "")
    data["auth"]["session_secret"] = current.get("auth", {}).get("session_secret", "")

    save_config(data)
    return {"status": "ok"}


@app.post("/api/settings/test-email")
def test_email(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    ok, err = send_email(cfg, "DiskWatch test email",
                         "This is a test notification from DiskWatch.")
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"status": "ok"}


@app.post("/api/settings/test-ntfy")
def test_ntfy(diskwatch_session: str | None = Cookie(default=None)):
    require_auth(diskwatch_session)
    cfg = get_config()
    ok, err = send_ntfy(cfg, "DiskWatch test", "This is a test notification from DiskWatch.")
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Static files & SPA catch-all
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/{full_path:path}")
def spa_catchall(full_path: str):
    # Serve index.html for all non-API, non-static routes
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    raise HTTPException(status_code=404, detail="Not found")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8070, reload=False)
