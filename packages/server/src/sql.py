import json
import sqlite3
import sys
import time
from pathlib import Path

MAX_ROWS = 1000
SECONDS = 1.0
ALLOWED = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}
SCHEMA_PRAGMAS = {"table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list"}


def authorize(action, name, *_):
    if action == sqlite3.SQLITE_PRAGMA:
        return sqlite3.SQLITE_OK if name in SCHEMA_PRAGMAS else sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK if action in ALLOWED else sqlite3.SQLITE_DENY


def cell(value):
    return f"<{len(value)} bytes>" if isinstance(value, bytes) else value


def run(path, sql):
    conn = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
    conn.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
    conn.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1_000_000)
    conn.set_authorizer(authorize)
    deadline = time.monotonic() + SECONDS
    conn.set_progress_handler(lambda: time.monotonic() > deadline, 1000)
    try:
        cursor = conn.execute(sql)
        rows = cursor.fetchmany(MAX_ROWS + 1)
    except sqlite3.Error as error:
        if time.monotonic() > deadline:
            return {"error": f"stopped after {SECONDS:g} s; narrow the query"}
        return {"error": str(error)}
    finally:
        conn.set_progress_handler(None, 0)
    return {
        "columns": [d[0] for d in cursor.description or []],
        "rows": [[cell(v) for v in row] for row in rows[:MAX_ROWS]],
        "truncated": len(rows) > MAX_ROWS,
    }


if __name__ == "__main__":
    json.dump(run(sys.argv[1], sys.stdin.read()), sys.stdout, ensure_ascii=False)
