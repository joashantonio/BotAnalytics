import csv
import io
from collections import defaultdict
from datetime import datetime
from typing import BinaryIO

import pandas as pd

def _parse_csv_rows(content: bytes) -> tuple[list[str], list[dict]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    rows = list(reader)
    return list(fieldnames), rows

def _parse_xlsx_rows(content: bytes) -> tuple[list[str], list[dict]]:
    df = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=str)
    df = df.where(pd.notna(df), None)
    fieldnames = list(df.columns)
    rows = [
        {col: ("" if val is None else str(val).strip()) for col, val in row.items()}
        for row in df.to_dict(orient="records")
    ]
    return fieldnames, rows

_BOX_LEVEL_COLUMNS = {
    "Upper": "upper",
    "Lower": "lower",
    "Middle": "middle",
    "Range": "range",
    "Quartile Step": "quartile_step",
    "First Quartile": "first_quartile",
    "Second Quartile": "second_quartile",
    "Third Quartile": "third_quartile",
    "Fourth Quartile": "fourth_quartile",
}

def _parse_xlsx_box_levels(content: bytes) -> dict[str, dict]:
    levels_by_trade: dict[str, dict] = {}
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception:
        return levels_by_trade

    for sheet_name in xl.sheet_names:
        if sheet_name not in xl.sheet_names or not sheet_name.strip().isdigit():
            continue
        try:
            df = xl.parse(sheet_name, dtype=str)
        except Exception:
            continue
        if "Upper" not in df.columns or "Lower" not in df.columns:
            continue

        for _, row in df.iterrows():
            upper_raw = row.get("Upper")
            lower_raw = row.get("Lower")
            if upper_raw is None or lower_raw is None or pd.isna(upper_raw) or pd.isna(lower_raw):
                continue
            try:
                levels = {dest: float(row[col]) for col, dest in _BOX_LEVEL_COLUMNS.items()}
            except (TypeError, ValueError):
                continue
            levels_by_trade[sheet_name.strip()] = levels
            break

    return levels_by_trade

def _is_xlsx(content: bytes, source_name: str) -> bool:
    if source_name.lower().endswith((".xlsx", ".xlsm")):
        return True
    return content[:4] == b"PK\x03\x04"

def parse_trades(content: bytes, source_name: str = "upload") -> dict[tuple, dict]:
    box_levels_by_trade: dict[str, dict] = {}
    if _is_xlsx(content, source_name):
        fieldnames, rows = _parse_xlsx_rows(content)
        box_levels_by_trade = _parse_xlsx_box_levels(content)
    else:
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
            "quartile_levels": box_levels_by_trade.get(tid),
        }

    return trades

def compute_analytics(trades: dict[tuple, dict]) -> dict:
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
