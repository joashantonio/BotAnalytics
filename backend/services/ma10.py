import numpy as np
import pandas as pd

MA_PERIOD = 10
LOOKBACK_DAYS = 120

def compute_ma10(close: np.ndarray, period: int = MA_PERIOD) -> np.ndarray:
    s = pd.Series(close)
    return s.rolling(period).mean().to_numpy()

def compute_trend(close: np.ndarray, ma: np.ndarray) -> np.ndarray:
    n = len(close)
    trend = np.zeros(n, dtype=int)
    prev = -1
    for i in range(n):
        if np.isnan(ma[i]) or close[i] == ma[i]:
            trend[i] = prev
        elif close[i] > ma[i]:
            trend[i] = 1
        else:
            trend[i] = -1
        prev = trend[i]
    return trend

def wide_trend_block(trend_w: np.ndarray, i_w: int) -> tuple[int, int]:
    t = trend_w[i_w]
    s = i_w
    while s > 0 and trend_w[s - 1] == t:
        s -= 1
    e = i_w
    while e < len(trend_w) - 1 and trend_w[e + 1] == t:
        e += 1
    return s, e

def extend_low_below_ma(
    low: np.ndarray, vis_start: int, vis_end: int, ma_level: float
) -> float:
    # Walk outward from [vis_start, vis_end] in both directions, absorbing
    # candles whose low still sits at/below ma_level even if they fall outside
    # the strict trend block (e.g. a same-direction dip interrupted by a brief
    # blip back above the MA10). Stops the moment a candle's low would cross
    # above the MA10 level, so the box never extends past where price actually
    # surfaced.
    best = float(low[vis_start: vis_end + 1].min())

    j = vis_start - 1
    while j >= 0 and low[j] <= ma_level:
        best = min(best, float(low[j]))
        j -= 1

    j = vis_end + 1
    while j < len(low) and low[j] <= ma_level:
        best = min(best, float(low[j]))
        j += 1

    return best

def get_quartile(price: float, price_lo: float, price_hi: float) -> int:
    h = price_hi - price_lo
    if h <= 0:
        return 1
    frac = max(0.0, min((price - price_lo) / h, 1.0))
    if frac < 0.25:
        return 1
    if frac < 0.50:
        return 2
    if frac < 0.75:
        return 3
    return 4

def block_box(
    open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray,
    trend_w: np.ndarray, bs_w: int, be_w: int,
) -> tuple[float, float] | None:
    is_downtrend = trend_w[bs_w] == -1
    start_price = float(open_[bs_w])
    block_lows = low[bs_w: be_w + 1]
    block_highs = high[bs_w: be_w + 1]

    if is_downtrend:
        price_hi = start_price
        price_lo = float(block_lows.min())
    else:
        price_lo = start_price
        price_hi = float(block_highs.max())

    if price_hi <= price_lo:
        return None
    return price_lo, price_hi

def box_levels(price_lo: float, price_hi: float) -> dict:
    rng = price_hi - price_lo
    middle = (rng / 2) + price_lo
    step = rng / 4
    return {
        "upper": round(price_hi, 4),
        "lower": round(price_lo, 4),
        "middle": round(middle, 4),
        "range": round(rng, 4),
        "quartile_step": round(step, 4),
        "first_quartile": round(price_lo + step, 4),
        "second_quartile": round(price_lo + 2 * step, 4),
        "third_quartile": round(price_lo + 3 * step, 4),
        "fourth_quartile": round(price_lo + 4 * step, 4),
    }

def find_ma10_cycle(
    dates: pd.DatetimeIndex, trend: np.ndarray, entry_date: str, exit_date: str
) -> tuple[int, int]:
    entry_dt = pd.Timestamp(entry_date)
    exit_dt = pd.Timestamp(exit_date)

    entry_idx = int(np.searchsorted(dates, entry_dt, side="left"))
    entry_idx = min(entry_idx, len(dates) - 1)
    cycle_trend = trend[entry_idx]

    start = entry_idx
    while start > 0 and trend[start - 1] == cycle_trend:
        start -= 1

    exit_idx = int(np.searchsorted(dates, exit_dt, side="right")) - 1
    exit_idx = max(exit_idx, entry_idx)
    end = exit_idx
    while end < len(dates) - 1 and trend[end + 1] == cycle_trend:
        end += 1

    return start, end

def compute_chart_window(
    df_wide: pd.DataFrame,
    trend_w: np.ndarray,
    entry_date: str,
    exit_date: str,
    orders: list[dict],
) -> tuple[int, int]:
    dates = df_wide.index
    start_i, end_i = find_ma10_cycle(dates, trend_w, entry_date, exit_date)

    for order in orders:
        if order["exec_price"] is None:
            continue
        odt = pd.Timestamp(order["exec_date"].date() if hasattr(order["exec_date"], "date") else order["exec_date"])
        i_w = int(np.searchsorted(dates, odt, side="left"))
        i_w = min(i_w, len(df_wide) - 1)
        bs_w, be_w = wide_trend_block(trend_w, i_w)
        start_i = min(start_i, bs_w)
        end_i = max(end_i, be_w)

    MIN_PAD_BARS = 5
    FALLBACK_PAD = 15

    def _pad_left(s: int) -> int:
        cur = s
        while cur > 0:
            bs, be = wide_trend_block(trend_w, cur - 1)
            cur = bs
            if (be - bs + 1) >= MIN_PAD_BARS:
                return cur
        return max(0, min(cur, s - FALLBACK_PAD)) if cur == 0 else cur

    def _pad_right(e: int) -> int:
        last = len(df_wide) - 1
        cur = e
        while cur < last:
            bs, be = wide_trend_block(trend_w, cur + 1)
            cur = be
            if (be - bs + 1) >= MIN_PAD_BARS:
                return cur
        return min(last, e + FALLBACK_PAD) if cur == last else cur

    return _pad_left(start_i), _pad_right(end_i)
