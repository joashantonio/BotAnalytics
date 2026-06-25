import json
import logging
import os
from datetime import timedelta

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# Cap the yfinance HTTP fetch so a slow/unresponsive upstream can't hang a
# worker indefinitely (these run in a thread-pool executor off the event loop).
_YF_TIMEOUT = int(os.getenv("YF_TIMEOUT", "20"))

_OHLCV_COLS = ["Open", "High", "Low", "Close", "Volume"]

# Known Saudi Exchange (Tadawul, ".SR") market-break windows (inclusive).
# yfinance forward-fills these as stale rows with Volume == 0 rather than
# omitting them, so we strip them explicitly. Kept as a backstop in addition
# to the generic zero-volume filter below — sourced from Tadawul holiday
# calendar (Eid Al-Fitr, Eid Al-Adha, Founding Day, National Day).
#   2026-03-19..03-22  Eid Al-Fitr
#   2026-05-24..05-28  Eid Al-Adha (Arafat + Eid)
MARKET_BREAKS = [
    ("2026-03-19", "2026-03-22"),
    ("2026-05-24", "2026-05-28"),
]

def _drop_market_breaks(df: pd.DataFrame) -> pd.DataFrame:
    # Generic filter: any candle with zero volume is a non-trading day that
    # yfinance forward-filled (flat OHLC). These corrupt PSAR/MA indicators,
    # so drop every interior zero-volume row regardless of date.
    if "Volume" in df.columns:
        df = df[df["Volume"] > 0]
    # Explicit backstop for known break windows, in case a real partial-volume
    # row slips through on a closure date.
    for start, end in MARKET_BREAKS:
        mask = (df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))
        if mask.any():
            df = df[~mask]
    return df

def _df_to_json(df: pd.DataFrame) -> str:
    cols = [c for c in _OHLCV_COLS if c in df.columns]
    payload = {
        "index": [d.strftime("%Y-%m-%d") for d in df.index],
        "columns": cols,
        "data": [[float(df[c].iloc[i]) for c in cols] for i in range(len(df))],
    }
    return json.dumps(payload)

def _json_to_df(raw: str) -> pd.DataFrame:
    payload = json.loads(raw)
    df = pd.DataFrame(payload["data"], columns=payload["columns"])
    df.index = pd.to_datetime(payload["index"])
    return df

def _download_ohlcv(ticker: str, from_date: str, to_date: str) -> pd.DataFrame:
    # auto_adjust=False: real (unadjusted) historical prices. Adjusted prices
    # are back-corrected for dividends/splits and drift away from what brokers
    # actually executed at, so adjusted candles can sit below a real execution
    # price recorded around the same date.
    df = yf.download(
        ticker, start=from_date, end=to_date,
        interval="1d", auto_adjust=False, progress=False,
        timeout=_YF_TIMEOUT,
    )
    if df.empty:
        raise ValueError(f"No market data for {ticker!r}")
    if hasattr(df.columns, "levels"):
        df.columns = df.columns.get_level_values(0)
    df.index = pd.to_datetime(df.index)
    if df.index.tz is not None:
        df.index = df.index.tz_convert(None)

    vol = df["Volume"].values.astype(float)
    last_real = len(df) - 1
    while last_real > 0 and vol[last_real] == 0:
        last_real -= 1
    return df.iloc[: last_real + 1]

# yfinance intermittently returns wrong / inconsistently-adjusted prices for a
# Tadawul ticker:
#   4180.SR  came back ~95 and ~32 when its real price is ~2.4
#   2190.SR  came back ~93 when its real price is ~33
#   4050.SR  came back as a SINGLE window mixing a ~122 segment and a ~57
#            segment (split-adjustment artifact) when executions are ~50
# The bad response gets cached and the chart shows wrong-scale candles forever.
#
# Validation: the candle ON each execution date must straddle that execution's
# price (every real fill happened between that day's low and high). This is the
# tightest possible check — it catches uniform wrong-scale AND mixed-scale
# windows that a single global low–high band swallows (4050.SR's 122-high
# segment widened the band enough to accept a 50 exec). A small pad absorbs
# rounding and pre/post-market fills just outside the regular-session range.
EXEC_BAND_PAD = 0.10  # accept exec within [day_low*(1-pad), day_high*(1+pad)]

# Special case: 8230.SR. This one ticker's CSV records some fills at twice the
# real per-share price (broker booked a pre-split fill at 2x the post-split
# candle scale), so an exec sits at ~2x its day's candle and fails the band
# check. ONLY for this ticker we accept the exec if HALF of it fits the candle
# and renormalize that fill to exec/2 everywhere it's plotted/aggregated. Every
# other ticker keeps the strict refuse-wrong-scale behavior.
HALF_SCALE_TICKERS = {"8230.SR"}
EXEC_HALF_DIVISOR = 2.0


def _band_ok(price: float, lo: float, hi: float) -> bool:
    return lo * (1.0 - EXEC_BAND_PAD) <= price <= hi * (1.0 + EXEC_BAND_PAD)


def _exec_scale_factor(price: float, lo: float, hi: float, allow_half: bool) -> float | None:
    """Factor to multiply `price` by so it fits the [lo, hi] candle band, or
    None if it doesn't fit.

    Returns 1.0 when the raw price already fits. When allow_half (the 8230.SR
    special case), also returns 0.5 if only price/2 fits."""
    if _band_ok(price, lo, hi):
        return 1.0
    if allow_half and _band_ok(price / EXEC_HALF_DIVISOR, lo, hi):
        return 1.0 / EXEC_HALF_DIVISOR
    return None


def snapped_exec_scale_factor(
    ticker: str, df: pd.DataFrame, exec_date: "pd.Timestamp", price: float
) -> float:
    """Scale factor for one fill, matched to the candle the chart actually snaps
    it to (np.searchsorted into df.index), not an exact-date band lookup.

    A fill on a non-trading day (holiday) has no exact-date candle; the chart
    still draws its marker on the nearest candle, so the rescale must use that
    same candle — otherwise the marker is halved but the avg/P&L keeps the raw
    2x price and the Avg Buy line floats above every buy. Returns 1.0 (no
    rescale) for non-8230 tickers, empty df, or when neither raw nor /2 fits."""
    if (
        ticker not in HALF_SCALE_TICKERS
        or df.empty
        or price is None
        or price <= 0
        or "Low" not in df.columns
        or "High" not in df.columns
    ):
        return 1.0
    i = int(np.searchsorted(df.index, exec_date, side="left"))
    i = max(0, min(i, len(df) - 1))
    lo = float(df["Low"].values[i])
    hi = float(df["High"].values[i])
    if lo <= 0 or hi <= 0:
        return 1.0
    f = _exec_scale_factor(price, lo, hi, allow_half=True)
    return f if f is not None else 1.0


def _execs_match_candles(
    ticker: str, df: pd.DataFrame, ref_points: "list[tuple[str, float]] | None"
) -> bool:
    """True if each (exec_date, exec_price) sits within that date's candle. For
    8230.SR a fill also matches if its halved price fits (a pre-split fill booked
    at 2x scale); every other ticker requires the raw price to fit.

    Only dates present in the fetched data are checked (an exec on a day with
    no candle — holiday, pre-listing — is skipped, not a failure). If NONE of
    the exec dates are present, fall back to accepting (can't validate)."""
    if not ref_points or df.empty or "Low" not in df.columns or "High" not in df.columns:
        return True
    allow_half = ticker in HALF_SCALE_TICKERS
    # Map date-string -> (low, high) for O(1) lookup.
    idx = [d.strftime("%Y-%m-%d") for d in df.index]
    lows = df["Low"].values.astype(float)
    highs = df["High"].values.astype(float)
    band = {idx[i]: (float(lows[i]), float(highs[i])) for i in range(len(idx))}

    for date_str, price in ref_points:
        if price is None or price <= 0:
            continue
        lh = band.get(date_str)
        if lh is None:
            continue  # no candle that day -> can't check this exec
        lo, hi = lh
        if lo <= 0 or hi <= 0:
            continue
        if _exec_scale_factor(price, lo, hi, allow_half) is None:
            return False  # this fill couldn't have happened in this candle
    return True  # all checkable execs matched (or none were checkable)


def fetch_ohlcv(
    ticker: str,
    from_date: str,
    to_date: str,
    ref_points: "list[tuple[str, float]] | None" = None,
) -> pd.DataFrame:
    # If to_date is in the future, clamp it to tomorrow (today + 1 day) so we don't cache future dates
    # and ensure today's candle is always included since yfinance download end is exclusive.
    tomorrow_str = (pd.Timestamp.today() + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    if to_date > tomorrow_str:
        to_date = tomorrow_str

    from ..cache import get_ohlcv, set_ohlcv, del_ohlcv

    cached = get_ohlcv(ticker, from_date, to_date)
    if cached is not None:
        df_cached = _json_to_df(cached)
        if _execs_match_candles(ticker, df_cached, ref_points):
            return _drop_market_breaks(df_cached)
        # Cached row is wrong-scale (stale bad yfinance response) -> evict + refetch.
        del_ohlcv(ticker, from_date, to_date)

    df = _download_ohlcv(ticker, from_date, to_date)
    if not _execs_match_candles(ticker, df, ref_points):
        # One retry: transient wrong/mis-adjusted response from yfinance.
        df = _download_ohlcv(ticker, from_date, to_date)
        if not _execs_match_candles(ticker, df, ref_points):
            logger.warning("Execution-band validation failed for %s after retry", ticker)
            raise ValueError(
                f"Market data for {ticker!r} failed execution-band validation "
                f"(an execution price fell outside its day's candle); "
                f"refusing to chart wrong-scale candles"
            )
    set_ohlcv(ticker, from_date, to_date, _df_to_json(df))
    return _drop_market_breaks(df)

def get_company_name(ticker: str) -> str:
    from ..cache import get_company_name_cached, set_company_name_cached
    cached = get_company_name_cached(ticker)
    if cached is not None:
        return cached
    try:
        info = yf.Ticker(ticker).info
        name = info.get("longName") or info.get("shortName") or ticker
    except Exception:
        logger.warning("Failed to fetch company name for %s; falling back to ticker", ticker)
        name = ticker
    set_company_name_cached(ticker, name)
    return name

def fetch_wide(
    ticker: str,
    entry_date: str,
    exit_date: str,
    lookback_days: int = 120,
    ref_points: "list[tuple[str, float]] | None" = None,
) -> pd.DataFrame:
    wide_from = (pd.Timestamp(entry_date) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    # Always extend the window through today so charts for trades that exited
    # long ago still display the latest available candles, not just data up to
    # their exit date.
    wide_to_exit = pd.Timestamp(exit_date) + timedelta(days=lookback_days)
    wide_to = max(wide_to_exit, pd.Timestamp.today()).strftime("%Y-%m-%d")
    return fetch_ohlcv(ticker, wide_from, wide_to, ref_points=ref_points)
