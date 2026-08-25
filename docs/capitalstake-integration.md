# Capital Stake integration plan

The dashboard supports a provider mode for Capital Stake, an authorized PSX data vendor listed by Pakistan Stock Exchange.

Required GitHub Actions secret:

- `CAPITALSTAKE_API_TOKEN` — Bearer token issued by Capital Stake after subscription/licensing approval.

Optional repository variable / environment variable:

- `PSX_PROVIDER=capitalstake`

Endpoints used by the read-only market updater:

- `https://csapis.com/3.0/market/quotes` — live/delayed OHLC, close, volume, change.
- `https://csapis.com/3.0/market/stocks` — company metadata, last-day close, 52-week range, circuits, market cap and index membership.
- `https://csapis.com/3.0/market/indices` — index snapshots including KSE-100 / All Share / OGTI when present.

The token must remain in GitHub Secrets and must never be committed to this repository.

The updater remains read-only with respect to the market: it retrieves market data and publishes the normalized dashboard snapshot. It does not place orders or connect to a brokerage account.

PSX redistribution rights must be confirmed for this public dashboard before enabling publication of live/delayed market data.
