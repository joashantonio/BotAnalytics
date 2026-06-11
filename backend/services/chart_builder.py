from datetime import datetime

import numpy as np
import pandas as pd

from .market_data import fetch_wide, get_company_name
from .psar import compute_psar, compute_chart_window, wide_trend_block, get_quartile
from . import ma10 as ma10_mod
from . import ma200 as ma200_mod

PIN_BUY = "#00c853"
PIN_SELL = "#f44336"
AVG_BUY = "#ffd600"
AVG_SELL = "#9c27b0"
PSAR_DOT = "#f57f17"
MA10_LINE = "#2962ff"
MA200_LINE = "#e91e63"

def _order_exec_date(order: dict) -> pd.Timestamp:
    d = order["exec_date"]
    if isinstance(d, datetime):
        return pd.Timestamp(d.date())
    return pd.Timestamp(d)

def _last_exec_index_in_block(
    orders, df_wide: "pd.DataFrame", bs_w: int, be_w: int, start_i: int
) -> int | None:
    """Local (df-relative) index of the latest execution date that falls
    within the wide-index block [bs_w, be_w], or None if no order does."""
    last_w = None
    for order in orders:
        if order["exec_price"] is None:
            continue
        odt = _order_exec_date(order)
        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if bs_w <= i_w <= be_w:
            if last_w is None or i_w > last_w:
                last_w = i_w
    if last_w is None:
        return None
    return last_w - start_i

def _widen_window_for_range(
    df_wide: "pd.DataFrame", start_i: int, end_i: int, from_date: str | None, to_date: str | None
) -> tuple[int, int]:
    if not from_date and not to_date:
        return start_i, end_i

    last = len(df_wide) - 1
    dates = df_wide.index

    if from_date:
        fi = int(np.searchsorted(dates, pd.Timestamp(from_date), side="left"))
        start_i = min(start_i, min(fi, last))
    if to_date:
        ti = int(np.searchsorted(dates, pd.Timestamp(to_date), side="right")) - 1
        end_i = max(end_i, max(0, min(ti, last)))

    return start_i, end_i

def build_chart_data(
    trade_info: dict,
    suffix: str = ".SR",
    _df_wide_override: "pd.DataFrame | None" = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
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
    start_i, end_i = _widen_window_for_range(df_wide, start_i, end_i, from_date, to_date)
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

    sar = sar_w[start_i: end_i + 1]

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

    psar_series = []
    for i, date in enumerate(dates):
        psar_series.append({"time": date.strftime("%Y-%m-%d"), "value": round(float(sar[i]), 4)})

    entry_dt = pd.Timestamp(entry_date)
    entry_xi = int(np.searchsorted(dates, entry_dt, side="left"))
    entry_xi = max(0, min(entry_xi, len(df) - 1))
    cycle_direction = "Uptrend" if trend[entry_xi] == 1 else "Downtrend"

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

    realized_pl = None
    if status == "completed" and buy_q > 0 and sell_q > 0:
        realized_pl = round(sell_pq - buy_pq, 2)

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
    drawn_blocks: set[tuple] = set()
    boxes = []

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

        # Don't draw the box past the last execution that falls inside this block.
        last_exec_local = _last_exec_index_in_block(orders, df_wide, bs_w, be_w, start_i)
        if last_exec_local is not None:
            be_vis = min(be_vis, max(bs_vis, last_exec_local))

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

def build_chart_data_ma10(
    trade_info: dict,
    suffix: str = ".SR",
    _df_wide_override: "pd.DataFrame | None" = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    suffix = suffix.strip()
    ticker = f"{trade_info['symbol']}{suffix}"
    orders = trade_info["orders"]
    entry_date = trade_info["entry_date"]
    exit_date = trade_info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
    status = trade_info["status"]

    df_wide = _df_wide_override if _df_wide_override is not None else fetch_wide(ticker, entry_date, exit_date)
    closes_w = df_wide["Close"].values.astype(float)
    ma_w = ma10_mod.compute_ma10(closes_w)
    trend_w = ma10_mod.compute_trend(closes_w, ma_w)

    start_i, end_i = ma10_mod.compute_chart_window(df_wide, trend_w, entry_date, exit_date, orders)
    start_i, end_i = _widen_window_for_range(df_wide, start_i, end_i, from_date, to_date)
    df = df_wide.iloc[start_i: end_i + 1].copy()

    if df.empty:
        raise ValueError("Empty chart window after MA10 cycle detection")

    opens = df["Open"].values.astype(float)
    highs = df["High"].values.astype(float)
    lows = df["Low"].values.astype(float)
    closes = df["Close"].values.astype(float)
    volumes = df["Volume"].values.astype(float)
    dates = df.index
    trend = trend_w[start_i: end_i + 1]
    ma = ma_w[start_i: end_i + 1]

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

    ma10_series = []
    for i, date in enumerate(dates):
        if np.isnan(ma[i]):
            continue
        ma10_series.append({"time": date.strftime("%Y-%m-%d"), "value": round(float(ma[i]), 4)})

    entry_dt = pd.Timestamp(entry_date)
    entry_xi = int(np.searchsorted(dates, entry_dt, side="left"))
    entry_xi = max(0, min(entry_xi, len(df) - 1))
    cycle_direction = "Uptrend" if trend[entry_xi] == 1 else "Downtrend"

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

    realized_pl = None
    if status == "completed" and buy_q > 0 and sell_q > 0:
        realized_pl = round(sell_pq - buy_pq, 2)

    quartile_boxes = _build_quartile_boxes_ma10(
        orders, df_wide, df, trend_w, ma_w,
        lows, closes, dates, start_i, end_i, status,
    )
    quartile_levels = _latest_ma10_quartile_levels(orders, df_wide, trend_w, ma_w, status)

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
        "ma10": ma10_series,
        "buy_markers": buy_markers,
        "sell_markers": sell_markers,
        "avg_buy": avg_buy_val,
        "avg_sell": avg_sell_val,
        "realized_pl": realized_pl,
        "buy_qty": buy_q,
        "sell_qty": sell_q,
        "net_qty": round(buy_q - sell_q, 4),
        "quartile_boxes": quartile_boxes,
        "quartile_levels": quartile_levels,
    }

def _build_quartile_boxes_ma10(
    orders, df_wide, df, trend_w, ma_w,
    lows, closes, dates, start_i, end_i, status
) -> list[dict]:
    # MA10 analogue of _build_quartile_boxes. A buy's box spans the contiguous
    # "submerged" run (closes below MA10 → trend == -1): left edge at the first
    # submerged candle, right edge at the last candle before price resurfaces.
    # The box top sits on the MA10 line at the first submerged candle; the
    # bottom is the lowest low of the submerged candles. Sells mirror it across
    # an above-MA10 run (trend == 1).
    drawn_blocks: set[tuple] = set()
    boxes = []

    # For ongoing trades, anchor the box on the block containing the
    # earliest qualifying order, so it starts at the beginning of the
    # current trend rather than a later same-direction blip.
    target_block: dict[str, tuple] = {}
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
                bs_w, be_w = ma10_mod.wide_trend_block(trend_w, i_w)
                if side not in target_block or bs_w < target_block[side][0]:
                    target_block[side] = (bs_w, be_w)

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

        bs_w, be_w = ma10_mod.wide_trend_block(trend_w, i_w)
        block_key = (bs_w, be_w)

        if status == "ongoing" and block_key != target_block.get(order["side"]):
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

        # Don't draw the box past the last execution that falls inside this block.
        last_exec_local = _last_exec_index_in_block(orders, df_wide, bs_w, be_w, start_i)
        if last_exec_local is not None:
            be_vis = min(be_vis, max(bs_vis, last_exec_local))

        block_lows = lows[bs_vis: be_vis + 1]
        block_closes = closes[bs_vis: be_vis + 1]
        # MA10 line value at the first candle of the block — the box's flat edge
        # against the indicator (top for a buy/below run, bottom for a sell).
        first_ma = float(ma_w[bs_w])
        if np.isnan(first_ma):
            drawn_blocks.add(block_key)
            continue

        if is_buy:
            price_lo = float(block_lows.min())
            price_hi = first_ma
        else:
            price_lo = first_ma
            # Q1 edge: close of the candle with the lowest low in the block.
            price_hi = float(block_closes[int(np.argmin(block_lows))])

        if price_hi <= price_lo:
            drawn_blocks.add(block_key)
            continue

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

def _latest_ma10_quartile_levels(
    orders, df_wide, trend_w, ma_w, status
) -> dict | None:
    latest_order_i_w: int = -1
    latest_block: tuple[int, int] | None = None
    touching_i_ws: list[int] = []

    for order in orders:
        if order["exec_price"] is None:
            continue
        is_buy = order["side"] == "1"
        expected_trend = -1 if is_buy else 1
        odt = _order_exec_date(order)

        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if trend_w[i_w] != expected_trend:
            continue

        if i_w > latest_order_i_w:
            latest_order_i_w = i_w
            latest_block = ma10_mod.wide_trend_block(trend_w, i_w)

    if latest_block is None:
        return None

    bs_w, be_w = latest_block

    for order in orders:
        if order["exec_price"] is None:
            continue
        is_buy = order["side"] == "1"
        expected_trend = -1 if is_buy else 1
        odt = _order_exec_date(order)
        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if trend_w[i_w] != expected_trend:
            continue
        if bs_w <= i_w <= be_w:
            touching_i_ws.append(i_w)

    span_end = min(be_w, max(touching_i_ws)) if touching_i_ws else be_w

    wide_highs = df_wide["High"].values.astype(float)
    wide_lows = df_wide["Low"].values.astype(float)

    is_downtrend = trend_w[bs_w] == -1

    start_price = float(ma_w[bs_w])
    if np.isnan(start_price):
        return None
    block_lows = wide_lows[bs_w: span_end + 1]
    block_highs = wide_highs[bs_w: span_end + 1]

    if is_downtrend:
        price_hi = start_price
        price_lo = float(block_lows.min())
    else:
        price_lo = start_price
        price_hi = float(block_highs.max())

    if price_hi <= price_lo:
        return None

    return ma10_mod.box_levels(price_lo, price_hi)

def build_chart_data_ma200(
    trade_info: dict,
    suffix: str = ".SR",
    _df_wide_override: "pd.DataFrame | None" = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    suffix = suffix.strip()
    ticker = f"{trade_info['symbol']}{suffix}"
    orders = trade_info["orders"]
    entry_date = trade_info["entry_date"]
    exit_date = trade_info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
    status = trade_info["status"]

    df_wide = _df_wide_override if _df_wide_override is not None else fetch_wide(ticker, entry_date, exit_date, lookback_days=ma200_mod.LOOKBACK_DAYS)
    closes_w = df_wide["Close"].values.astype(float)
    ma_w = ma200_mod.compute_ma200(closes_w)
    trend_w = ma200_mod.compute_trend(closes_w, ma_w)

    start_i, end_i = ma200_mod.compute_chart_window(df_wide, trend_w, entry_date, exit_date, orders)
    start_i, end_i = _widen_window_for_range(df_wide, start_i, end_i, from_date, to_date)
    df = df_wide.iloc[start_i: end_i + 1].copy()

    if df.empty:
        raise ValueError("Empty chart window after MA200 cycle detection")

    opens = df["Open"].values.astype(float)
    highs = df["High"].values.astype(float)
    lows = df["Low"].values.astype(float)
    closes = df["Close"].values.astype(float)
    volumes = df["Volume"].values.astype(float)
    dates = df.index
    trend = trend_w[start_i: end_i + 1]
    ma = ma_w[start_i: end_i + 1]

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

    ma200_series = []
    for i, date in enumerate(dates):
        if np.isnan(ma[i]):
            continue
        ma200_series.append({"time": date.strftime("%Y-%m-%d"), "value": round(float(ma[i]), 4)})

    entry_dt = pd.Timestamp(entry_date)
    entry_xi = int(np.searchsorted(dates, entry_dt, side="left"))
    entry_xi = max(0, min(entry_xi, len(df) - 1))
    cycle_direction = "Uptrend" if trend[entry_xi] == 1 else "Downtrend"

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

    realized_pl = None
    if status == "completed" and buy_q > 0 and sell_q > 0:
        realized_pl = round(sell_pq - buy_pq, 2)

    quartile_boxes = _build_quartile_boxes_ma200(
        orders, df_wide, df, trend_w, ma_w,
        lows, closes, dates, start_i, end_i, status,
    )
    quartile_levels = _latest_ma200_quartile_levels(orders, df_wide, trend_w, ma_w, status)

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
        "ma200": ma200_series,
        "buy_markers": buy_markers,
        "sell_markers": sell_markers,
        "avg_buy": avg_buy_val,
        "avg_sell": avg_sell_val,
        "realized_pl": realized_pl,
        "buy_qty": buy_q,
        "sell_qty": sell_q,
        "net_qty": round(buy_q - sell_q, 4),
        "quartile_boxes": quartile_boxes,
        "quartile_levels": quartile_levels,
    }

def _build_quartile_boxes_ma200(
    orders, df_wide, df, trend_w, ma_w,
    lows, closes, dates, start_i, end_i, status
) -> list[dict]:
    # MA200 analogue of _build_quartile_boxes_ma10. A buy's box spans the
    # contiguous "submerged" run (closes below MA200 → trend == -1): left
    # edge at the first submerged candle, right edge at the last candle
    # before price resurfaces. The box top sits on the MA200 line at the
    # first submerged candle; the bottom is the lowest low of the submerged
    # candles. Sells mirror it across an above-MA200 run (trend == 1).
    drawn_blocks: set[tuple] = set()
    boxes = []

    # For ongoing trades, anchor the box on the block containing the
    # earliest qualifying order, so it starts at the beginning of the
    # current trend rather than a later same-direction blip.
    target_block: dict[str, tuple] = {}
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
                bs_w, be_w = ma200_mod.wide_trend_block(trend_w, i_w)
                if side not in target_block or bs_w < target_block[side][0]:
                    target_block[side] = (bs_w, be_w)

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

        bs_w, be_w = ma200_mod.wide_trend_block(trend_w, i_w)
        block_key = (bs_w, be_w)

        if status == "ongoing" and block_key != target_block.get(order["side"]):
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

        # Don't draw the box past the last execution that falls inside this block.
        last_exec_local = _last_exec_index_in_block(orders, df_wide, bs_w, be_w, start_i)
        if last_exec_local is not None:
            be_vis = min(be_vis, max(bs_vis, last_exec_local))

        # MA200 line value at the first candle of the block — the box's flat edge
        # against the indicator (top for a buy/below run, bottom for a sell).
        # If the block's start is cut off by the fetch window (MA200 needs 200
        # prior bars), fall back to the first bar in the block with a valid MA200.
        anchor_w = bs_w
        while anchor_w <= be_w and np.isnan(ma_w[anchor_w]):
            anchor_w += 1
        if anchor_w > be_w:
            drawn_blocks.add(block_key)
            continue
        first_ma = float(ma_w[anchor_w])

        anchor_vis = max(anchor_w - start_i, 0)
        if anchor_vis > be_vis:
            drawn_blocks.add(block_key)
            continue
        block_lows = lows[anchor_vis: be_vis + 1]
        block_closes = closes[anchor_vis: be_vis + 1]

        if is_buy:
            price_lo = float(block_lows.min())
            price_hi = first_ma
        else:
            price_lo = first_ma
            # Q1 edge: close of the candle with the lowest low in the block.
            price_hi = float(block_closes[int(np.argmin(block_lows))])

        if price_hi <= price_lo:
            drawn_blocks.add(block_key)
            continue

        left_date = dates[anchor_vis].strftime("%Y-%m-%d")
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

def _latest_ma200_quartile_levels(
    orders, df_wide, trend_w, ma_w, status
) -> dict | None:
    latest_order_i_w: int = -1
    latest_block: tuple[int, int] | None = None
    touching_i_ws: list[int] = []

    for order in orders:
        if order["exec_price"] is None:
            continue
        is_buy = order["side"] == "1"
        expected_trend = -1 if is_buy else 1
        odt = _order_exec_date(order)

        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if trend_w[i_w] != expected_trend:
            continue

        if i_w > latest_order_i_w:
            latest_order_i_w = i_w
            latest_block = ma200_mod.wide_trend_block(trend_w, i_w)

    if latest_block is None:
        return None

    bs_w, be_w = latest_block

    for order in orders:
        if order["exec_price"] is None:
            continue
        is_buy = order["side"] == "1"
        expected_trend = -1 if is_buy else 1
        odt = _order_exec_date(order)
        i_w = int(np.searchsorted(df_wide.index, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        if trend_w[i_w] != expected_trend:
            continue
        if bs_w <= i_w <= be_w:
            touching_i_ws.append(i_w)

    span_end = min(be_w, max(touching_i_ws)) if touching_i_ws else be_w

    wide_highs = df_wide["High"].values.astype(float)
    wide_lows = df_wide["Low"].values.astype(float)

    is_downtrend = trend_w[bs_w] == -1

    start_price = float(ma_w[bs_w])
    if np.isnan(start_price):
        return None
    block_lows = wide_lows[bs_w: span_end + 1]
    block_highs = wide_highs[bs_w: span_end + 1]

    if is_downtrend:
        price_hi = start_price
        price_lo = float(block_lows.min())
    else:
        price_lo = start_price
        price_hi = float(block_highs.max())

    if price_hi <= price_lo:
        return None

    return ma200_mod.box_levels(price_lo, price_hi)

def build_analytics(trades: dict[tuple, dict], suffix: str = ".SR") -> dict:
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
    mode: str = "psar",
) -> dict:
    if mode == "ma10":
        return _compute_correct_executions_ma10(trades, suffix=suffix, from_date=from_date, to_date=to_date)
    if mode == "ma200":
        return _compute_correct_executions_ma200(trades, suffix=suffix, from_date=from_date, to_date=to_date)

    suffix = suffix.strip()
    range_from = pd.Timestamp(from_date) if from_date else None
    range_to = pd.Timestamp(to_date) if to_date else None

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

    quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    buy_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    sell_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    # per-execution detail rows so the UI can list correct/wrong executions and
    # link each to its trade chart.
    executions: list[dict] = []

    for sym, g in by_symbol.items():

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

                bs_w, be_w = wide_trend_block(trend_w, i_w)
                first_sar = float(sar_w[bs_w])
                block_lows = lows[bs_w: be_w + 1]
                block_highs = highs[bs_w: be_w + 1]
                if is_buy:
                    price_lo, price_hi = float(block_lows.min()), first_sar
                else:
                    price_lo, price_hi = first_sar, float(block_highs.max())
                q = get_quartile(float(o["exec_price"]), price_lo, price_hi)

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

        "quartiles": {str(k): v for k, v in quartiles.items()},
        "buy_quartiles": {str(k): v for k, v in buy_quartiles.items()},
        "sell_quartiles": {str(k): v for k, v in sell_quartiles.items()},
        # per-execution rows, sorted by date then symbol, for the drill-down UI
        "executions": sorted(executions, key=lambda e: (e["exec_date"], e["symbol"])),
    }

def _compute_correct_executions_ma10(
    trades: dict[tuple, dict],
    suffix: str = ".SR",
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    suffix = suffix.strip()
    range_from = pd.Timestamp(from_date) if from_date else None
    range_to = pd.Timestamp(to_date) if to_date else None

    by_symbol: dict[str, dict] = {}
    for (tid, sym), info in trades.items():
        g = by_symbol.setdefault(sym, {"orders": [], "entries": [], "exits": []})
        g["orders"].extend((tid, o) for o in info["orders"])
        if info["entry_date"]:
            g["entries"].append(info["entry_date"])
        exit_d = info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
        g["exits"].append(exit_d)

    total = correct = 0
    buy_total = buy_correct = 0
    sell_total = sell_correct = 0
    skipped: list[str] = []
    quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    buy_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    sell_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    # per-execution detail rows so the UI can list correct/wrong executions and
    # link each to its trade chart (same shape as the psar path).
    executions: list[dict] = []

    for sym, g in by_symbol.items():
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
        earliest = min(g["entries"])
        latest = max(g["exits"])
        try:
            df_wide = fetch_wide(ticker, earliest, latest)
        except Exception:
            skipped.append(sym)
            continue

        opens = df_wide["Open"].values.astype(float)
        highs = df_wide["High"].values.astype(float)
        lows = df_wide["Low"].values.astype(float)
        closes = df_wide["Close"].values.astype(float)
        ma_w = ma10_mod.compute_ma10(closes)
        trend_w = ma10_mod.compute_trend(closes, ma_w)
        dates = df_wide.index
        n_w = len(df_wide)

        for ed, tid, o in rel:
            i_w = int(np.searchsorted(dates, ed, side="left"))
            i_w = min(i_w, n_w - 1)
            is_buy = o["side"] == "1"
            close = closes[i_w]
            ma = ma_w[i_w]
            if np.isnan(ma):
                continue
            # cast to Python bool: numpy.bool_ isn't JSON-serializable.
            ok = bool((is_buy and close < ma) or (not is_buy and close > ma))
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
                expected_trend = -1 if is_buy else 1
                if trend_w[i_w] == expected_trend:
                    bs_w, be_w = ma10_mod.wide_trend_block(trend_w, i_w)
                    edges = ma10_mod.block_box(opens, highs, lows, closes, trend_w, bs_w, be_w)
                    if edges is not None:
                        price_lo, price_hi = edges
                        q = ma10_mod.get_quartile(float(o["exec_price"]), price_lo, price_hi)
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
        "quartiles": {str(k): v for k, v in quartiles.items()},
        "buy_quartiles": {str(k): v for k, v in buy_quartiles.items()},
        "sell_quartiles": {str(k): v for k, v in sell_quartiles.items()},
        # per-execution rows, sorted by date then symbol, for the drill-down UI
        "executions": sorted(executions, key=lambda e: (e["exec_date"], e["symbol"])),
    }

def _compute_correct_executions_ma200(
    trades: dict[tuple, dict],
    suffix: str = ".SR",
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    suffix = suffix.strip()
    range_from = pd.Timestamp(from_date) if from_date else None
    range_to = pd.Timestamp(to_date) if to_date else None

    by_symbol: dict[str, dict] = {}
    for (tid, sym), info in trades.items():
        g = by_symbol.setdefault(sym, {"orders": [], "entries": [], "exits": []})
        g["orders"].extend((tid, o) for o in info["orders"])
        if info["entry_date"]:
            g["entries"].append(info["entry_date"])
        exit_d = info.get("exit_date") or pd.Timestamp.today().strftime("%Y-%m-%d")
        g["exits"].append(exit_d)

    total = correct = 0
    buy_total = buy_correct = 0
    sell_total = sell_correct = 0
    skipped: list[str] = []
    quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    buy_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    sell_quartiles = {1: 0, 2: 0, 3: 0, 4: 0}
    # per-execution detail rows so the UI can list correct/wrong executions and
    # link each to its trade chart (same shape as the psar path).
    executions: list[dict] = []

    for sym, g in by_symbol.items():
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
        earliest = min(g["entries"])
        latest = max(g["exits"])
        try:
            df_wide = fetch_wide(ticker, earliest, latest, lookback_days=ma200_mod.LOOKBACK_DAYS)
        except Exception:
            skipped.append(sym)
            continue

        opens = df_wide["Open"].values.astype(float)
        highs = df_wide["High"].values.astype(float)
        lows = df_wide["Low"].values.astype(float)
        closes = df_wide["Close"].values.astype(float)
        ma_w = ma200_mod.compute_ma200(closes)
        trend_w = ma200_mod.compute_trend(closes, ma_w)
        dates = df_wide.index
        n_w = len(df_wide)

        for ed, tid, o in rel:
            i_w = int(np.searchsorted(dates, ed, side="left"))
            i_w = min(i_w, n_w - 1)
            is_buy = o["side"] == "1"
            close = closes[i_w]
            ma = ma_w[i_w]
            if np.isnan(ma):
                continue
            # cast to Python bool: numpy.bool_ isn't JSON-serializable.
            ok = bool((is_buy and close < ma) or (not is_buy and close > ma))
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
                expected_trend = -1 if is_buy else 1
                if trend_w[i_w] == expected_trend:
                    bs_w, be_w = ma200_mod.wide_trend_block(trend_w, i_w)
                    edges = ma200_mod.block_box(opens, highs, lows, closes, trend_w, bs_w, be_w)
                    if edges is not None:
                        price_lo, price_hi = edges
                        q = ma200_mod.get_quartile(float(o["exec_price"]), price_lo, price_hi)
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
        "quartiles": {str(k): v for k, v in quartiles.items()},
        "buy_quartiles": {str(k): v for k, v in buy_quartiles.items()},
        "sell_quartiles": {str(k): v for k, v in sell_quartiles.items()},
        # per-execution rows, sorted by date then symbol, for the drill-down UI
        "executions": sorted(executions, key=lambda e: (e["exec_date"], e["symbol"])),
    }
