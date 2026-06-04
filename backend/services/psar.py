import numpy as np
import pandas as pd

PSAR_STEP = 0.02
PSAR_MAX = 0.20
LOOKBACK_DAYS = 120


def compute_psar(
    high: np.ndarray, low: np.ndarray, step: float = PSAR_STEP, max_af: float = PSAR_MAX
) -> tuple[np.ndarray, np.ndarray]:
    """Returns (sar, trend). trend[i] = +1 uptrend, -1 downtrend."""
    n = len(high)
    sar = np.zeros(n)
    trend = np.zeros(n, dtype=int)
    af = step
    ep = low[0]
    sar[0] = high[0]
    trend[0] = -1

    for i in range(1, n):
        prev_trend = trend[i - 1]
        prev_sar = sar[i - 1]

        if prev_trend == 1:
            new_sar = prev_sar + af * (ep - prev_sar)
            new_sar = min(new_sar, low[i - 1], low[max(0, i - 2)])
            if low[i] < new_sar:
                trend[i] = -1
                sar[i] = ep
                ep = low[i]
                af = step
            else:
                trend[i] = 1
                sar[i] = new_sar
                if high[i] > ep:
                    ep = high[i]
                    af = min(af + step, max_af)
        else:
            new_sar = prev_sar + af * (ep - prev_sar)
            new_sar = max(new_sar, high[i - 1], high[max(0, i - 2)])
            if high[i] > new_sar:
                trend[i] = 1
                sar[i] = ep
                ep = high[i]
                af = step
            else:
                trend[i] = -1
                sar[i] = new_sar
                if low[i] < ep:
                    ep = low[i]
                    af = min(af + step, max_af)

    return sar, trend


def wide_trend_block(trend_w: np.ndarray, i_w: int) -> tuple[int, int]:
    """Contiguous trend block in trend_w containing index i_w."""
    t = trend_w[i_w]
    s = i_w
    while s > 0 and trend_w[s - 1] == t:
        s -= 1
    if s == 0:
        first_rev = 0
        for k in range(1, len(trend_w)):
            if trend_w[k] != trend_w[k - 1]:
                first_rev = k
                break
        if i_w >= first_rev and trend_w[first_rev] == t:
            s = first_rev
    e = i_w
    while e < len(trend_w) - 1 and trend_w[e + 1] == t:
        e += 1
    return s, e


def find_psar_cycle(
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


def get_quartile(price: float, price_lo: float, price_hi: float) -> int:
    """Returns 1–4. Q1=lowest band, Q4=highest band."""
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


def compute_chart_window(
    df_wide: pd.DataFrame,
    trend_w: np.ndarray,
    sar_w: np.ndarray,
    entry_date: str,
    exit_date: str,
    orders: list[dict],
) -> tuple[int, int]:
    """Returns (start_i, end_i) inclusive — visible bar range for chart."""
    dates = df_wide.index
    start_i, end_i = find_psar_cycle(dates, trend_w, entry_date, exit_date)

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
