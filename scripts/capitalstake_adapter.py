#!/usr/bin/env python3
"""Normalize Capital Stake PSX API responses into dashboard feed shape.

Read-only market data adapter. Requires CAPITALSTAKE_API_TOKEN.
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone

BASE = "https://csapis.com/3.0"


def _get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        BASE + path,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "psx-ai-market-intelligence/1.2",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"Capital Stake {path} returned HTTP {response.status}")
        payload = json.load(response)
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        raise RuntimeError(f"Capital Stake {path} returned an invalid/error payload")
    return payload


def _pct(value):
    if value is None:
        return None
    n = float(value)
    # API examples express 0.0038 for +0.38%; dashboard uses percentage points.
    return n * 100.0 if abs(n) <= 2 else n


def _index_code(code: str) -> str:
    return str(code or "").upper().replace("-", "").replace("_", "").replace(" ", "")


def build_feed(token: str) -> dict:
    quotes = _get("/market/quotes", token).get("data") or []
    stocks = _get("/market/stocks", token).get("data") or []
    indices = _get("/market/indices", token).get("data") or []

    meta_by_symbol = {
        str(x.get("symbol", "")).strip().upper(): x
        for x in stocks
        if isinstance(x, dict) and x.get("symbol")
    }

    normalized_stocks = []
    timestamps = []
    for q in quotes:
        if not isinstance(q, dict):
            continue
        symbol = str(q.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        m = meta_by_symbol.get(symbol, {})
        if q.get("date"):
            timestamps.append(str(q["date"]))
        normalized_stocks.append({
            "symbol": symbol,
            "company": m.get("name") or symbol,
            "sector": m.get("sector") or "Unclassified",
            "listedIn": ",".join(m.get("listed_in") or []),
            "price": q.get("close"),
            "change": _pct(q.get("change_percent")),
            "volume": q.get("volume"),
            "open": q.get("open"),
            "dayHigh": q.get("high"),
            "dayLow": q.get("low"),
            "previousClose": m.get("ldcp"),
            "upperCircuit": m.get("ucap"),
            "lowerCircuit": m.get("lcap"),
            "marketCap": m.get("market_cap"),
            "freeFloat": m.get("free_float"),
            "high52": m.get("high52"),
            "low52": m.get("low52"),
        })

    market = {}
    index_map = {
        "KSE100": ("kse100", "kse100Change"),
        "KSE100PR": ("kse100", "kse100Change"),
        "ALLSHR": ("allShare", "allShareChange"),
        "KSEALLSHARE": ("allShare", "allShareChange"),
        "OGTI": ("ogti", "ogtiChange"),
    }
    for row in indices:
        if not isinstance(row, dict):
            continue
        code = _index_code(row.get("code") or row.get("name"))
        if row.get("date"):
            timestamps.append(str(row["date"]))
        target = index_map.get(code)
        if not target:
            continue
        value_key, change_key = target
        market[value_key] = row.get("close")
        market[change_key] = _pct(row.get("change_percent"))

    # Capital Stake timestamps are PKT per docs for market delivery. Preserve the
    # latest provider timestamp as a readable value; updater validates presence.
    as_of = max(timestamps) if timestamps else datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "asOf": as_of,
        "provider": "Capital Stake — authorized PSX data vendor",
        "market": market,
        "stocks": normalized_stocks,
    }


def main() -> int:
    token = os.getenv("CAPITALSTAKE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("CAPITALSTAKE_API_TOKEN is not configured")
    print(json.dumps(build_feed(token), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
