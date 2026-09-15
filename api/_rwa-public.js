import { cacheGet, cacheSet } from './_cache.js';
import { CHAINS } from './_rwa-data.js';
const SOURCE = 'https://app.rwa.xyz/networks';
const DAY = 86400000;
const RWA_CLASSES = new Set(['Stocks', 'Diversified Credit', 'Asset-Backed Credit', 'Municipal Credit', 'Real Estate', 'Active Strategies', 'non-US Government Debt', 'Specialty Finance', 'Corporate Credit', 'Commodities', 'US Treasury Debt', 'Private Equity', 'Venture Capital']);
const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const sum = (items, field, key = 'val') => {
  const values = items.map((item) => numeric(item[field]?.[key]));
  return values.length && values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : null;
};
export function parsePublicNetworks(html, now = Date.now()) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('public_format_changed');
  const records = JSON.parse(match[1]).props?.pageProps?.listQueryResponse?.results;
  if (!Array.isArray(records)) throw new Error('public_format_changed');
  return CHAINS.map((chain) => {
    const matches = records.filter((r) => r.name === (chain === 'Robinhood Chain' ? 'Robinhood' : chain));
    if (matches.length !== 1) return { chain, categories: [], updated: null };
    const record = matches[0];
    const raw = record._updated_at;
    const timestamp = typeof raw === 'string' ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`) : NaN;
    if (!Number.isFinite(timestamp) || timestamp > now + 300000 || now - timestamp > 48 * 3600000) return { chain, categories: [], updated: null };
    const categories = record.asset_class_stats;
    if (!Array.isArray(categories) || new Set(categories.map((c) => c.name)).size !== categories.length) throw new Error('public_format_changed');
    return { chain, categories: categories.filter((c) => RWA_CLASSES.has(c.name)), updated: new Date(timestamp).toISOString() };
  });
}
export function createPublicPulse(records, market) {
  const chains = CHAINS.map((chain) => {
    const record = records.find((r) => r.chain === chain);
    const categories = (record?.categories || []).filter((c) => market !== 'stocks' || c.name === 'Stocks');
    const history = record?.updated ? [30, 7, 0].map((ago) => ({
      day: new Date(Date.parse(record.updated) - ago * DAY).toISOString().slice(0, 10),
      holders: sum(categories, 'holding_addresses_count', ago ? `val_${ago}d` : 'val')
    })) : [];
    return { chain, volume: sum(categories, 'trailing_30_day_transfer_volume'), holders: sum(categories, 'holding_addresses_count'), history };
  });
  const coverage = Object.fromEntries(['volume', 'holders'].map((key) => [key, chains.filter((c) => Number.isFinite(c[key])).length]));
  const totals = Object.fromEntries(['volume', 'holders'].map((key) => [key, coverage[key] === 5 ? chains.reduce((n, c) => n + c[key], 0) : null]));
  const dates = records.map((r) => r.updated).filter(Boolean).sort();
  return { market, period: '30d', supportedPeriods: ['30d'], mode: 'public-snapshots', version: 'public-v1', chains, totals, coverage,
    updated: dates[0] || null, available: coverage.volume > 0 || coverage.holders > 0, live: false,
    source: SOURCE, volumeKind: 'token_transfers',
    message: '30-day token transfers, not trading volume. Holder charts connect the available snapshots; daily history is not provided.',
    methodology: 'RWA Market excludes stablecoins and cryptocurrencies. Holder counts are summed across the selected asset classes and chains, not unique people or deduplicated wallets.' };
}
let pending;
export async function fetchPublicPulse(market) {
  const key = 'trench:rwa:public-networks:v1';
  let snapshot = await cacheGet(key);
  if (!snapshot || Date.now() - snapshot.fetched > 3600000) {
    if (!pending) pending = (async () => {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(18000), headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('public_unavailable');
      const records = parsePublicNetworks(await response.text());
      if (!records.some((r) => r.updated)) throw new Error('public_stale');
      const next = { fetched: Date.now(), records };
      await cacheSet(key, next, 3600);
      return next;
    })().finally(() => { pending = null; });
    snapshot = await pending;
  }
  const records = snapshot.records.map((r) => Date.now() - Date.parse(r.updated) <= 48 * 3600000 ? r : { ...r, categories: [], updated: null });
  return createPublicPulse(records, market);
}
