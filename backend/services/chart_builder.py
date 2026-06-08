"""
Builds the JSON payload consumed by the frontend TradingView Lightweight Charts.
Mirrors the logic in completed_trades_fetcher.py and ongoing_trades_fetcher.py
but outputs data instead of matplotlib figures.
"""
from datetime import datetime

import numpy as np
import pandas as pd

from .market_data import fetch_wide, get_company_name
from .psar import compute_psar, compute_chart_window, wide_trend_block, get_quartile

PIN_BUY = "#00c853"
PIN_SELL = "#f44336"
AVG_BUY = "#ffd600"
AVG_SELL = "#9c27b0"
PSAR_DOT = "#f57f17"


def _order_exec_date(order: dict) -> pd.Timestamp:
    d = order["exec_date"]
    if isinstance(d, datetime):
        return pd.Timestamp(d.date())
    return pd.Timestamp(d)


def build_chart_data(
    trade_info: dict,
    suffix: str = ".SR",
    _df_wide_override: "pd.DataFrame | None" = None,
) -> dict:
    """
    Returns a dict with keys:
      candles, psar, buy_markers, sell_markers,
      avg_buy, avg_sell, quartile_boxes, company_name,
      cycle_direction, trade_id, symbol, status

    _df_wide_override: pre-fetched DataFrame from prefetch service; skips yfinance call.
    """
    suffix = suffix.strip()
    ticker = f"{trade_info['symbol']}{suffix}"
    orders = trade_info["orders"]
    entry_date = trade_info["entry_date"]
    exit_date = trade_info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
    status = trade_info["status"]

    df_wide = _df_wide_override if _df_wide_override is not None else fetch_wide(ticker, entry_date, exit_date)
    highs_w = df_wide["High"].values.astype(float)
    lows_w = df_wide["Low"].values.astype(float)
    sar_w, trend_w = compute_psar(highs_w, lows_w)

    start_i, end_i = compute_chart_window(df_wide, trend_w, sar_w, entry_date, exit_date, orders)
    df = df_wide.iloc[start_i: end_i + 1].copy()

    if df.empty:
        raise ValueError("Empty chart window after PSAR cycle detection")

    opens = df["Open"].values.astype(float)
    highs = df["High"].values.astype(float)
    lows = df["Low"].values.astype(float)
    closes = df["Close"].values.astype(float)
    volumes = df["Volume"].values.astype(float)
    dates = df.index
    trend = trend_w[start_i: end_i + 1]
    # Slice the wide PSAR rather than recomputing on the narrow window.
    # compute_psar always seeds trend[0]=-1 / sar[0]=high[0], so recomputing
    # on a slice that starts mid-trend produces wrong warmup dots that no
    # longer line up with `trend` (which is sliced from the wide array).
    sar = sar_w[start_i: end_i + 1]

    # candle series (time as ISO date string for Lightweight Charts)
    candles = []
    volume_series = []
    for i, date in enumerate(dates):
        t = date.strftime("%Y-%m-%d")
        candles.append({
            "time": t,
            "open": round(float(opens[i]), 4),
            "high": round(float(highs[i]), 4),
            "low": round(float(lows[i]), 4),
            "close": round(float(closes[i]), 4),
        })
        volume_series.append({
            "time": t,
            "value": float(volumes[i]),
            "color": "#a5d6a7" if closes[i] >= opens[i] else "#ef9a9a",
        })

    # PSAR dots
    psar_series = []
    for i, date in enumerate(dates):
        psar_series.append({"time": date.strftime("%Y-%m-%d"), "value": round(float(sar[i]), 4)})

    # entry trend direction
    entry_dt = pd.Timestamp(entry_date)
    entry_xi = int(np.searchsorted(dates, entry_dt, side="left"))
    entry_xi = max(0, min(entry_xi, len(df) - 1))
    cycle_direction = "Uptrend" if trend[entry_xi] == 1 else "Downtrend"

    # buy/sell markers
    buy_markers = []
    sell_markers = []
    buy_pq = buy_q = sell_pq = sell_q = 0.0

    for order in orders:
        ep = order["exec_price"]
        if ep is None:
            continue
        q = order["qty"]
        is_buy = order["side"] == "1"
        odt = _order_exec_date(order)

        xi = int(np.searchsorted(dates, odt, side="left"))
        xi = max(0, min(xi, len(df) - 1))
        t = dates[xi].strftime("%Y-%m-%d")

        marker = {"time": t, "price": round(float(ep), 4), "qty": q}
        if is_buy:
            buy_markers.append(marker)
            buy_pq += ep * q
            buy_q += q
        else:
            sell_markers.append(marker)
            sell_pq += ep * q
            sell_q += q

    avg_buy_val = round(buy_pq / buy_q, 4) if buy_q > 0 else None
    avg_sell_val = round(sell_pq / sell_q, 4) if sell_q > 0 else None

    # realized P&L (completed only)
    realized_pl = None
    if status == "completed" and buy_q > 0 and sell_q > 0:
        realized_pl = round(sell_pq - buy_pq, 2)

    # quartile boxes — one per trend block per side
    quartile_boxes = _build_quartile_boxes(
        orders, df_wide, df, trend_w, sar_w,
        highs, lows, dates, start_i, end_i, status
    )

    company_name = get_company_name(ticker)

    return {
        "trade_id": trade_info["trade_id"],
        "symbol": trade_info["symbol"],
        "ticker": ticker,
        "company_name": company_name,
        "status": status,
        "cycle_direction": cycle_direction,
        "entry_date": entry_date,
        "exit_date": trade_info.get("exit_date"),
        "candles": candles,
        "volume": volume_series,
        "psar": psar_series,
        "buy_markers": buy_markers,
        "sell_markers": sell_markers,
        "avg_buy": avg_buy_val,
        "avg_sell": avg_sell_val,
        "realized_pl": realized_pl,
        "buy_qty": buy_q,
        "sell_qty": sell_q,
        "net_qty": round(buy_q - sell_q, 4),
        "quartile_boxes": quartile_boxes,
    }


def _build_quartile_boxes(
    orders, df_wide, df, trend_w, sar_w,
    highs, lows, dates, start_i, end_i, status
) -> list[dict]:
    """
    For completed trades: one box per unique trend block touched by orders.
    For ongoing trades: only the latest trend block per side.
    """
    drawn_blocks: set[tuple] = set()
    boxes = []

    # for ongoing: find latest block per side
    latest_block: dict[str, tuple] = {}
    if status == "ongoing":
        for order in orders:
            if order["exec_price"] is None:
                continue
            side = order["side"]
            expected_trend = -1 if side == "1" else 1
            odt = _order_exec_date(order)
            i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
            i_w = min(i_w, len(df_wide) - 1)
            if trend_w[i_w] == expected_trend:
                bs_w, be_w = wide_trend_block(trend_w, i_w)
                if side not in latest_block or bs_w > latest_block[side][0]:
                    latest_block[side] = (bs_w, be_w)

    for order in orders:
        ep = order["exec_price"]
        if ep is None:
            continue
        is_buy = order["side"] == "1"
        expected_trend = -1 if is_buy else 1
        odt = _order_exec_date(order)

        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if trend_w[i_w] != expected_trend:
            continue

        bs_w, be_w = wide_trend_block(trend_w, i_w)
        block_key = (bs_w, be_w)

        if status == "ongoing" and block_key != latest_block.get(order["side"]):
            continue
        if block_key in drawn_blocks:
            continue

        bs_local = bs_w - start_i
        be_local = be_w - start_i
        bs_vis = max(bs_local, 0)
        be_vis = min(be_local, len(df) - 1)
        if bs_vis > be_vis:
            drawn_blocks.add(block_key)
            continue

        block_highs = highs[bs_vis: be_vis + 1]
        block_lows = lows[bs_vis: be_vis + 1]
        first_sar = float(sar_w[bs_w])

        if is_buy:
            price_lo = float(block_lows.min())
            price_hi = first_sar
        else:
            price_lo = first_sar
            price_hi = float(block_highs.max())

        if price_hi <= price_lo:
            drawn_blocks.add(block_key)
            continue

        # date range for box (use actual date strings)
        left_date = dates[bs_vis].strftime("%Y-%m-%d")
        right_date = dates[be_vis].strftime("%Y-%m-%d")

        h = price_hi - price_lo
        q_levels = [
            round(price_lo + 0.25 * h, 4),
            round(price_lo + 0.50 * h, 4),
            round(price_lo + 0.75 * h, 4),
        ]

        boxes.append({
            "side": "buy" if is_buy else "sell",
            "color": PIN_BUY if is_buy else PIN_SELL,
            "price_lo": round(price_lo, 4),
            "price_hi": round(price_hi, 4),
            "q_levels": q_levels,
            "left_date": left_date,
            "right_date": right_date,
        })
        drawn_blocks.add(block_key)

    return boxes


def build_analytics(trades: dict[tuple, dict], suffix: str = ".SR") -> dict:
    """Compute per-symbol and aggregate analytics including quartile stats."""
    suffix = suffix.strip()
    buy_pq_total = buy_q_total = sell_pq_total = sell_q_total = 0.0
    wins = losses = completed = ongoing_count = 0
    equity = 0.0
    peak = 0.0
    max_dd = 0.0

    symbol_stats: dict[str, dict] = {}

    for (tid, sym), info in trades.items():
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

        buy_pq_total += buy_pq
        buy_q_total += buy_q
        sell_pq_total += sell_pq
        sell_q_total += sell_q

        if info["status"] == "completed":
            completed += 1
            pl = sell_pq - buy_pq
            equity += pl
            peak = max(peak, equity)
            max_dd = max(max_dd, peak - equity)
            if pl >= 0:
                wins += 1
            else:
                losses += 1
        else:
            ongoing_count += 1

        if sym not in symbol_stats:
            symbol_stats[sym] = {"trades": 0, "pl": 0.0, "ongoing": 0}
        symbol_stats[sym]["trades"] += 1
        if info["status"] == "completed":
            symbol_stats[sym]["pl"] += sell_pq - buy_pq
        else:
            symbol_stats[sym]["ongoing"] += 1

    total = completed + ongoing_count
    return {
        "total_trades": total,
        "completed_trades": completed,
        "ongoing_trades": ongoing_count,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wins / completed * 100, 2) if completed > 0 else 0.0,
        # realized P&L over COMPLETED trades only. sell_pq_total - buy_pq_total
        # would subtract ongoing trades' open buys (no matching sell yet),
        # dragging the total wildly negative.
        "total_pl": round(equity, 2),
        "avg_buy": round(buy_pq_total / buy_q_total, 4) if buy_q_total > 0 else None,
        "avg_sell": round(sell_pq_total / sell_q_total, 4) if sell_q_total > 0 else None,
        "max_drawdown": round(max_dd, 2),
        "symbol_breakdown": [
            {"symbol": sym, "trades": v["trades"], "pl": round(v["pl"], 2), "ongoing": v["ongoing"]}
            for sym, v in symbol_stats.items()
        ],
    }


def _exec_date(order: dict) -> "pd.Timestamp":
    d = order["exec_date"]
    if isinstance(d, datetime):
        return pd.Timestamp(d.date())
    return pd.Timestamp(pd.Timestamp(d).date())


def compute_correct_executions(
    trades: dict[tuple, dict],
    suffix: str = ".SR",
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    """
    Percentage of executions placed on the "correct" side of the PSAR trend:
      - a BUY  is correct when the PSAR trend on its execution date is a downtrend
      - a SELL is correct when the PSAR trend on its execution date is an uptrend
    (Same trend convention as the chart quartile boxes.)

    Only executions whose date falls within [from_date, to_date] inclusive are
    counted. Both bounds optional. Symbols whose market data can't be fetched are
    skipped and reported in `skipped_symbols`.
    """
    suffix = suffix.strip()
    range_from = pd.Timestamp(from_date) if from_date else None
    range_to = pd.Timestamp(to_date) if to_date else None

    # Group by symbol so each ticker is fetched once. Track both the orders and
    # the entry/exit span so the OHLCV window matches the chart's window — PSAR
    # is path-dependent from index 0, so the trend sign at a given date only
    # agrees with the chart if both use the same (entry-120d, exit+120d) window.
    by_symbol: dict[str, dict] = {}
    for (tid, sym), info in trades.items():
        g = by_symbol.setdefault(sym, {"orders": [], "entries": [], "exits": []})
        # carry the trade_id alongside each order so the per-execution rows can
        # link back to the trade's chart.
        g["orders"].extend((tid, o) for o in info["orders"])
        if info["entry_date"]:
            g["entries"].append(info["entry_date"])
        exit_d = info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
        g["exits"].append(exit_d)

    total = correct = 0
    buy_total = buy_correct = 0
    sell_total = sell_correct = 0
    skipped: list[str] = []
    # Quartile distribution of CORRECT executions within their PSAR trend block
    # (same box geometry as the chart's quartile boxes). 1 = lowest band, 4 = highest.
    quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    buy_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    sell_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    # per-execution detail rows so the UI can list correct/wrong executions and
    # link each to its trade chart.
    executions: list[dict] = []

    for sym, g in by_symbol.items():
        # executions in range for this symbol
        rel = []
        for tid, o in g["orders"]:
            if o["exec_price"] is None:
                continue
            ed = _exec_date(o)
            if range_from is not None and ed < range_from:
                continue
            if range_to is not None and ed > range_to:
                continue
            rel.append((ed, tid, o))
        if not rel or not g["entries"]:
            continue

        ticker = f"{sym}{suffix}"
        # Window keyed on entry/exit dates (same as chart), NOT exec dates.
        earliest = min(g["entries"])
        latest = max(g["exits"])
        try:
            df_wide = fetch_wide(ticker, earliest, latest)
        except Exception:
            skipped.append(sym)
            continue

        highs = df_wide["High"].values.astype(float)
        lows = df_wide["Low"].values.astype(float)
        sar_w, trend_w = compute_psar(highs, lows)
        dates = df_wide.index
        n_w = len(df_wide)

        for ed, tid, o in rel:
            i_w = int(np.searchsorted(dates, ed, side="left"))
            i_w = min(i_w, n_w - 1)
            trend = trend_w[i_w]
            is_buy = o["side"] == "1"
            # buy wants downtrend (-1); sell wants uptrend (+1)
            # cast to Python bool: `trend` is a numpy int so the comparison
            # yields numpy.bool_, which json.dumps can't serialize.
            ok = bool((is_buy and trend == -1) or (not is_buy and trend == 1))
            total += 1
            if is_buy:
                buy_total += 1
                if ok:
                    buy_correct += 1
            else:
                sell_total += 1
                if ok:
                    sell_correct += 1
            row_q: int | None = None
            if ok:
                correct += 1
                # quartile of the exec price within its trend block (chart box geometry)
                bs_w, be_w = wide_trend_block(trend_w, i_w)
                first_sar = float(sar_w[bs_w])
                block_lows = lows[bs_w: be_w + 1]
                block_highs = highs[bs_w: be_w + 1]
                if is_buy:
                    price_lo, price_hi = float(block_lows.min()), first_sar
                else:
                    price_lo, price_hi = first_sar, float(block_highs.max())
                q = get_quartile(float(o["exec_price"]), price_lo, price_hi)
                # Quartile numbering differs by side: for buys Q1 is the BOTTOM
                # of the block (low buy price = Q1, get_quartile's natural order);
                # for sells Q1 is the TOP (high sell price = Q1), so invert.
                if not is_buy:
                    q = 5 - q
                q = int(q)
                row_q = q
                quartiles[q] += 1
                if is_buy:
                    buy_quartiles[q] += 1
                else:
                    sell_quartiles[q] += 1

            executions.append({
                "trade_id": tid,
                "symbol": sym,
                "side": "buy" if is_buy else "sell",
                "exec_price": round(float(o["exec_price"]), 4),
                "exec_date": ed.strftime("%Y-%m-%d"),
                "qty": o["qty"],
                "bot_type": o.get("bot_type") or "",
                "correct": ok,
                "quartile": row_q,
            })

    return {
        "total_executions": total,
        "correct_executions": correct,
        "correct_pct": round(correct / total * 100, 2) if total > 0 else 0.0,
        "buy_total": buy_total,
        "buy_correct": buy_correct,
        "buy_pct": round(buy_correct / buy_total * 100, 2) if buy_total > 0 else 0.0,
        "sell_total": sell_total,
        "sell_correct": sell_correct,
        "sell_pct": round(sell_correct / sell_total * 100, 2) if sell_total > 0 else 0.0,
        "from_date": from_date,
        "to_date": to_date,
        "skipped_symbols": skipped,
        # Quartile bands of correct executions (Q1 lowest … Q4 highest in the block).
        "quartiles": {str(k): v for k, v in quartiles.items()},
        "buy_quartiles": {str(k): v for k, v in buy_quartiles.items()},
        "sell_quartiles": {str(k): v for k, v in sell_quartiles.items()},
        # per-execution rows, sorted by date then symbol, for the drill-down UI
        "executions": sorted(executions, key=lambda e: (e["exec_date"], e["symbol"])),
    }
