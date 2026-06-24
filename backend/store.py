"""
Persistent session store backed by SQLite.
Stores parsed trades in-memory for fast access; CSV bytes and metadata on disk.
DB path: backend/trade_handler.db (relative to store.py location)
"""
import json
import logging
import os
import sqlite3
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# DB location is overridable via DB_PATH so a Docker volume can persist it
# outside the container layer. Defaults to backend/trade_handler.db for local dev.
_DB_PATH = Path(os.getenv("DB_PATH", str(Path(__file__).parent / "trade_handler.db")))
_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Bounded in-memory LRU of parsed trades. Evicting only drops the RAM copy —
# the session still lives in SQLite (csv_bytes) and is re-parsed on next access,
# so this caps memory without losing data. Override via SESSION_CACHE_MAX.
_SESSION_CACHE_MAX = int(os.getenv("SESSION_CACHE_MAX", "32"))
_sessions: "OrderedDict[str, dict[str, Any]]" = OrderedDict()


def _cache_put(session_id: str, value: dict[str, Any]) -> None:
    _sessions[session_id] = value
    _sessions.move_to_end(session_id)
    while len(_sessions) > _SESSION_CACHE_MAX:
        evicted, _ = _sessions.popitem(last=False)
        logger.debug("Evicted session from memory cache id=%s", evicted)


def _cache_get(session_id: str) -> dict[str, Any] | None:
    val = _sessions.get(session_id)
    if val is not None:
        _sessions.move_to_end(session_id)
    return val


@contextmanager
def _get_conn():
    con = sqlite3.connect(_DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def _init_db() -> None:
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id   TEXT PRIMARY KEY,
                filename     TEXT NOT NULL,
                uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
                trade_count  INTEGER NOT NULL DEFAULT 0,
                symbols      TEXT NOT NULL DEFAULT '[]',
                csv_bytes    BLOB NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quartile_box_overrides (
                session_id   TEXT NOT NULL,
                trade_id     TEXT NOT NULL,
                symbol       TEXT NOT NULL,
                mode         TEXT NOT NULL,
                box_index    INTEGER NOT NULL,
                price_lo     REAL NOT NULL,
                price_hi     REAL NOT NULL,
                right_date   TEXT,
                updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (session_id, trade_id, symbol, mode, box_index)
            )
        """)
        # Older DBs created before right_date existed; add it in place so
        # existing override rows (and the file) aren't lost.
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(quartile_box_overrides)")}
        if "right_date" not in cols:
            conn.execute("ALTER TABLE quartile_box_overrides ADD COLUMN right_date TEXT")


_init_db()


def create_session(
    session_id: str,
    trades: dict,
    filename: str,
    csv_bytes: bytes,
    symbols: list[str],
) -> None:
    _cache_put(session_id, {"trades": trades, "filename": filename})
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO sessions
                (session_id, filename, trade_count, symbols, csv_bytes)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, filename, len(trades), json.dumps(symbols), csv_bytes),
        )


def get_session(session_id: str) -> dict | None:
    cached = _cache_get(session_id)
    if cached is not None:
        return cached
    # Restore from DB on cache miss (e.g., after restart or LRU eviction)
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT csv_bytes, filename FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
    if row is None:
        return None
    from .services.trade_parser import parse_trades  # lazy import to avoid cycle
    try:
        trades = parse_trades(row["csv_bytes"], source_name=row["filename"])
    except Exception:
        logger.exception("Failed to re-parse session from DB id=%s", session_id)
        return None
    value = {"trades": trades, "filename": row["filename"]}
    _cache_put(session_id, value)
    return value


def list_sessions() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT session_id, filename, uploaded_at, trade_count, symbols FROM sessions ORDER BY uploaded_at DESC"
        ).fetchall()
    return [
        {
            "session_id": r["session_id"],
            "filename": r["filename"],
            "uploaded_at": r["uploaded_at"],
            "trade_count": r["trade_count"],
            "symbols": json.loads(r["symbols"]),
        }
        for r in rows
    ]


def delete_session(session_id: str) -> bool:
    _sessions.pop(session_id, None)
    with _get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM sessions WHERE session_id = ?", (session_id,)
        )
        conn.execute(
            "DELETE FROM quartile_box_overrides WHERE session_id = ?", (session_id,)
        )
        return cur.rowcount > 0


def save_box_override(
    session_id: str,
    trade_id: str,
    symbol: str,
    mode: str,
    box_index: int,
    price_lo: float,
    price_hi: float,
    right_date: str | None = None,
) -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO quartile_box_overrides
                (session_id, trade_id, symbol, mode, box_index, price_lo, price_hi, right_date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT (session_id, trade_id, symbol, mode, box_index)
            DO UPDATE SET price_lo = excluded.price_lo,
                          price_hi = excluded.price_hi,
                          right_date = excluded.right_date,
                          updated_at = excluded.updated_at
            """,
            (session_id, trade_id, symbol, mode, box_index, price_lo, price_hi, right_date),
        )


def get_box_overrides(
    session_id: str, trade_id: str, symbol: str, mode: str
) -> dict[int, dict[str, float | str]]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT box_index, price_lo, price_hi, right_date FROM quartile_box_overrides
            WHERE session_id = ? AND trade_id = ? AND symbol = ? AND mode = ?
            """,
            (session_id, trade_id, symbol, mode),
        ).fetchall()
    result: dict[int, dict[str, float | str]] = {}
    for r in rows:
        override: dict[str, float | str] = {"price_lo": r["price_lo"], "price_hi": r["price_hi"]}
        if r["right_date"]:
            override["right_date"] = r["right_date"]
        result[r["box_index"]] = override
    return result
