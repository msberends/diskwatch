#!/usr/bin/env python3
"""DiskWatch data collector. Run as root via cron."""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from notifications import send_notification

DEFAULT_CONFIG = str(Path(__file__).parent / "instance" / "config.yaml")
DEFAULT_DB = str(Path(__file__).parent / "instance" / "diskwatch.db")

GROWTH_SPIKE_MIN_BYTES = 100 * 1024 * 1024   # 100 MB
GROWTH_SPIKE_MIN_RATIO = 0.20                 # 20%


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_schema(conn: sqlite3.Connection):
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
        CREATE INDEX IF NOT EXISTS idx_dirsizes_path_scan ON directory_sizes(path, scan_id DESC);

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

        CREATE TABLE IF NOT EXISTS directory_current (
            path TEXT PRIMARY KEY,
            root_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            file_count INTEGER NOT NULL,
            last_changed_scan_id INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dircurrent_root ON directory_current(root_path);
    """)
    conn.commit()
    # Add is_tombstone column to directory_sizes — migration for existing databases
    try:
        conn.execute(
            "ALTER TABLE directory_sizes ADD COLUMN is_tombstone INTEGER NOT NULL DEFAULT 0"
        )
        conn.commit()
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
    # Remove non-growth-spike anomaly types — no longer tracked
    conn.execute("DELETE FROM anomalies WHERE type NOT IN ('growth_spike')")
    conn.commit()


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

def scan_directory(root_path: str, excludes: list, dry_run: bool) -> dict:
    """
    Walk root_path recursively using os.scandir().
    Returns dict mapping path -> {"size_bytes": int, "file_count": int}.
    """
    excluded = set(os.path.normpath(e) for e in excludes)
    sizes = {}

    def _walk(path: str):
        dir_size = 0
        dir_files = 0
        try:
            with os.scandir(path) as it:
                entries = list(it)
        except PermissionError as e:
            return 0, 0, [str(e)]
        except OSError as e:
            return 0, 0, [str(e)]

        errors = []
        for entry in entries:
            entry_path = os.path.normpath(entry.path)
            if entry_path in excluded:
                continue
            try:
                if entry.is_symlink():
                    continue
                if entry.is_file(follow_symlinks=False):
                    try:
                        dir_size += entry.stat(follow_symlinks=False).st_size
                        dir_files += 1
                    except OSError:
                        pass
                elif entry.is_dir(follow_symlinks=False):
                    sub_size, sub_files, sub_errors = _walk(entry_path)
                    dir_size += sub_size
                    dir_files += sub_files
                    errors.extend(sub_errors)
                    sizes[entry_path] = {"size_bytes": sub_size, "file_count": sub_files}
            except OSError as e:
                errors.append(str(e))

        return dir_size, dir_files, errors

    norm_root = os.path.normpath(root_path)
    total_size, total_files, all_errors = _walk(norm_root)
    sizes[norm_root] = {"size_bytes": total_size, "file_count": total_files}
    return sizes, all_errors


# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------

def detect_anomalies(conn: sqlite3.Connection, scan_id: int, root_path: str,
                     current: dict, prev_state: dict, timestamp: str,
                     config: dict, dry_run: bool):
    """Compare current scan sizes to the pre-scan snapshot, insert anomalies."""
    if not prev_state:
        return  # no previous data for this root

    spike_cfg = config.get("anomalies", {}).get("growth_spike", {})
    min_bytes = int(spike_cfg.get("min_bytes", GROWTH_SPIKE_MIN_BYTES))
    min_ratio = float(spike_cfg.get("min_ratio", GROWTH_SPIKE_MIN_RATIO))
    notify_channels = spike_cfg.get("notify", [])

    prev = {p: d["size_bytes"] for p, d in prev_state.items()}

    curr_paths = set(current.keys())
    prev_paths = set(prev.keys())

    anomalies = []
    spike_msgs = []

    # growth spikes
    for path in curr_paths & prev_paths:
        curr_size = current[path]["size_bytes"]
        prev_size = prev[path]
        if prev_size > 0:
            growth = curr_size - prev_size
            ratio = growth / prev_size
            if growth >= min_bytes and ratio >= min_ratio:
                pct = round(ratio * 100, 1)
                anomalies.append((scan_id, timestamp, path, "growth_spike", json.dumps({
                    "previous_size": prev_size,
                    "current_size": curr_size,
                    "growth_bytes": growth,
                    "growth_percent": pct,
                })))
                spike_msgs.append(
                    f"{path}: {_fmt_bytes(prev_size)} → {_fmt_bytes(curr_size)} (+{pct}%)"
                )

    if not dry_run and anomalies:
        conn.executemany(
            "INSERT INTO anomalies (scan_id, timestamp, path, type, details) VALUES (?,?,?,?,?)",
            anomalies
        )
        conn.commit()
        print(f"  Detected {len(anomalies)} growth spike(s).")

    if not dry_run and spike_msgs and notify_channels:
        msg = "Growth spike(s) detected:\n" + "\n".join(spike_msgs)
        results = send_notification(config, notify_channels, "DiskWatch: Growth Spike", msg)
        for ch, (ok, err) in results.items():
            print(f"  Notification [{ch}]: {'sent' if ok else 'failed: ' + err}")


# ---------------------------------------------------------------------------
# Alert evaluation
# ---------------------------------------------------------------------------

def evaluate_alerts(conn: sqlite3.Connection, config: dict, scan_id: int,
                    root_path: str, current: dict, metadata: dict,
                    timestamp: str, dry_run: bool):
    """Evaluate alert rules and insert into alerts_log if triggered."""
    rules = config.get("alerts", {}).get("rules", [])
    if not rules:
        return

    triggered = []
    for rule in rules:
        path = os.path.normpath(rule.get("path", "") or "/")
        rule_type = rule.get("type", "")
        notify = rule.get("notify", [])
        name = rule.get("name", "unnamed")

        if rule_type == "absolute_growth":
            threshold = rule.get("threshold_bytes", 0)
            period_days = rule.get("period_days", 7)
            cutoff = (datetime.now(timezone.utc) - timedelta(days=period_days)).isoformat()
            row = conn.execute(
                """SELECT ds.size_bytes FROM directory_sizes ds
                   JOIN scans s ON s.scan_id = ds.scan_id
                   WHERE ds.path = ? AND s.root_path = ? AND s.timestamp >= ?
                   ORDER BY s.timestamp ASC LIMIT 1""",
                (path, root_path, cutoff)
            ).fetchone()
            if row and path in current:
                growth = current[path]["size_bytes"] - row["size_bytes"]
                if growth >= threshold:
                    msg = (f"Alert '{name}': {path} grew by "
                           f"{_fmt_bytes(growth)} over {period_days} days "
                           f"(threshold {_fmt_bytes(threshold)})")
                    triggered.append((name, path, msg, notify))

        elif rule_type == "usage_percent":
            threshold_pct = rule.get("threshold_percent", 90)
            # Use partition metadata if path matches root
            norm_path = os.path.normpath(path)
            norm_root = os.path.normpath(root_path)
            if norm_path == norm_root:
                total = metadata.get("partition_total", 0)
                used = metadata.get("partition_used", 0)
                if total > 0:
                    pct = used / total * 100
                    if pct >= threshold_pct:
                        msg = (f"Alert '{name}': {path} disk usage is "
                               f"{pct:.1f}% (threshold {threshold_pct}%)")
                        triggered.append((name, path, msg, notify))

    for name, path, msg, notify in triggered:
        print(f"  ALERT: {msg}")
        if dry_run:
            continue
        conn.execute(
            """INSERT INTO alerts_log
               (timestamp, rule_name, path, message, notification_sent, notification_channels)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (timestamp, name, path, msg, 0, json.dumps(notify))
        )
        conn.commit()

        if notify:
            results = send_notification(config, notify, "DiskWatch Alert", msg)
            sent = any(ok for ok, _ in results.values())
            conn.execute(
                "UPDATE alerts_log SET notification_sent=? WHERE rowid=last_insert_rowid()",
                (1 if sent else 0,)
            )
            conn.commit()
            for ch, (ok, err) in results.items():
                status = "sent" if ok else f"failed: {err}"
                print(f"    Notification [{ch}]: {status}")


# ---------------------------------------------------------------------------
# Retention cleanup
# ---------------------------------------------------------------------------

def cleanup_old_data(conn: sqlite3.Connection, keep_days: int):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_days)).isoformat()
    old_scans = conn.execute(
        "SELECT scan_id FROM scans WHERE timestamp < ?", (cutoff,)
    ).fetchall()
    if not old_scans:
        return
    ids = [r["scan_id"] for r in old_scans]
    placeholders = ",".join("?" * len(ids))
    conn.execute(f"DELETE FROM directory_sizes WHERE scan_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM anomalies WHERE scan_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM scans WHERE scan_id IN ({placeholders})", ids)
    conn.commit()
    print(f"Retention cleanup: removed {len(ids)} old scan(s) (older than {keep_days} days).")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def _fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    return f"{m}m {s}s"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="DiskWatch data collector")
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--dry-run", action="store_true",
                        help="Log what would be scanned without writing to DB")
    parser.add_argument("--only", metavar="PATH", nargs="+",
                        help="Scan only these root path(s) from the config, e.g. --only /")
    args = parser.parse_args()

    if os.geteuid() != 0:
        print("ERROR: collector.py must be run as root.", file=sys.stderr)
        sys.exit(1)

    with open(args.config) as f:
        config = yaml.safe_load(f)

    if args.dry_run:
        print("DRY RUN — no data will be written to the database.")

    conn = get_db(args.db)
    ensure_schema(conn)

    all_roots = config.get("scan", {}).get("roots", [])
    # Build from the full config so sibling exclusion works even with --only
    all_root_norms = [os.path.normpath(r.get("path", "")) for r in all_roots]

    roots = all_roots
    if args.only:
        only_norms = {os.path.normpath(p) for p in args.only}
        roots = [r for r in roots if os.path.normpath(r.get("path", "")) in only_norms]
        if not roots:
            print(f"ERROR: none of {args.only} match a configured scan root.", file=sys.stderr)
            sys.exit(1)

    overall_start = time.monotonic()
    total_dirs = 0
    total_size = 0

    for root_cfg in roots:
        root_path = root_cfg.get("path", "")
        label = root_cfg.get("label", root_path)
        excludes = root_cfg.get("exclude", [])

        norm_root = os.path.normpath(root_path)

        # Automatically exclude other scan roots that live inside this one
        norm_root_prefix = norm_root.rstrip(os.sep) + os.sep
        sibling_roots = [p for p in all_root_norms
                         if p != norm_root and p.startswith(norm_root_prefix)]
        effective_excludes = excludes + sibling_roots

        print(f"\n=== Scanning root: {label} ({root_path}) ===")
        if args.dry_run:
            print(f"  Excludes: {effective_excludes}")
            print("  [dry-run] Would walk filesystem here.")
            continue
        timestamp = datetime.now(timezone.utc).isoformat()
        scan_start = time.monotonic()

        # Create scans row immediately so we have a scan_id
        cur = conn.execute(
            "INSERT INTO scans (timestamp, root_path, errors, metadata) VALUES (?,?,0,NULL)",
            (timestamp, norm_root)
        )
        conn.commit()
        scan_id = cur.lastrowid

        # Partition usage
        try:
            usage = shutil.disk_usage(root_path)
            metadata = {
                "partition_total": usage.total,
                "partition_used": usage.used,
                "partition_free": usage.free,
                "errors": [],
            }
        except OSError as e:
            metadata = {"partition_total": 0, "partition_used": 0,
                        "partition_free": 0, "errors": [str(e)]}

        # Load current snapshot before scanning — this is the effective previous state
        prev_state = {
            r["path"]: {"size_bytes": r["size_bytes"], "file_count": r["file_count"]}
            for r in conn.execute(
                "SELECT path, size_bytes, file_count FROM directory_current WHERE root_path=?",
                (norm_root,)
            )
        }

        # Walk filesystem, committing per top-level directory
        all_sizes = {}
        all_errors = list(metadata.get("errors", []))
        dir_count = 0

        try:
            with os.scandir(root_path) as it:
                top_level_entries = [e for e in it
                                     if e.is_dir(follow_symlinks=False) and not e.is_symlink()
                                     and os.path.normpath(e.path) not in
                                     set(os.path.normpath(x) for x in effective_excludes)]
        except OSError as e:
            top_level_entries = []
            all_errors.append(str(e))

        root_total_size = 0
        root_total_files = 0

        for entry in top_level_entries:
            tl_start = time.monotonic()
            tl_path = os.path.normpath(entry.path)
            tl_sizes, tl_errors = scan_directory(tl_path, effective_excludes, args.dry_run)
            all_errors.extend(tl_errors)
            all_sizes.update(tl_sizes)

            tl_size = tl_sizes.get(tl_path, {}).get("size_bytes", 0)
            tl_files = tl_sizes.get(tl_path, {}).get("file_count", 0)
            root_total_size += tl_size
            root_total_files += tl_files
            tl_elapsed = time.monotonic() - tl_start

            print(f"  {tl_path}: {_fmt_bytes(tl_size)}, "
                  f"{tl_files:,} files, {_fmt_duration(tl_elapsed)}")

            # Delta insert: only store rows that changed or are new
            changed_rows = [
                (scan_id, p, d["size_bytes"], d["file_count"], 0)
                for p, d in tl_sizes.items()
                if p not in prev_state
                or prev_state[p]["size_bytes"] != d["size_bytes"]
                or prev_state[p]["file_count"] != d["file_count"]
            ]
            if changed_rows:
                conn.executemany(
                    "INSERT OR IGNORE INTO directory_sizes "
                    "(scan_id, path, size_bytes, file_count, is_tombstone) VALUES (?,?,?,?,?)",
                    changed_rows
                )
            conn.commit()
            dir_count += len(tl_sizes)

        # Also record root itself
        # Count files directly in root (not in subdirs)
        root_direct_size = 0
        root_direct_files = 0
        try:
            with os.scandir(root_path) as it:
                for entry in it:
                    if entry.is_file(follow_symlinks=False):
                        try:
                            root_direct_size += entry.stat(follow_symlinks=False).st_size
                            root_direct_files += 1
                        except OSError:
                            pass
        except OSError:
            pass

        root_total_size += root_direct_size
        root_total_files += root_direct_files
        all_sizes[norm_root] = {"size_bytes": root_total_size, "file_count": root_total_files}
        prev_root = prev_state.get(norm_root)
        if (prev_root is None
                or prev_root["size_bytes"] != root_total_size
                or prev_root["file_count"] != root_total_files):
            conn.execute(
                "INSERT OR IGNORE INTO directory_sizes "
                "(scan_id, path, size_bytes, file_count, is_tombstone) VALUES (?,?,?,?,0)",
                (scan_id, norm_root, root_total_size, root_total_files)
            )
        dir_count += 1

        # Tombstones for paths that existed previously but are gone now
        deleted_paths = set(prev_state.keys()) - set(all_sizes.keys())
        if deleted_paths:
            conn.executemany(
                "INSERT OR IGNORE INTO directory_sizes "
                "(scan_id, path, size_bytes, file_count, is_tombstone) VALUES (?,?,0,0,1)",
                [(scan_id, p) for p in deleted_paths]
            )

        conn.commit()

        scan_elapsed = time.monotonic() - scan_start
        metadata["errors"] = all_errors

        conn.execute(
            """UPDATE scans SET duration_seconds=?, directories_counted=?,
               total_size_bytes=?, errors=?, metadata=? WHERE scan_id=?""",
            (scan_elapsed, dir_count, root_total_size,
             len(all_errors), json.dumps(metadata), scan_id)
        )
        conn.commit()

        total_dirs += dir_count
        total_size += root_total_size

        delta_count = conn.execute(
            "SELECT COUNT(*) FROM directory_sizes WHERE scan_id=? AND is_tombstone=0",
            (scan_id,)
        ).fetchone()[0]
        print(f"  Total: {_fmt_bytes(root_total_size)}, {dir_count:,} directories, "
              f"{delta_count:,} changed, {len(all_errors)} error(s), {_fmt_duration(scan_elapsed)}")

        # Anomaly detection uses the pre-scan snapshot (prev_state)
        detect_anomalies(conn, scan_id, norm_root, all_sizes, prev_state,
                         timestamp, config, args.dry_run)

        # Alert evaluation
        evaluate_alerts(conn, config, scan_id, norm_root, all_sizes,
                        metadata, timestamp, args.dry_run)

        # Update directory_current — only for new or changed paths.
        # Unchanged paths already have correct data; writing them anyway would
        # defeat the purpose of delta storage.
        changed_in_current = [
            (p, norm_root, d["size_bytes"], d["file_count"], scan_id)
            for p, d in all_sizes.items()
            if p not in prev_state
            or prev_state[p]["size_bytes"] != d["size_bytes"]
            or prev_state[p]["file_count"] != d["file_count"]
        ]
        if changed_in_current:
            conn.executemany(
                """INSERT INTO directory_current
                       (path, root_path, size_bytes, file_count, last_changed_scan_id)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET
                       size_bytes=excluded.size_bytes,
                       file_count=excluded.file_count,
                       last_changed_scan_id=excluded.last_changed_scan_id""",
                changed_in_current
            )
        if deleted_paths:
            placeholders = ",".join("?" * len(deleted_paths))
            conn.execute(
                f"DELETE FROM directory_current WHERE root_path=? AND path IN ({placeholders})",
                [norm_root] + list(deleted_paths)
            )
        conn.commit()

    # Retention cleanup
    retention = config.get("retention", {})
    if not args.dry_run and retention.get("cleanup_after_scan", True):
        keep_days = int(retention.get("keep_days", 365))
        cleanup_old_data(conn, keep_days)

    overall_elapsed = time.monotonic() - overall_start
    print(f"\nAll scans complete. Total: {_fmt_bytes(total_size)}, "
          f"{total_dirs:,} directories, {_fmt_duration(overall_elapsed)}")

    conn.close()


if __name__ == "__main__":
    main()
