# -*- coding: utf-8 -*-
"""Build a compact ETF ex-dividend fill summary from split-adjusted daily data."""

from datetime import timedelta
import math
import statistics


def summarize_fills(close, dividends, limit=12):
    """Summarize recent fill events and three-year payout variability.

    close and dividends are pandas Series whose indexes are trading dates. Prices
    and payouts must share the same split-adjusted share basis (as returned by
    fetch_calc.split_adjust).
    """
    prices = close.dropna().sort_index()
    payouts = dividends.dropna().sort_index()
    if len(prices) < 2:
        return {'events': [], 'payoutCv3y': None}

    dates = list(prices.index)
    values = [float(v) for v in prices.values]
    pos = {d: i for i, d in enumerate(dates)}
    latest = values[-1]
    events = []

    for dt, amount in payouts.items():
        i = pos.get(dt)
        if i is None or i == 0:
            continue
        reference = values[i - 1]
        if not math.isfinite(reference) or reference <= 0:
            continue
        fill_i = next((j for j in range(i, len(values)) if values[j] >= reference), None)
        if fill_i is None:
            events.append({
                'date': dt.strftime('%Y-%m-%d'),
                'amount': round(float(amount), 4),
                'filled': False,
                'days': None,
                'gapPct': round(max(0.0, (reference - latest) / reference * 100), 2),
            })
        else:
            events.append({
                'date': dt.strftime('%Y-%m-%d'),
                'amount': round(float(amount), 4),
                'filled': True,
                'days': fill_i - i,
                'gapPct': None,
            })

    cutoff = dates[-1] - timedelta(days=365 * 3)
    recent_amounts = [float(v) for dt, v in payouts.items()
                      if dt >= cutoff and math.isfinite(float(v)) and float(v) > 0]
    cv = None
    if len(recent_amounts) >= 2:
        mean = statistics.fmean(recent_amounts)
        if mean > 0:
            cv = round(statistics.pstdev(recent_amounts) / mean * 100, 2)

    return {
        'events': events[-limit:],
        'payoutCv3y': cv,
    }
