import json
from datetime import timedelta

import pandas as pd
import yfinance as yf

_OHLCV_COLS = ["Open", "High", "Low", "Close", "Volume"]

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
    # If to_date is in the future, clamp it to tomorrow (today + 1 day) so we don't cache future dates
    # and ensure today's candle is always included since yfinance download end is exclusive.
    tomorrow_str = (pd.Timestamp.today() + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    if to_date > tomorrow_str:
        to_date = tomorrow_str

    from ..cache import get_ohlcv, set_ohlcv
    cached = get_ohlcv(ticker, from_date, to_date)
    if cached is not None:
        return _json_to_df(cached)

    df = _download_ohlcv(ticker, from_date, to_date)
    set_ohlcv(ticker, from_date, to_date, _df_to_json(df))
    return df

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
    # Always extend the window through today so charts for trades that exited
    # long ago still display the latest available candles, not just data up to
    # their exit date.
    wide_to_exit = pd.Timestamp(exit_date) + timedelta(days=lookback_days)
    wide_to = max(wide_to_exit, pd.Timestamp.today()).strftime("%Y-%m-%d")
    return fetch_ohlcv(ticker, wide_from, wide_to)
