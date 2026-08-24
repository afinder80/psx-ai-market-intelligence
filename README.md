# PSX AI Market Intelligence

Independent PSX-first dashboard deployed on GitHub Pages.

## Data integrity

- No Yahoo Finance fallback.
- The public dashboard reads `data/market.json`.
- `Lowest Value` / `Highest Value` mean verified lifetime/all-available-history values where available; missing values remain blank.
- Public PSX website scraping is intentionally not used for automated redistribution.
- Live/delayed PSX market data must be supplied through an authorized/licensed feed before commercial redistribution.

## Automated market update engine

The repository includes `scripts/update_market.py` and `.github/workflows/update-market.yml`.

When the following GitHub Actions secrets are configured, the workflow checks the authorized feed every 30 minutes on weekdays during the PSX trading-day window and commits a changed `data/market.json` snapshot back to `main`:

- `PSX_FEED_URL` — authorized JSON market-data endpoint.
- `PSX_FEED_TOKEN` — optional bearer token for the endpoint.

If `PSX_FEED_URL` is not configured, the workflow safely leaves the published snapshot unchanged.

### Feed contract

The updater accepts JSON shaped like:

```json
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
      "highestValue": 15.4
    }
  ]
}
```

The updater merges records by symbol, preserves existing verified historical extrema when the feed omits them, validates numeric values, records source timestamps, and marks the dataset as feed-backed only after a successful authorized ingest.
