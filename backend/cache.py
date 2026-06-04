"""
Result cache backed by the same SQLite DB as the session store.
Caches:
  - chart data   keyed by (session_id, trade_id, symbol, suffix)
  - analytics    keyed by (session_id, scope, suffix)
                   scope = symbol name  OR  "__session__" for full-session analytics
  - company names keyed by ticker
"""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Same DB as the session store; DB_PATH env override keeps both in sync so a
# Docker volume persists everything across restarts. See store.py.
_DB_PATH = Path(os.getenv("DB_PATH", str(Path(__file__).parent / "trade_handler.db")))


@contextmanager
def _conn():
    con = sqlite3.connect(_DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_cache_tables() -> None:
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS chart_cache (
                session_id  TEXT NOT NULL,
                trade_id    TEXT NOT NULL,
                symbol      TEXT NOT NULL,
                suffix      TEXT NOT NULL,
                data        TEXT NOT NULL,
                cached_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (session_id, trade_id, symbol, suffix)
            );
            CREATE TABLE IF NOT EXISTS analytics_cache (
                session_id  TEXT NOT NULL,
                scope       TEXT NOT NULL,
                suffix      TEXT NOT NULL,
                data        TEXT NOT NULL,
                cached_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (session_id, scope, suffix)
            );
            CREATE TABLE IF NOT EXISTS company_name_cache (
                ticker      TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                cached_at   TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ohlcv_cache (
                ticker      TEXT NOT NULL,
                from_date   TEXT NOT NULL,
                to_date     TEXT NOT NULL,
                data        TEXT NOT NULL,
                cached_at   TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (ticker, from_date, to_date)
            );
        """)


init_cache_tables()

# ── chart ──────────────────────────────────────────────────────────────────────

def get_chart(session_id: str, trade_id: str, symbol: str, suffix: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT data FROM chart_cache WHERE session_id=? AND trade_id=? AND symbol=? AND suffix=?",
            (session_id, trade_id, symbol, suffix),
        ).fetchone()
    return json.loads(row["data"]) if row else None


def set_chart(session_id: str, trade_id: str, symbol: str, suffix: str, data: dict) -> None:
    with _conn() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO chart_cache (session_id, trade_id, symbol, suffix, data)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, trade_id, symbol, suffix, json.dumps(data)),
        )


def invalidate_charts_for_session(session_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM chart_cache WHERE session_id=?", (session_id,))


# ── analytics ──────────────────────────────────────────────────────────────────

SESSION_SCOPE = "__session__"


def get_analytics(session_id: str, scope: str, suffix: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT data FROM analytics_cache WHERE session_id=? AND scope=? AND suffix=?",
            (session_id, scope, suffix),
        ).fetchone()
    return json.loads(row["data"]) if row else None


def set_analytics(session_id: str, scope: str, suffix: str, data: dict) -> None:
    with _conn() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO analytics_cache (session_id, scope, suffix, data)
            VALUES (?, ?, ?, ?)
            """,
            (session_id, scope, suffix, json.dumps(data)),
        )


def invalidate_analytics_for_session(session_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM analytics_cache WHERE session_id=?", (session_id,))


# ── company name ───────────────────────────────────────────────────────────────

def get_company_name_cached(ticker: str) -> str | None:
    with _conn() as c:
        row = c.execute(
            "SELECT name FROM company_name_cache WHERE ticker=?", (ticker,)
        ).fetchone()
    if row is None:
        return None
    name = row["name"]
    return name if name else None  # treat stored empty string as cache miss


def set_company_name_cached(ticker: str, name: str) -> None:
    if not name:
        return  # don't cache empty/falsy names
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO company_name_cache (ticker, name) VALUES (?, ?)",
            (ticker, name),
        )


# ── raw OHLCV ──────────────────────────────────────────────────────────────────
# Stores the raw yfinance download once per (ticker, from, to) window so the
# network fetch happens a single time. Chart/analytics recompute reads from here.

def get_ohlcv(ticker: str, from_date: str, to_date: str) -> str | None:
    """Return the JSON-encoded OHLCV payload, or None on miss."""
    with _conn() as c:
        row = c.execute(
            "SELECT data FROM ohlcv_cache WHERE ticker=? AND from_date=? AND to_date=?",
            (ticker, from_date, to_date),
        ).fetchone()
    return row["data"] if row else None


def set_ohlcv(ticker: str, from_date: str, to_date: str, data: str) -> None:
    with _conn() as c:
        c.execute(
            """
            INSERT OR REPLACE INTO ohlcv_cache (ticker, from_date, to_date, data)
            VALUES (?, ?, ?, ?)
            """,
            (ticker, from_date, to_date, data),
        )
