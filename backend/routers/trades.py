import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Query

from ..services.trade_parser import parse_trades
from ..store import create_session, get_session, list_sessions, delete_session
from ..cache import invalidate_charts_for_session, invalidate_analytics_for_session
from ..prefetch import prefetch_session, get_prefetch_status

router = APIRouter(prefix="/trades", tags=["trades"])

@router.post("/upload")
async def upload_trades(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    suffix: str = Query(".SR", description="Exchange suffix for prefetch"),
):
    if not file.filename or not file.filename.lower().endswith((".csv", ".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Only CSV or XLSX files are supported")

    content = await file.read()
    try:
        trades = parse_trades(content, source_name=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    symbols = sorted({sym for (_, sym) in trades.keys()})
    create_session(session_id, trades, file.filename, csv_bytes=content, symbols=symbols)

    background_tasks.add_task(prefetch_session, session_id, trades, suffix)

    completed = sum(1 for t in trades.values() if t["status"] == "completed")
    ongoing = sum(1 for t in trades.values() if t["status"] == "ongoing")

    return {
        "session_id": session_id,
        "filename": file.filename,
        "total_trades": len(trades),
        "completed": completed,
        "ongoing": ongoing,
        "symbols": symbols,
    }

@router.get("/sessions")
async def get_sessions():
    return list_sessions()

@router.get("/sessions/{session_id}/prefetch-status")
async def prefetch_status(session_id: str):
    status = get_prefetch_status(session_id)
    if status is None:
        return {"total": 0, "cached": 0, "failed": 0, "done": True,
                "verified": 0, "repaired": 0, "verifying": False}
    return {
        "total": status["total"],
        "cached": status["cached"],
        "failed": status["failed"],
        "done": status["done"],
        "verified": status["verified"],
        "repaired": status["repaired"],
        "verifying": status["verifying"],
    }

@router.get("/sessions/{session_id}")
async def load_session(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    trades = session["trades"]
    symbols = sorted({sym for (_, sym) in trades.keys()})
    completed = sum(1 for t in trades.values() if t["status"] == "completed")
    ongoing = sum(1 for t in trades.values() if t["status"] == "ongoing")

    return {
        "session_id": session_id,
        "filename": session["filename"],
        "total_trades": len(trades),
        "completed": completed,
        "ongoing": ongoing,
        "symbols": symbols,
    }

@router.delete("/sessions/{session_id}")
async def remove_session(session_id: str):
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    invalidate_charts_for_session(session_id)
    invalidate_analytics_for_session(session_id)
    return {"deleted": session_id}

@router.get("/sessions/{session_id}/trades")
async def list_trades(
    session_id: str,
    status: str | None = Query(None, description="Filter: completed | ongoing"),
    symbol: str | None = Query(None),
    from_date: str | None = Query(None, description="ISO date YYYY-MM-DD; keep trades with an execution on/after this date"),
    to_date: str | None = Query(None, description="ISO date YYYY-MM-DD; keep trades with an execution on/before this date"),
):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    from datetime import datetime
    range_from = range_to = None
    try:
        if from_date:
            range_from = datetime.fromisoformat(from_date).date()
        if to_date:
            range_to = datetime.fromisoformat(to_date).date()
    except ValueError:
        raise HTTPException(status_code=422, detail="from_date/to_date must be YYYY-MM-DD")
    if range_from and range_to and range_from > range_to:
        raise HTTPException(status_code=422, detail="from_date must be on or before to_date")

    trades = session["trades"]
    result = []
    for (tid, sym), info in trades.items():
        if status and info["status"] != status:
            continue
        if symbol and sym != symbol:
            continue

        if range_from or range_to:
            in_range = False
            for o in info["orders"]:
                ed = o["exec_date"]
                ed = ed.date() if hasattr(ed, "date") else ed
                if range_from and ed < range_from:
                    continue
                if range_to and ed > range_to:
                    continue
                in_range = True
                break
            if not in_range:
                continue

        buy_pq = buy_q = sell_pq = sell_q = 0.0
        for o in info["orders"]:
            ep = o["exec_price"]
            if ep is None:
                continue
            q = o["qty"]
            if o["side"] == "1":
                buy_pq += ep * q
                buy_q += q
            else:
                sell_pq += ep * q
                sell_q += q

        result.append({
            "trade_id": tid,
            "symbol": sym,
            "status": info["status"],
            "entry_date": info["entry_date"],
            "exit_date": info.get("exit_date"),
            "buy_qty": info["buy_qty"],
            "sell_qty": info["sell_qty"],
            "net_qty": round(info["buy_qty"] - info["sell_qty"], 4),
            "avg_buy": round(buy_pq / buy_q, 4) if buy_q > 0 else None,
            "avg_sell": round(sell_pq / sell_q, 4) if sell_q > 0 else None,
            "realized_pl": round(sell_pq - buy_pq, 2) if info["status"] == "completed" and buy_q > 0 and sell_q > 0 else None,
            "order_count": len(info["orders"]),
        })

    result.sort(key=lambda r: (r["symbol"], r["trade_id"]))
    return result
