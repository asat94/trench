const CHAINS = [
  { chain: 'BNB Chain', holders: 1364345, volume: 1390000000, traders: 71800, value: 5350000000 },
  { chain: 'Robinhood Chain', holders: 1119520, volume: 1080000000, traders: 49600, value: 2810000000 },
  { chain: 'Solana', holders: 424237, volume: 760000000, traders: 44200, value: 1960000000 },
  { chain: 'Ethereum', holders: 268754, volume: 610000000, traders: 21400, value: 6840000000 },
  { chain: 'Base', holders: 54382, volume: 245000000, traders: 11800, value: 720000000 }
];

const PERIODS = { '1d': 13, '7d': 15, '30d': 17 };
const MARKET_FACTOR = { rwa: 1, stocks: .29 };
const METRIC_SWING = { holders: .015, volume: .12, traders: .08, value: .025 };

function series(end, points, seed, swing) {
  return Array.from({ length: points }, (_, index) => {
    const progress = index / Math.max(points - 1, 1);
    const growth = .86 + progress * .14;
    const wave = Math.sin((index + seed) * 1.17) * swing + Math.cos((index + seed * 2) * .53) * swing * .4;
    return Math.max(0, Math.round(end * (growth + wave) / (1 + Math.sin((points - 1 + seed) * 1.17) * swing + Math.cos((points - 1 + seed * 2) * .53) * swing * .4)));
  });
}

function preview(market, period) {
  const points = PERIODS[period];
  const factor = MARKET_FACTOR[market];
  const chains = CHAINS.map((item, index) => {
    const metrics = {};
    Object.keys(METRIC_SWING).forEach((metric) => {
      const marketBias = market === 'stocks' ? (metric === 'holders' ? .34 : metric === 'value' ? .22 : .31) : 1;
      metrics[metric] = series(item[metric] * factor * marketBias, points, index + (period === '1d' ? 2 : period === '7d' ? 7 : 13), METRIC_SWING[metric]);
    });
    return { chain: item.chain, metrics };
  });
  const totals = Object.keys(METRIC_SWING).reduce((result, metric) => ({ ...result, [metric]: chains.reduce((sum, chain) => sum + chain.metrics[metric].at(-1), 0) }), {});
  return {
    live: false,
    market,
    period,
    updated: 'interface preview',
    note: 'Illustrative interface data only — live RWA provider connection is pending.',
    totals,
    chains
  };
}

export default async function handler(req, res) {
  const market = req.query.market === 'stocks' ? 'stocks' : 'rwa';
  const period = PERIODS[req.query.period] ? req.query.period : '30d';
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  if (process.env.RWA_DATA_URL) {
    try {
      const url = new URL(process.env.RWA_DATA_URL);
      url.searchParams.set('market', market);
      url.searchParams.set('period', period);
      const response = await fetch(url, {
        headers: process.env.RWA_API_KEY ? { Authorization: `Bearer ${process.env.RWA_API_KEY}` } : {},
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
      const data = await response.json();
      return res.status(200).json({ ...data, live: true, market, period });
    } catch (error) {
      return res.status(502).json({ available: false, error: 'The verified RWA data source could not be reached.' });
    }
  }

  return res.status(200).json(preview(market, period));
}
