#!/usr/bin/env python3
"""Merge an authorized PSX market-data feed into data/market.json.

Supported modes:
- Capital Stake authorized PSX API (PSX_PROVIDER=capitalstake)
- Generic normalized JSON feed (PSX_FEED_URL)

The updater is read-only with respect to the market. It never places orders.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKET_FILE = ROOT / "data" / "market.json"

ALLOWED_MARKET_FIELDS = {
    "kse100", "kse100Change", "allShare", "allShareChange", "ogti", "ogtiChange"
}
NUMERIC_STOCK_FIELDS = {
    "price", "change", "avgVol", "pe", "lowestValue", "highestValue",
    "volume", "open", "dayHigh", "dayLow", "previousClose",
    "upperCircuit", "lowerCircuit", "marketCap", "freeFloat", "high52", "low52",
}
TEXT_STOCK_FIELDS = {"company", "sector", "listedIn"}


def number(value, *, positive=False):
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not a numeric market value")
    try:
        n = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid numeric value: {value!r}") from exc
    if positive and n <= 0:
        raise ValueError(f"expected positive value, got {n}")
    return n


def normalize_number(n):
    if n is None:
        return None
    return int(n) if float(n).is_integer() else round(float(n), 6)


def fetch_feed(url: str, token: str | None) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "psx-ai-market-intelligence/1.2"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"feed returned HTTP {response.status}")
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("feed payload must be a JSON object")
    return payload


def provider_feed() -> dict | None:
    provider = os.getenv("PSX_PROVIDER", "").strip().lower()
    if provider == "capitalstake":
        token = os.getenv("CAPITALSTAKE_API_TOKEN", "").strip()
        if not token:
            print("CAPITALSTAKE_API_TOKEN is not configured; leaving snapshot unchanged.")
            return None
        from capitalstake_adapter import build_feed
        return build_feed(token)

    url = os.getenv("PSX_FEED_URL", "").strip()
    token = os.getenv("PSX_FEED_TOKEN", "").strip() or None
    if not url:
        print("No authorized feed is configured; leaving the published snapshot unchanged.")
        return None
    return fetch_feed(url, token)


def parse_as_of(value) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
    text = str(value).strip().replace("Z", "+00:00")
    try:
        datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"invalid asOf timestamp: {value!r}") from exc
    return str(value).strip()


def new_stock(symbol: str, incoming: dict) -> dict:
    return {
        "symbol": symbol,
        "company": str(incoming.get("company") or incoming.get("name") or symbol).strip(),
        "sector": str(incoming.get("sector") or "Unclassified").strip(),
        "listedIn": str(incoming.get("listedIn") or "").strip(),
        "price": None,
        "change": None,
        "pe": None,
        "avgVol": None,
        "lowestValue": None,
        "highestValue": None,
        "historicalSource": None,
        "tactical": 0,
        "entryQuality": 0,
        "medium": 0,
        "long": 0,
        "conviction": 0,
        "confidence": 0,
        "state": "UNSCORED",
        "risk": "DATA ONLY",
        "paperSignal": False,
        "liveEligible": False,
    }


def merge(existing: dict, feed: dict) -> tuple[dict, int, int]:
    if not isinstance(existing.get("stocks"), list):
        raise ValueError("data/market.json has no stocks array")

    feed_stocks = feed.get("stocks", [])
    if not isinstance(feed_stocks, list):
        raise ValueError("feed stocks must be an array")

    by_symbol = {str(s.get("symbol", "")).strip().upper(): s for s in existing["stocks"]}
    updated = 0
    added = 0

    for incoming in feed_stocks:
        if not isinstance(incoming, dict):
            continue
        symbol = str(incoming.get("symbol", "")).strip().upper()
        if not symbol:
            continue

        if symbol not in by_symbol:
            target = new_stock(symbol, incoming)
            existing["stocks"].append(target)
            by_symbol[symbol] = target
            added += 1
        else:
            target = by_symbol[symbol]

        before = json.dumps(target, sort_keys=True)

        for field in TEXT_STOCK_FIELDS:
            raw = incoming.get(field)
            if raw is not None and str(raw).strip():
                target[field] = str(raw).strip()
        if incoming.get("name") and not incoming.get("company"):
            target["company"] = str(incoming["name"]).strip()

        for field in NUMERIC_STOCK_FIELDS:
            if field not in incoming or incoming[field] is None:
                continue
            target[field] = normalize_number(number(incoming[field], positive=(field == "price")))

        lo, hi, px = target.get("lowestValue"), target.get("highestValue"), target.get("price")
        if lo is not None and hi is not None and float(lo) > float(hi):
            raise ValueError(f"{symbol}: lowestValue is greater than highestValue")
        if px is not None and float(px) <= 0:
            raise ValueError(f"{symbol}: price must be positive")

        if json.dumps(target, sort_keys=True) != before:
            updated += 1

    existing["stocks"].sort(key=lambda s: str(s.get("symbol", "")))

    incoming_market = feed.get("market") or {}
    if not isinstance(incoming_market, dict):
        raise ValueError("feed market must be an object")
    existing.setdefault("market", {})
    for field in ALLOWED_MARKET_FIELDS:
        if field in incoming_market and incoming_market[field] is not None:
            existing["market"][field] = normalize_number(number(incoming_market[field]))

    as_of = parse_as_of(feed.get("asOf") or feed.get("as_of"))
    provider = str(feed.get("provider") or "Authorized PSX market-data feed")
    meta = existing.setdefault("meta", {})
    meta.update({
        "dataset": f"Authorized market snapshot — {as_of}",
        "live": True,
        "authorizedFeedConnected": True,
        "stockDataFresh": True,
        "indexDataFresh": bool(incoming_market),
        "dataProvider": provider,
        "lastSuccessfulRefresh": as_of,
        "lastIngestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feedMode": "authorized",
        "universeSize": len(existing["stocks"]),
    })
    return existing, updated, added


def main() -> int:
    feed = provider_feed()
    if feed is None:
        return 0

    with MARKET_FILE.open("r", encoding="utf-8") as fh:
        existing = json.load(fh)
    merged, count, added = merge(existing, feed)
    with MARKET_FILE.open("w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(
        f"Authorized feed merged successfully; {count} records changed, "
        f"{added} new symbols added, {len(merged['stocks'])} total symbols."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Market update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
