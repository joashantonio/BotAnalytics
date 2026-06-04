import csv
import io
from collections import defaultdict
from datetime import datetime
from typing import BinaryIO


def _parse_csv_rows(content: bytes) -> tuple[list[str], list[dict]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    rows = list(reader)
    return list(fieldnames), rows


def parse_trades(content: bytes, source_name: str = "upload") -> dict[tuple, dict]:
    """
    Parse CSV bytes. Returns all trades keyed by (trade_id, symbol).
    Each value: {trade_id, symbol, entry_date, exit_date|None, orders, status, buy_qty, sell_qty}
    """
    fieldnames, rows = _parse_csv_rows(content)

    required = {"Trade", "Symbol", "Side", "Quantity", "Execution Price", "Execution Date"}
    missing = required - set(fieldnames)
    if missing:
        raise ValueError(f"Missing CSV columns: {missing}")

    raw: dict[tuple, dict] = defaultdict(lambda: {
        "buy_qty": 0.0, "sell_qty": 0.0,
        "min_date": None, "max_date": None, "orders": [],
    })

    for row in rows:
        tid = row["Trade"].strip()
        sym = row["Symbol"].strip()
        qty_raw = row["Quantity"].strip()
        side = row["Side"].strip()
        ep_raw = row["Execution Price"].strip()
        dt_raw = row["Execution Date"].strip()

        if not qty_raw or not dt_raw:
            continue

        qty = float(qty_raw)
        exec_price = float(ep_raw) if ep_raw else None
        dt = datetime.fromisoformat(dt_raw).replace(tzinfo=None)

        key = (tid, sym)
        if side == "1":
            raw[key]["buy_qty"] += qty
        else:
            raw[key]["sell_qty"] += qty
        if raw[key]["min_date"] is None or dt < raw[key]["min_date"]:
            raw[key]["min_date"] = dt
        if raw[key]["max_date"] is None or dt > raw[key]["max_date"]:
            raw[key]["max_date"] = dt
        raw[key]["orders"].append({
            "side": side,
            "exec_date": dt,
            "exec_price": exec_price,
            "qty": qty,
        })

    trades = {}
    for (tid, sym), v in raw.items():
        is_done = abs(v["buy_qty"] - v["sell_qty"]) < 1e-9
        trades[(tid, sym)] = {
            "trade_id": tid,
            "symbol": sym,
            "entry_date": v["min_date"].strftime("%Y-%m-%d") if v["min_date"] else None,
            "exit_date": v["max_date"].strftime("%Y-%m-%d") if (is_done and v["max_date"]) else None,
            "orders": v["orders"],
            "status": "completed" if is_done else "ongoing",
            "buy_qty": v["buy_qty"],
            "sell_qty": v["sell_qty"],
            "source": source_name,
        }

    return trades


def compute_analytics(trades: dict[tuple, dict]) -> dict:
    """Aggregate P&L metrics across all trades (completed only for realized P&L)."""
    total_pl = 0.0
    wins = 0
    losses = 0
    completed = 0
    ongoing_count = 0
    total_trades = len(trades)
    max_drawdown = 0.0
    equity_curve = []
    running = 0.0

    for info in trades.values():
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

        if info["status"] == "completed":
            completed += 1
            pl = sell_pq - buy_pq
            total_pl += pl
            running += pl
            equity_curve.append(running)
            if pl >= 0:
                wins += 1
            else:
                losses += 1
            peak = max(equity_curve)
            dd = peak - running
            if dd > max_drawdown:
                max_drawdown = dd
        else:
            ongoing_count += 1

    win_rate = (wins / completed * 100) if completed > 0 else 0.0

    return {
        "total_pl": round(total_pl, 2),
        "win_rate": round(win_rate, 2),
        "completed_trades": completed,
        "ongoing_trades": ongoing_count,
        "total_trades": total_trades,
        "wins": wins,
        "losses": losses,
        "max_drawdown": round(max_drawdown, 2),
    }
