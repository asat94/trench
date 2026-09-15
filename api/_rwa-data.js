export const CHAINS = ['BNB Chain', 'Solana', 'Robinhood Chain', 'Ethereum', 'Base'];
const DAY = 86400000;
const aliases = { bsc: 'BNB Chain', bnb: 'BNB Chain', 'bnb chain': 'BNB Chain', 'bnb smart chain': 'BNB Chain', sol: 'Solana', solana: 'Solana', robinhood: 'Robinhood Chain', 'robinhood chain': 'Robinhood Chain', eth: 'Ethereum', ethereum: 'Ethereum', base: 'Base' };
const number = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export function normalizeRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const chain = aliases[String(row.blockchain || '').toLowerCase().trim()];
    const day = String(row.day || '').slice(0, 10);
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    if (!chain || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(timestamp)) continue;
    const key = `${chain}:${day}`;
    if (unique.has(key)) throw new Error('Duplicate chain/day rows in query result');
    unique.set(key, { chain, day, timestamp, volume: number(row.onchain_volume_usd), holders: number(row.holders) });
  }
  return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
}
export function createPulse(rows, market, period, updated, now = Date.now()) {
  // Complete UTC days; missing days never become zeros or shorter period totals.
  const end = Math.floor(now / DAY) * DAY;
  const start = end - Number(period.replace('d', '')) * DAY;
  const dates = Array.from({ length: (end - start) / DAY }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  const chains = CHAINS.map((chain) => {
    const byDay = new Map(rows.filter((r) => r.chain === chain).map((r) => [r.day, r]));
    const history = dates.map((day) => ({ day, holders: byDay.get(day)?.holders ?? null }));
    const volumes = dates.map((day) => byDay.get(day)?.volume ?? null);
    return { chain, volume: volumes.every(Number.isFinite) ? volumes.reduce((a, b) => a + b, 0) : null, holders: history.at(-1)?.holders ?? null, history };
  });
  const coverage = Object.fromEntries(['volume', 'holders'].map((key) => [key, chains.filter((c) => Number.isFinite(c[key])).length]));
  const totals = Object.fromEntries(['volume', 'holders'].map((key) => [key, coverage[key] === CHAINS.length ? chains.reduce((sum, c) => sum + c[key], 0) : null]));
  return { market, period, updated, start: dates[0], end: dates.at(-1), chains, coverage, totals, live: coverage.volume === 5 && coverage.holders === 5 };
}
