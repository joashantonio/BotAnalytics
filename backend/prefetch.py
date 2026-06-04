"""
Background prefetch service.

Speed strategy: group trades by symbol → one yfinance download per symbol
covering the widest date window for that symbol → reuse df_wide for all trades
under that symbol. Reduces yfinance calls from N_trades to N_symbols.

Status tracked in-memory per session for frontend polling.
"""
import asyncio
import time
from collections import defaultdict
from datetime import timedelta
from typing import TypedDict

import pandas as pd

from .cache import get_chart, set_chart, set_analytics, SESSION_SCOPE
from .services.chart_builder import build_chart_data, build_analytics
from .services.market_data import fetch_ohlcv

# ── status registry ────────────────────────────────────────────────────────────

class PrefetchStatus(TypedDict):
    total: int
    cached: int
    failed: int
    done: bool
    started_at: float
    verified: int
    repaired: int
    verifying: bool


_status: dict[str, PrefetchStatus] = {}


def get_prefetch_status(session_id: str) -> PrefetchStatus | None:
    return _status.get(session_id)


def _set_status(
    session_id: str, total: int, cached: int, failed: int, done: bool,
    verified: int | None = None, repaired: int | None = None,
    verifying: bool | None = None,
) -> None:
    prev = _status.get(session_id)
    started = prev["started_at"] if prev else time.monotonic()
    _status[session_id] = PrefetchStatus(
        total=total, cached=cached, failed=failed, done=done, started_at=started,
        verified=verified if verified is not None else (prev["verified"] if prev else 0),
        repaired=repaired if repaired is not None else (prev["repaired"] if prev else 0),
        verifying=verifying if verifying is not None else (prev["verifying"] if prev else False),
    )


# ── prefetch logic ─────────────────────────────────────────────────────────────

async def prefetch_session(session_id: str, trades: dict, suffix: str) -> None:
    """
    Background task. Groups trades by symbol, fetches one wide OHLCV block per
    symbol (in a thread pool), builds+caches chart data for every trade.
    Already-cached trades are counted but not rebuilt.
    """
    suffix = suffix.strip()
    trade_items = list(trades.items())
    total = len(trade_items)
    cached_count = 0
    failed_count = 0

    _set_status(session_id, total, 0, 0, done=False)

    # Group by symbol
    symbol_groups: dict[str, list[tuple]] = defaultdict(list)
    for key, info in trade_items:
        _, sym = key
        symbol_groups[sym].append((key, info))

    loop = asyncio.get_running_loop()

    # Keep each symbol's wide OHLCV block around for the integrity pass so we
    # can recompute charts without a second network fetch.
    df_wide_by_symbol: dict[str, pd.DataFrame] = {}

    for sym, group in symbol_groups.items():
        ticker = f"{sym}{suffix}"

        # Widest window covering all trades in this symbol group.
        # Skip trades with no entry_date (all-empty execution dates) so min()
        # doesn't choke on None.
        all_entries = [info["entry_date"] for _, info in group if info["entry_date"]]
        all_exits = [
            info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
            for _, info in group
            if info["entry_date"]
        ]
        if not all_entries:
            failed_count += len(group)
            _set_status(session_id, total, cached_count, failed_count, done=False)
            continue
        earliest = min(all_entries)
        latest = max(all_exits)
        wide_from = (pd.Timestamp(earliest) - timedelta(days=120)).strftime("%Y-%m-%d")
        wide_to = (pd.Timestamp(latest) + timedelta(days=120)).strftime("%Y-%m-%d")

        try:
            df_wide = await loop.run_in_executor(
                None, fetch_ohlcv, ticker, wide_from, wide_to
            )
        except Exception:
            failed_count += len(group)
            _set_status(session_id, total, cached_count, failed_count, done=False)
            await asyncio.sleep(0.3)
            continue

        df_wide_by_symbol[sym] = df_wide

        for (tid, sym_key), info in group:
            if get_chart(session_id, tid, sym_key, suffix) is not None:
                cached_count += 1
                _set_status(session_id, total, cached_count, failed_count, done=False)
                continue
            try:
                data = await loop.run_in_executor(
                    None, _build_one, info, suffix, df_wide
                )
                set_chart(session_id, tid, sym_key, suffix, data)
                cached_count += 1
            except Exception:
                failed_count += 1
            _set_status(session_id, total, cached_count, failed_count, done=False)

        # Polite pause between symbols to avoid yfinance rate-limiting
        await asyncio.sleep(0.4)

    # Pre-cache session analytics — pure computation, no network
    try:
        analytics = await loop.run_in_executor(None, build_analytics, trades, suffix)
        set_analytics(session_id, SESSION_SCOPE, suffix, analytics)
    except Exception:
        pass

    # Fetch phase complete. Now run the integrity pass: recompute every chart
    # from the stored OHLCV and overwrite the cache if it diverges. This catches
    # any drift between the cached result and a fresh calculation.
    verified = 0
    repaired = 0
    _set_status(session_id, total, cached_count, failed_count, done=False, verifying=True)

    for sym, group in symbol_groups.items():
        df_wide = df_wide_by_symbol.get(sym)
        if df_wide is None:
            continue
        for (tid, sym_key), info in group:
            cached = get_chart(session_id, tid, sym_key, suffix)
            if cached is None:
                continue
            try:
                fresh = await loop.run_in_executor(None, _build_one, info, suffix, df_wide)
            except Exception:
                verified += 1
                _set_status(session_id, total, cached_count, failed_count,
                            done=False, verified=verified, repaired=repaired, verifying=True)
                continue
            if not _charts_equal(cached, fresh):
                set_chart(session_id, tid, sym_key, suffix, fresh)
                repaired += 1
            verified += 1
            _set_status(session_id, total, cached_count, failed_count,
                        done=False, verified=verified, repaired=repaired, verifying=True)

    # Re-derive session analytics once more post-repair so it reflects any fixes.
    try:
        analytics = await loop.run_in_executor(None, build_analytics, trades, suffix)
        set_analytics(session_id, SESSION_SCOPE, suffix, analytics)
    except Exception:
        pass

    _set_status(session_id, total, cached_count, failed_count, done=True,
                verified=verified, repaired=repaired, verifying=False)


def _charts_equal(a: dict, b: dict) -> bool:
    """Stable structural compare of two chart payloads (order-sensitive, JSON-normalized)."""
    import json
    try:
        return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    except (TypeError, ValueError):
        return a == b


def _build_one(trade_info: dict, suffix: str, df_wide: pd.DataFrame) -> dict:
    """Thin wrapper so run_in_executor can call build_chart_data with df override."""
    return build_chart_data(trade_info, suffix=suffix, _df_wide_override=df_wide)
