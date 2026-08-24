#!/usr/bin/env python3
"""Merge an authorized PSX market-data feed into data/market.json.

This script intentionally does not scrape PSX public web pages. Configure an
endpoint for which the dashboard owner has market-data redistribution rights.

Expected feed shape (extra fields are ignored):
{
  "asOf": "2026-08-24T10:30:00+05:00",
  "provider": "PSX Licensed Feed",
  "market": {
    "kse100": 177000.0,
    "kse100Change": 0.2,
    "allShare": 107000.0,
    "allShareChange": 0.1,
    "ogti": 35000.0,
    "ogtiChange": 0.5
  },
  "stocks": [
    {
      "symbol": "KEL",
      "price": 7.25,
      "change": 1.1,
      "avgVol": 25000000,
      "pe": 8.2,
      "lowestValue": 1.23,
      "highestValue": 15.40
    }
  ]
}
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
ALLOWED_STOCK_FIELDS = {
    "price", "change", "avgVol", "pe", "lowestValue", "highestValue"
}


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
    headers = {
        "Accept": "application/json",
        "User-Agent": "psx-ai-market-intelligence/1.0",
    }
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


def parse_as_of(value) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
    text = str(value).strip().replace("Z", "+00:00")
    try:
        datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"invalid asOf timestamp: {value!r}") from exc
    return str(value).strip()


def merge(existing: dict, feed: dict) -> tuple[dict, int]:
    if not isinstance(existing.get("stocks"), list):
        raise ValueError("data/market.json has no stocks array")

    feed_stocks = feed.get("stocks", [])
    if not isinstance(feed_stocks, list):
        raise ValueError("feed stocks must be an array")

    by_symbol = {str(s.get("symbol", "")).upper(): s for s in existing["stocks"]}
    updated = 0

    for incoming in feed_stocks:
        if not isinstance(incoming, dict):
            continue
        symbol = str(incoming.get("symbol", "")).strip().upper()
        if not symbol or symbol not in by_symbol:
            continue
        target = by_symbol[symbol]
        before = json.dumps(target, sort_keys=True)

        for field in ALLOWED_STOCK_FIELDS:
            if field not in incoming:
                continue
            raw = incoming[field]
            if raw is None:
                continue  # preserve verified values already in the dashboard
            target[field] = normalize_number(number(raw, positive=(field == "price")))

        # Integrity: historical extrema must bracket a positive price when all exist.
        lo = target.get("lowestValue")
        hi = target.get("highestValue")
        px = target.get("price")
        if lo is not None and hi is not None and float(lo) > float(hi):
            raise ValueError(f"{symbol}: lowestValue is greater than highestValue")
        if px is not None and float(px) <= 0:
            raise ValueError(f"{symbol}: price must be positive")

        if json.dumps(target, sort_keys=True) != before:
            updated += 1

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
        "dataProvider": provider,
        "lastSuccessfulRefresh": as_of,
        "lastIngestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feedMode": "authorized",
    })
    return existing, updated


def main() -> int:
    url = os.getenv("PSX_FEED_URL", "").strip()
    token = os.getenv("PSX_FEED_TOKEN", "").strip() or None

    if not url:
        print("PSX_FEED_URL is not configured; leaving the published snapshot unchanged.")
        return 0

    with MARKET_FILE.open("r", encoding="utf-8") as fh:
        existing = json.load(fh)

    feed = fetch_feed(url, token)
    merged, count = merge(existing, feed)
    with MARKET_FILE.open("w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"Authorized feed merged successfully; {count} tracked stock records changed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Market update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
