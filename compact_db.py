#!/usr/bin/env python3
"""
DiskWatch database compaction script.

Eliminates redundant directory_sizes rows where (size_bytes, file_count) are
unchanged across consecutive scans for the same path, then populates
directory_current with the current state and runs VACUUM to reclaim disk space.

Run this once after deploying the delta-storage update, while the collector
is NOT actively scanning. The server can remain stopped.

VACUUM needs roughly as much free disk space as the current DB size.
"""

import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent / "instance" / "diskwatch.db"


def compact(db_path: Path):
    if not db_path.exists():
        print(f"ERROR: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    size_before = db_path.stat().st_size
    print(f"Database: {db_path}")
    print(f"Size before: {size_before / 1024**3:.2f} GB ({size_before:,} bytes)")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("PRAGMA cache_size=-131072")   # 128 MB cache
    conn.execute("PRAGMA synchronous=NORMAL")   # safe but faster than FULL

    # --- Schema additions (idempotent) ---
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS directory_current (
            path TEXT PRIMARY KEY,
            root_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            file_count INTEGER NOT NULL,
            last_changed_scan_id INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dircurrent_root ON directory_current(root_path);
        CREATE INDEX IF NOT EXISTS idx_dirsizes_scan_path ON directory_sizes(scan_id, path);
        CREATE INDEX IF NOT EXISTS idx_dirsizes_path_scan ON directory_sizes(path, scan_id DESC);
    """)
    conn.commit()

    try:
        conn.execute(
            "ALTER TABLE directory_sizes ADD COLUMN is_tombstone INTEGER NOT NULL DEFAULT 0"
        )
        conn.commit()
        print("Added is_tombstone column.")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise

    # --- Count rows before ---
    total_before = conn.execute("SELECT COUNT(*) FROM directory_sizes").fetchone()[0]
    print(f"Rows in directory_sizes before: {total_before:,}")

    # --- Remove duplicate rows per root, processing consecutive scan pairs ---
    #
    # Algorithm: for each root, get scan IDs in chronological order.
    # Process pairs in REVERSE (last→first) so that when we compare scan[i] to
    # scan[i-1], scan[i-1] still has its full original data.
    # A row in scan[i] is redundant if scan[i-1] has the same (path, size_bytes,
    # file_count). Delete those rows. Uses idx_dirsizes_scan_path for both sides
    # of the join — no full-table sort needed.

    roots = [r[0] for r in conn.execute(
        "SELECT DISTINCT root_path FROM scans ORDER BY root_path"
    ).fetchall()]

    total_removed = 0
    for root_path in roots:
        scan_ids = [r[0] for r in conn.execute(
            "SELECT scan_id FROM scans WHERE root_path=? ORDER BY scan_id ASC",
            (root_path,)
        ).fetchall()]

        if len(scan_ids) < 2:
            print(f"  {root_path}: only 1 scan, skipping.")
            continue

        print(f"  {root_path}: {len(scan_ids)} scans", flush=True)
        root_removed = 0

        # Reverse: start from the last scan pair going backward
        for i in range(len(scan_ids) - 1, 0, -1):
            curr_sid = scan_ids[i]
            prev_sid = scan_ids[i - 1]

            conn.execute("""
                DELETE FROM directory_sizes
                WHERE scan_id = ?
                  AND is_tombstone = 0
                  AND path IN (
                      SELECT curr.path
                      FROM directory_sizes curr
                      JOIN directory_sizes prev
                          ON prev.scan_id = ? AND prev.path = curr.path
                      WHERE curr.scan_id = ?
                        AND prev.is_tombstone = 0
                        AND curr.size_bytes = prev.size_bytes
                        AND curr.file_count = prev.file_count
                  )
            """, (curr_sid, prev_sid, curr_sid))

            n = conn.execute("SELECT changes()").fetchone()[0]
            root_removed += n
            conn.commit()
            print(f"    scan {curr_sid} vs {prev_sid}: removed {n:,} duplicate rows")

        total_removed += root_removed
        print(f"  → {root_path} total removed: {root_removed:,}")

    total_after = conn.execute("SELECT COUNT(*) FROM directory_sizes").fetchone()[0]
    print(f"\nRows after: {total_after:,}  (removed {total_removed:,})")

    # --- Populate directory_current ---
    print("Populating directory_current ...", end="", flush=True)
    conn.execute("DELETE FROM directory_current")
    conn.execute("""
        INSERT INTO directory_current (path, root_path, size_bytes, file_count, last_changed_scan_id)
        SELECT ds.path, s.root_path, ds.size_bytes, ds.file_count, ds.scan_id
        FROM directory_sizes ds
        JOIN scans s ON s.scan_id = ds.scan_id
        WHERE ds.is_tombstone = 0
          AND ds.scan_id = (
              SELECT MAX(ds2.scan_id)
              FROM directory_sizes ds2
              JOIN scans s2 ON s2.scan_id = ds2.scan_id
              WHERE ds2.path = ds.path
                AND s2.root_path = s.root_path
                AND ds2.is_tombstone = 0
          )
    """)
    dc_count = conn.execute("SELECT COUNT(*) FROM directory_current").fetchone()[0]
    conn.commit()
    print(f" {dc_count:,} paths")

    # --- VACUUM ---
    current_size = db_path.stat().st_size
    free_bytes = os.statvfs(str(db_path)).f_frsize * os.statvfs(str(db_path)).f_bavail
    print(f"\nCurrent DB size: {current_size / 1024**3:.2f} GB")
    print(f"Free disk space: {free_bytes / 1024**3:.2f} GB")

    if free_bytes < current_size:
        print("WARNING: insufficient free space for VACUUM.")
        print("Run manually when space is available:")
        print(f"  sqlite3 '{db_path}' 'VACUUM INTO \"/tmp/diskwatch_compact.db\"'")
        print("then rename /tmp/diskwatch_compact.db to replace the original.")
    else:
        print("Running VACUUM (may take a few minutes) ...", end="", flush=True)
        conn.execute("VACUUM")
        print(" done")

    conn.close()

    size_after = db_path.stat().st_size
    saved = size_before - size_after
    print(f"\nSize after:  {size_after / 1024**3:.2f} GB")
    print(f"Saved:       {saved / 1024**3:.2f} GB  ({saved / size_before * 100:.1f}%)")


if __name__ == "__main__":
    compact(DB_PATH)
