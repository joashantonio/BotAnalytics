import json
from datetime import timedelta

import pandas as pd
import yfinance as yf

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
    df = yf.download(
        ticker, start=from_date, end=to_date,
        interval="1d", auto_adjust=True, progress=False,
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

def fetch_ohlcv(ticker: str, from_date: str, to_date: str) -> pd.DataFrame:
    from ..cache import get_ohlcv, set_ohlcv
    cached = get_ohlcv(ticker, from_date, to_date)
    if cached is not None:
        return _drop_market_breaks(_json_to_df(cached))

    df = _download_ohlcv(ticker, from_date, to_date)
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
        name = ticker
    set_company_name_cached(ticker, name)
    return name

def fetch_wide(ticker: str, entry_date: str, exit_date: str, lookback_days: int = 120) -> pd.DataFrame:
    wide_from = (pd.Timestamp(entry_date) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    wide_to = (pd.Timestamp(exit_date) + timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    return fetch_ohlcv(ticker, wide_from, wide_to)
