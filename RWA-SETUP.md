# RWA Pulse v0.15.1

Production v0.15 returned registry_rejected before any Bitquery query ran. This revision accepts both numeric 0 and string "0" as CMC success codes. Genuine CMC errors now include their numeric code in the safe reason field (registry_rejected_CODE). The success-code regression test passes; deployment and live verification are still required.

## Status

The separate sidebar page and two charts are implemented. The endpoint now reads BITQUERY_ACCESS_TOKEN and uses Bitquery for onchain data, with CMC for the token catalogue and Robinhood's public catalogue for matching deployments. Local fixture tests and the production build pass. Live Bitquery queries and the account's historical-data entitlement have NOT yet been verified. This package must be tested against the production credentials before being described as a complete live feed.

## Bitquery connection

Required existing server environment variables: BITQUERY_ACCESS_TOKEN and CMC_API_KEY. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN coordinate request caching across instances. Keys never enter frontend code or URLs.

The catalogue follows CMC RWA assets, resolves token IDs to contract addresses, and includes secondary deployments and recognized token explorer links. Tokenized Stocks selects the stock asset type. RWA Market includes CMC's RWA categories. The query covers these tracked contracts, not a claim of every token issued worldwide. Catalogue discovery rejects incomplete pagination (maximum 1,000 assets) or more than 1,500 token IDs rather than silently taking a top-token sample.

Volume uses daily archive DEXTradeByTokens aggregates over 30 complete UTC days. The selected 1D/7D/30D view sums its corresponding days. Trades between two tracked tokens have both sides counted by that cube, so half of their two-sided amount is removed. This measures DEX swaps; it does not include private broker executions, primary issuance, CEX trading, or all token transfers. Missing daily rows remain unknown until indexing coverage is confirmed.

EVM holder queries request positive-balance distinct addresses across the tracked token set at each daily archive snapshot. They never sum per-token holder counts. Schema and entitlement require live validation. Solana holder history remains unavailable: the short-retention BalanceUpdates feed cannot establish the complete holder population. A separate complete holder source is still required for Solana.

Successful query results are cached for six hours; errors and refresh leases for five minutes. The registry is cached for one day. Switching periods reuses volume history. Each uncached period requests up to five volume queries and four holder queries (up to 30 daily holder aggregates per network). Query cost depends on the account plan; no paid upgrade or query-credit purchase is performed. Dune remains supported when no Bitquery token is configured and saved Dune query IDs are present.

Inspect /api/rwa?market=stocks&period=7d after deployment. The diagnostics array contains only safe chain/metric/error codes. authentication indicates a rejected token; access indicates a plan or permission limitation; rate_limit indicates credits or throttling; query requires checking the current provider schema. No secret or raw upstream message is returned. Verify 1D, 7D and 30D separately and compare known tokens against the provider before treating coverage as verified.

Additional references:

- https://docs.bitquery.io/docs/blockchain/Ethereum/dextrades/token-trades-apis/
- https://docs.bitquery.io/docs/blockchain/Ethereum/transfers/rwa-api/
- https://docs.bitquery.io/docs/blockchain/Ethereum/token-holders/token-holder-api/
- https://docs.bitquery.io/docs/blockchain/Solana/solana-token-holders/
- https://api.robinhood.com/rhj/assets

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

Run npm run build, node work/test-rwa-pulse.mjs, and node work/test-bitquery.mjs. Tests use synthetic fixtures only; no fixture data is included in production responses.
