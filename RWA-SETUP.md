# RWA Pulse v0.14

## Status

The separate sidebar page and two charts are implemented. Production category-specific data is NOT verified or connected. Only DUNE_API_KEY has been configured by the owner. No queries or query IDs exist yet. This package displays an honest awaiting-data state until results are available.

Do not deploy expecting Base volume or holder history to be populated automatically.

## Optional Dune connection

Server-only environment variables:

- DUNE_API_KEY
- DUNE_RWA_QUERY_ID
- DUNE_STOCKS_QUERY_ID

The endpoint reads saved results; it never executes paid SQL on page loads. Dune is optional, but another source must supply equivalent category-specific data before the requested metrics can go live. This change does not alter CMC or other feeds used by the rest of the site.

## Required query results

Each query must return one row per UTC day and tracked chain, covering at least the most recent 30 complete UTC days:

| Column | Definition |
|---|---|
| day | YYYY-MM-DD, UTC day |
| blockchain | bsc / solana / robinhood / ethereum / base (display names also supported) |
| onchain_volume_usd | USD onchain trading volume for the chosen RWA token universe that day; exclude CEX volume; deduplicate trades |
| holders | Distinct addresses with a positive balance in at least one covered token at end of day; deduplicate across tokens on the same chain |

RWA and stocks queries must use documented, reviewed token-contract lists and consistent volume definitions. Robinhood coverage must be checked against available tables. An empty source is null, not zero. Use zero only for a fully indexed day with no activity.

Do not add per-token holder counts together: one address can own several tokens. Holder totals across chains represent chain/address pairs, not unique people.

Validate SQL and query coverage before setting the IDs. Schedule refreshes within your chosen provider budget. This adapter accepts completed, non-paginated results up to 10,000 rows and rejects executions older than 48 hours. Missing days leave line gaps and withhold incomplete volume totals. Totals are shown only when all five chains are covered.

## Charts

- Volume: five-chain bar chart, full selected UTC-day period, USD axis.
- Holders: five colored date-aligned lines, no interpolated missing points; one-day view can have one point per chain. The total is the most recent complete-day snapshot.
- On narrow screens, charts scroll horizontally to preserve readable labels. Chain values remain readable below each chart.

## Source review

- CMC RWA quotes are aggregate token markets; they cannot be relabeled as onchain-only volume. Its RWA market-pairs endpoint excludes the Basic plan: https://coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets
- DefiLlama whole-chain DEX volume covers all categories, not just RWA/stocks. Its documented RWA Pro endpoints expose market value and TVL, not the required holder history: https://github.com/DefiLlama/api-docs/blob/main/llms-pro.txt
- Public RWA.xyz pages contain individual token snapshots, but a verified, complete free historical feed for this five-chain view has not been established.
- Dune result retrieval: https://docs.dune.com/api-reference/executions/endpoint/get-query-result

## Verification

Run npm run build and node work/test-rwa-pulse.mjs. The test uses synthetic fixtures only; no fixture data is included in production responses.
