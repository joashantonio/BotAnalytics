from fastapi import APIRouter, HTTPException, Query

from ..services.chart_builder import build_chart_data, build_analytics, compute_correct_executions
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
):
    """
    % of executions on the correct side of the PSAR trend (buy in downtrend,
    sell in uptrend), optionally restricted to executions in [from_date, to_date].
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    suffix = suffix.strip()
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

    # Version suffix (v4 = buy Q1 at bottom, sell Q1 at top). Bump when the
    # payload shape or semantics change so stale-shaped cached rows are
    # naturally missed, not served.
    scope = f"__correct_exec__v4__:{from_date or ''}:{to_date or ''}"
    cached = get_analytics(session_id, scope, suffix)
    if cached is not None:
        return cached

    try:
        data = compute_correct_executions(
            session["trades"], suffix=suffix, from_date=from_date, to_date=to_date
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
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    trades = session["trades"]
    key = (trade_id, symbol)
    if key not in trades:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} / {symbol} not found")

    suffix = suffix.strip()

    cached = get_chart(session_id, trade_id, symbol, suffix)
    if cached is not None:
        return cached

    try:
        data = build_chart_data(trades[key], suffix=suffix)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {e}")

    set_chart(session_id, trade_id, symbol, suffix, data)
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
