import logging
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, UploadFile, File, Query
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..services.trade_parser import parse_trades
from ..store import create_session, get_session, list_sessions, delete_session
from ..cache import invalidate_charts_for_session, invalidate_analytics_for_session
from ..prefetch import prefetch_session, get_prefetch_status

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/trades", tags=["trades"])

# Reject uploads larger than this. Mirrors nginx client_max_body_size (25m) so
# the backend never buffers an oversized file fully into RAM. Overridable.
_MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
# Stream the upload in chunks so we can abort before reading the whole body.
_CHUNK = 1024 * 1024

@router.post("/upload")
@limiter.limit("10/minute")
async def upload_trades(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    suffix: str = Query(".SR", description="Exchange suffix for prefetch"),
):
    if not file.filename or not file.filename.lower().endswith((".csv", ".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Only CSV or XLSX files are supported")

    # Read in chunks and bail the moment we exceed the cap, instead of buffering
    # an arbitrarily large body into memory (OOM / DoS guard).
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK):
        size += len(chunk)
        if size > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
            )
        chunks.append(chunk)
    content = b"".join(chunks)

    try:
        trades = parse_trades(content, source_name=file.filename)
    except ValueError as e:
        logger.info("Upload rejected (parse error) file=%s: %s", file.filename, e)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Upload failed (unexpected parse error) file=%s", file.filename)
        raise HTTPException(status_code=422, detail="Could not parse file")

    session_id = str(uuid.uuid4())
    symbols = sorted({sym for (_, sym) in trades.keys()})
    create_session(session_id, trades, file.filename, csv_bytes=content, symbols=symbols)

    background_tasks.add_task(prefetch_session, session_id, trades, suffix)
    logger.info(
        "Session created id=%s file=%s trades=%d symbols=%d",
        session_id, file.filename, len(trades), len(symbols),
    )

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
            "bot_type": info.get("bot_type", ""),
        })

    result.sort(key=lambda r: (r["symbol"], r["trade_id"]))
    return result
