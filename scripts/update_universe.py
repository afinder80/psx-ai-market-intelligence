#!/usr/bin/env python3
"""Update the PSX reference universe independently from market prices.

The source must be an authorized/reference-data endpoint or a user-controlled
export derived from the official PSX Companies Registrar. Market prices are not
accepted by this script.

Supported source formats:
- JSON object with {"asOf": ..., "source": ..., "stocks": [...]}
- JSON array of stock objects
- CSV with columns symbol, company, sector, status
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_FILE = ROOT / "data" / "universe.json"


def fetch_bytes(url: str, token: str | None) -> tuple[bytes, str]:
    headers = {"Accept": "application/json,text/csv,*/*", "User-Agent": "psx-ai-market-intelligence/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"universe source returned HTTP {response.status}")
        return response.read(), response.headers.get("Content-Type", "")


def normalize_stock(raw: dict) -> dict | None:
    symbol = str(raw.get("symbol") or raw.get("Symbol") or "").strip().upper()
    if not symbol:
        return None
    company = str(raw.get("company") or raw.get("Company") or raw.get("name") or symbol).strip()
    sector = str(raw.get("sector") or raw.get("Sector") or "Unclassified").strip() or "Unclassified"
    status = str(raw.get("status") or raw.get("Status") or "Listed").strip() or "Listed"
    return {"symbol": symbol, "company": company, "sector": sector, "status": status}


def parse_source(data: bytes, content_type: str) -> tuple[list[dict], dict]:
    text = data.decode("utf-8-sig")
    metadata = {}
    if "csv" in content_type.lower() or text.lstrip().startswith("symbol,") or text.lstrip().startswith("Symbol,"):
        rows = list(csv.DictReader(io.StringIO(text)))
        return rows, metadata

    payload = json.loads(text)
    if isinstance(payload, list):
        return payload, metadata
    if not isinstance(payload, dict):
        raise ValueError("universe payload must be a JSON object, JSON array, or CSV")
    rows = payload.get("stocks") or payload.get("companies") or payload.get("symbols")
    if not isinstance(rows, list):
        raise ValueError("universe JSON must contain a stocks/companies/symbols array")
    metadata = {k: payload.get(k) for k in ("source", "sourceUrl", "asOf") if payload.get(k) is not None}
    return rows, metadata


def main() -> int:
    url = os.getenv("PSX_UNIVERSE_URL", "").strip()
    token = os.getenv("PSX_UNIVERSE_TOKEN", "").strip() or None
    if not url:
        print("PSX_UNIVERSE_URL is not configured; leaving universe.json unchanged.")
        return 0

    data, content_type = fetch_bytes(url, token)
    rows, metadata = parse_source(data, content_type)

    by_symbol = {}
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        stock = normalize_stock(raw)
        if stock:
            by_symbol[stock["symbol"]] = stock

    if not by_symbol:
        raise ValueError("universe source contained no valid symbols")

    output = {
        "meta": {
            "source": metadata.get("source") or "Authorized PSX reference-data source",
            "sourceUrl": metadata.get("sourceUrl") or url,
            "asOf": metadata.get("asOf") or date.today().isoformat(),
            "complete": True,
            "note": "Reference universe only. Market prices are stored separately in data/market.json."
        },
        "stocks": sorted(by_symbol.values(), key=lambda x: x["symbol"])
    }

    UNIVERSE_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Universe updated successfully: {len(output['stocks'])} symbols.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Universe update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
