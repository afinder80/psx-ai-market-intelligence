#!/usr/bin/env python3
"""Update the PSX reference universe independently from market prices.

By default this script reads the official PSX instrument-reference endpoint:
https://dps.psx.com.pk/symbols

Only reference metadata is ingested here (symbol, company name, sector and
instrument flags). Market prices/volumes are deliberately excluded and remain
in data/market.json.
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
DEFAULT_PSX_SYMBOLS_URL = "https://dps.psx.com.pk/symbols"


def fetch_bytes(url: str, token: str | None) -> tuple[bytes, str]:
    headers = {
        "Accept": "application/json,text/csv,*/*",
        "User-Agent": "psx-ai-market-intelligence/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"universe source returned HTTP {response.status}")
        return response.read(), response.headers.get("Content-Type", "")


def as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def normalize_stock(raw: dict) -> dict | None:
    symbol = str(raw.get("symbol") or raw.get("Symbol") or "").strip().upper()
    if not symbol:
        return None

    is_debt = as_bool(raw.get("isDebt") if "isDebt" in raw else raw.get("is_debt"))
    if is_debt:
        return None  # the dashboard's main universe is equity/equity-like securities

    is_etf = as_bool(raw.get("isETF") if "isETF" in raw else raw.get("is_etf"))
    company = str(
        raw.get("company")
        or raw.get("Company")
        or raw.get("name")
        or raw.get("companyName")
        or symbol
    ).strip()
    sector = str(
        raw.get("sector")
        or raw.get("Sector")
        or raw.get("sectorName")
        or "Unclassified"
    ).strip() or "Unclassified"
    status = str(raw.get("status") or raw.get("Status") or "Listed").strip() or "Listed"

    return {
        "symbol": symbol,
        "company": company,
        "sector": sector,
        "status": status,
        "instrumentType": "ETF" if is_etf else "Equity",
        "isETF": is_etf,
        "isDebt": False,
    }


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
    rows = payload.get("stocks") or payload.get("companies") or payload.get("symbols") or payload.get("data")
    if not isinstance(rows, list):
        raise ValueError("universe JSON must contain a stocks/companies/symbols/data array")
    metadata = {k: payload.get(k) for k in ("source", "sourceUrl", "asOf") if payload.get(k) is not None}
    return rows, metadata


def main() -> int:
    url = os.getenv("PSX_UNIVERSE_URL", "").strip() or DEFAULT_PSX_SYMBOLS_URL
    token = os.getenv("PSX_UNIVERSE_TOKEN", "").strip() or None

    data, content_type = fetch_bytes(url, token)
    rows, metadata = parse_source(data, content_type)

    by_symbol = {}
    excluded_debt = 0
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        if as_bool(raw.get("isDebt") if "isDebt" in raw else raw.get("is_debt")):
            excluded_debt += 1
            continue
        stock = normalize_stock(raw)
        if stock:
            by_symbol[stock["symbol"]] = stock

    if not by_symbol:
        raise ValueError("universe source contained no valid non-debt symbols")

    output = {
        "meta": {
            "source": metadata.get("source") or "Pakistan Stock Exchange — official symbols reference endpoint",
            "sourceUrl": metadata.get("sourceUrl") or url,
            "asOf": metadata.get("asOf") or date.today().isoformat(),
            "complete": True,
            "universeSize": len(by_symbol),
            "excludedDebtInstruments": excluded_debt,
            "note": "Reference metadata only. Debt instruments are excluded from the main shares universe; market prices are stored separately in data/market.json."
        },
        "stocks": sorted(by_symbol.values(), key=lambda x: x["symbol"])
    }

    UNIVERSE_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Universe updated successfully: {len(output['stocks'])} non-debt symbols; {excluded_debt} debt instruments excluded.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Universe update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
