import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..services.chart_builder import build_chart_data, build_chart_data_ma10, build_chart_data_ma200, build_analytics, compute_correct_executions
from ..store import get_session
from ..cache import (
    get_chart, set_chart,
    get_analytics, set_analytics, SESSION_SCOPE,
)

router = APIRouter(prefix="/symbols", tags=["symbols"])

@router.get("/{session_id}")
async def list_symbols(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    trades = session["trades"]
    symbol_map: dict[str, dict] = {}

    for (tid, sym), info in trades.items():
        if sym not in symbol_map:
            symbol_map[sym] = {"symbol": sym, "completed": 0, "ongoing": 0, "trades": []}
        if info["status"] == "completed":
            symbol_map[sym]["completed"] += 1
        else:
            symbol_map[sym]["ongoing"] += 1
        symbol_map[sym]["trades"].append(tid)

    return sorted(symbol_map.values(), key=lambda s: s["symbol"])

@router.get("/{session_id}/analytics/summary")
async def get_session_analytics(
    session_id: str,
    suffix: str = Query(".SR"),
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    suffix = suffix.strip()

    cached = get_analytics(session_id, SESSION_SCOPE, suffix)
    if cached is not None:
        return cached

    try:
        data = build_analytics(session["trades"], suffix=suffix)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analytics failed: {e}")

    set_analytics(session_id, SESSION_SCOPE, suffix, data)
    return data

@router.get("/{session_id}/analytics/correct-executions")
async def get_correct_executions(
    session_id: str,
    suffix: str = Query(".SR"),
    from_date: str | None = Query(None, description="ISO date YYYY-MM-DD"),
    to_date: str | None = Query(None, description="ISO date YYYY-MM-DD"),
    mode: str = Query("psar", description="Trend mode: psar | ma10 | ma200"),
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    suffix = suffix.strip()
    mode = mode.strip().lower()
    if mode not in ("psar", "ma10", "ma200"):
        raise HTTPException(status_code=422, detail="mode must be 'psar', 'ma10', or 'ma200'")

    from datetime import datetime
    try:
        if from_date:
            datetime.fromisoformat(from_date)
        if to_date:
            datetime.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="from_date/to_date must be YYYY-MM-DD")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="from_date must be on or before to_date")

    # Version suffix (v8 = market-break dates excluded from fetched candles).
    # Bump when the payload shape or semantics change so stale-shaped cached rows
    # are naturally missed, not served. mode_part keys the cache per indicator
    # (psar/ma10/ma200) so switching mode doesn't serve another mode's rows.
    mode_part = "" if mode == "psar" else f"::{mode}"
    scope = f"__correct_exec__v8__{mode_part}:{from_date or ''}:{to_date or ''}"
    cached = get_analytics(session_id, scope, suffix)
    if cached is not None:
        return cached

    try:
        data = compute_correct_executions(
            session["trades"], suffix=suffix, from_date=from_date, to_date=to_date, mode=mode
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Correct-executions failed: {e}")

    set_analytics(session_id, scope, suffix, data)
    return data

@router.get("/{session_id}/{symbol}/chart")
async def get_chart_endpoint(
    session_id: str,
    symbol: str,
    trade_id: str = Query(..., description="Trade ID to chart"),
    suffix: str = Query(".SR", description="Yahoo Finance exchange suffix"),
    mode: str = Query("psar", description="Indicator mode: psar | ma10 | ma200"),
    from_date: str | None = Query(None, description="ISO date YYYY-MM-DD - widen visible window to include this range"),
    to_date: str | None = Query(None, description="ISO date YYYY-MM-DD - widen visible window to include this range"),
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    trades = session["trades"]
    key = (trade_id, symbol)
    if key not in trades:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} / {symbol} not found")

    suffix = suffix.strip()
    mode = mode.strip().lower()
    if mode not in ("psar", "ma10", "ma200"):
        raise HTTPException(status_code=422, detail="mode must be 'psar', 'ma10', or 'ma200'")

    from datetime import datetime as _datetime
    try:
        if from_date:
            _datetime.fromisoformat(from_date)
        if to_date:
            _datetime.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="from_date/to_date must be YYYY-MM-DD")
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="from_date must be on or before to_date")

    range_part = f"::{from_date or ''}:{to_date or ''}" if (from_date or to_date) else ""
    # Every chart now extends through today's latest candle (see fetch_wide), so
    # the cached payload must be rebuilt once per day for every trade — otherwise
    # a chart built today keeps being served unchanged on later days.
    today_part = f"::{pd.Timestamp.today().strftime('%Y-%m-%d')}"
    # Always version the key (incl. PSAR). Previously PSAR with no range cached
    # under a bare suffix with no version, so payload-shape changes (e.g. adding
    # bot_type) were never cache-busted and stale-shaped rows kept being served.
    cache_suffix = f"{suffix}::{mode}::v24{range_part}{today_part}"

    cached = get_chart(session_id, trade_id, symbol, cache_suffix)
    if cached is not None:
        return cached

    try:
        if mode == "ma10":
            data = build_chart_data_ma10(trades[key], suffix=suffix, from_date=from_date, to_date=to_date)
        elif mode == "ma200":
            data = build_chart_data_ma200(trades[key], suffix=suffix, from_date=from_date, to_date=to_date)
        else:
            data = build_chart_data(trades[key], suffix=suffix, from_date=from_date, to_date=to_date)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {e}")

    set_chart(session_id, trade_id, symbol, cache_suffix, data)
    return data

@router.get("/{session_id}/{symbol}/analytics")
async def get_symbol_analytics(
    session_id: str,
    symbol: str,
    suffix: str = Query(".SR"),
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    suffix = suffix.strip()

    cached = get_analytics(session_id, symbol, suffix)
    if cached is not None:
        return cached

    trades = session["trades"]
    symbol_trades = {k: v for k, v in trades.items() if k[1] == symbol}
    if not symbol_trades:
        raise HTTPException(status_code=404, detail=f"No trades for symbol {symbol}")

    try:
        analytics = build_analytics(symbol_trades, suffix=suffix)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analytics failed: {e}")

    analytics["symbol"] = symbol
    set_analytics(session_id, symbol, suffix, analytics)
    return analytics
