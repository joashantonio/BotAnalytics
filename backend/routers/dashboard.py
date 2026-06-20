"""
Cross-wallet bot analytics for the Dashboard.

Aggregates every uploaded session into two bot families and reports how
accurate each one's buy/sell predictions are:

  - Maard  -> scored with PSAR  (bot_type contains "maard")
  - Bears  -> Bears Bot scored with MA200 (contains "bears bot", not "booster")
              + Bears Bot Booster scored with MA10 (contains "booster"),
              united into a single "Bears" family.

Correctness per execution is the same trend-based notion the per-wallet
Executions table already uses (compute_correct_executions). The backend scores
EVERY execution against the chosen indicator regardless of bot, so we filter
each mode's rows down to the bot it actually belongs to before counting —
otherwise a Maard-only wallet would borrow Bears stats and vice-versa.
"""
from fastapi import APIRouter, HTTPException, Query

from ..services.chart_builder import compute_correct_executions
from ..store import list_sessions, get_session
from ..cache import get_analytics, set_analytics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Which indicator mode scores each bot family, and how to recognise the bot
# from its free-text bot_type. Mirrors the per-wallet logic in AnalyticsPage.
_MAARD = "maard"


def _bot_family(raw: str) -> str | None:
    """Map a raw bot_type string to 'maard', 'bears', or None (unknown)."""
    bt = (raw or "").lower()
    if "maard" in bt:
        return "maard"
    if "booster" in bt:
        return "bears"
    if "bears bot" in bt:
        return "bears"
    return None


# (mode, predicate) pairs. Each execution is counted once, under the mode that
# matches its bot — so a Bears Bot row is scored by MA200 and a Booster row by
# MA10, never both.
def _mode_owns(mode: str, raw: str) -> bool:
    bt = (raw or "").lower()
    if mode == "psar":
        return "maard" in bt
    if mode == "ma10":
        return "booster" in bt
    if mode == "ma200":
        return "bears bot" in bt and "booster" not in bt
    return False


def _correct_executions_cached(session_id: str, trades: dict, suffix: str, mode: str) -> dict:
    """Reuse the same cache the /correct-executions endpoint writes, so the
    dashboard piggybacks on wallet data the user has already opened (avoids
    re-downloading candles). Scope key must match symbols.py exactly."""
    mode_part = "" if mode == "psar" else f"::{mode}"
    scope = f"__correct_exec__v8__{mode_part}::"  # no date range -> empty from/to
    cached = get_analytics(session_id, scope, suffix)
    if cached is not None:
        return cached
    data = compute_correct_executions(trades, suffix=suffix, mode=mode)
    set_analytics(session_id, scope, suffix, data)
    return data


@router.get("/bot-analytics")
async def get_bot_analytics(suffix: str = Query(".SR")):
    """Accuracy of Maard vs Bears predictions across ALL uploaded wallets.

    Returns per-bot buy/sell correct vs wrong counts (for the cards) plus a
    flat list of dated, scored executions (for the frontend drift chart, which
    buckets them by day/week/month/year on demand)."""
    suffix = suffix.strip()

    # bot family -> running tallies
    tally = {
        "maard": {"buy_total": 0, "buy_correct": 0, "sell_total": 0, "sell_correct": 0},
        "bears": {"buy_total": 0, "buy_correct": 0, "sell_total": 0, "sell_correct": 0},
    }
    # which wallets actually contributed executions to each bot
    active_wallets = {"maard": set(), "bears": set()}
    # compact rows for the drift chart: one per scored execution
    series: list[dict] = []
    skipped: list[str] = []

    sessions = list_sessions()
    for s in sessions:
        sid = s["session_id"]
        session = get_session(sid)
        if not session:
            continue
        trades = session["trades"]

        for mode in ("psar", "ma10", "ma200"):
            try:
                data = _correct_executions_cached(sid, trades, suffix, mode)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Bot analytics failed ({mode}): {e}")
            skipped.extend(data.get("skipped_symbols", []))

            for e in data.get("executions", []):
                if not _mode_owns(mode, e.get("bot_type", "")):
                    continue
                fam = _bot_family(e.get("bot_type", ""))
                if fam is None:
                    continue
                side = e["side"]
                ok = bool(e["correct"])
                t = tally[fam]
                if side == "buy":
                    t["buy_total"] += 1
                    if ok:
                        t["buy_correct"] += 1
                else:
                    t["sell_total"] += 1
                    if ok:
                        t["sell_correct"] += 1
                active_wallets[fam].add(sid)
                series.append({
                    "bot": fam,
                    "side": side,
                    "correct": ok,
                    "date": e["exec_date"],
                    "symbol": e.get("symbol", ""),
                    # quartile of where a CORRECT exec landed in its trend block
                    # (1-4), null for wrong execs. Drives the quartile chart.
                    "quartile": e.get("quartile"),
                })

    def _pct(n: int, d: int) -> float:
        return round(n / d * 100, 2) if d > 0 else 0.0

    def _card(fam: str) -> dict:
        t = tally[fam]
        total = t["buy_total"] + t["sell_total"]
        correct = t["buy_correct"] + t["sell_correct"]
        return {
            "buy_total": t["buy_total"],
            "buy_correct": t["buy_correct"],
            "buy_wrong": t["buy_total"] - t["buy_correct"],
            "buy_pct": _pct(t["buy_correct"], t["buy_total"]),
            "sell_total": t["sell_total"],
            "sell_correct": t["sell_correct"],
            "sell_wrong": t["sell_total"] - t["sell_correct"],
            "sell_pct": _pct(t["sell_correct"], t["sell_total"]),
            "total": total,
            "correct": correct,
            "overall_pct": _pct(correct, total),
            "wallets_active": len(active_wallets[fam]),
        }

    return {
        "wallets": len(sessions),
        "maard": _card("maard"),
        "bears": _card("bears"),
        # de-duped, kept for transparency; symbols whose candles couldn't be fetched
        "skipped_symbols": sorted(set(skipped)),
        # sorted so the frontend can bucket sequentially without re-sorting
        "series": sorted(series, key=lambda r: r["date"]),
    }
