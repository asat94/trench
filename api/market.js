import { cacheGet, cacheSet } from './_cache.js';
import { chainNames, gmgn, unwrap } from './_gmgn.js';

const usd = (value) => {
  const number = Number(value || 0);
  return number >= 1e9 ? `$${(number / 1e9).toFixed(2)}B` : number >= 1e6 ? `$${(number / 1e6).toFixed(1)}M` : number >= 1e3 ? `$${(number / 1e3).toFixed(1)}K` : `$${number.toFixed(2)}`;
};
const age = (timestamp) => {
  const hours = Math.max(1, Math.floor((Date.now() - Number(timestamp || 0) * 1000) / 3600000));
  return timestamp ? (hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`) : '—';
};
const colors = ['purple', 'yellow', 'pink', 'blue', 'orange', 'red'];
const canonical = (value) => ({ sol: 'sol', solana: 'sol', bsc: 'bsc', bnb: 'bsc', base: 'base', eth: 'eth', ethereum: 'eth', robinhood: 'robinhood', rhc: 'robinhood' })[String(value || '').toLowerCase()];
const dexChain = { sol: 'solana', bsc: 'bsc', base: 'base', eth: 'ethereum', robinhood: 'robinhood' };
const chainIds = ['sol', 'bsc', 'base', 'eth', 'robinhood'];
const SNAPSHOT_TTL = 7 * 24 * 60 * 60;
let cached = { expires: 0, payload: null };

function token(row, fallbackChain, index) {
  const chain = canonical(row.chain) || fallbackChain;
  const vol = Number(row.volume || row.volume_24h || 0);
  const liq = Number(row.liquidity || 0);
  const cap = Number(row.market_cap || row.usd_market_cap || 0);
  const heat = Number(row.hot_level || 0);
  const change = Number(row.price_change_percent_24h ?? row.price_change_percent24h ?? row.price_change_percent ?? row.price_change_percent_1h ?? 0);
  const upside = change > 0 ? Math.min(14, change * .08) : 0;
  const downside = change < 0 ? Math.min(42, Math.abs(change) * .45) : 0;
  const score = Math.max(8, Math.min(99, Math.round(35 + Math.min(22, Math.log10(vol + 1) * 3.5) + Math.min(15, Math.log10(liq + 1) * 2.8) + Math.min(9, heat * 1.5) + upside - downside)));
  const address = row.address || row.token_address || '';
  return {
    name: row.name || row.symbol || 'Token', symbol: row.symbol || 'TOKEN', chain: chainNames[chain] || chainNames[fallbackChain], address,
    logo: row.logo || row.logo_url || '', price: row.price ? (Number(row.price) < .01 ? `$${Number(row.price).toPrecision(3)}` : `$${Number(row.price).toFixed(4)}`) : '—',
    change, cap: cap / 1e6, vol: vol / 1e6, liq: liq / 1e6, age: age(row.open_timestamp || row.creation_timestamp || row.created_timestamp), score,
    signal: change <= -50 ? 'Heavy selloff' : change <= -15 ? 'Weak momentum' : heat ? `Heat level ${heat}` : vol > liq ? 'High activity' : 'Trending',
    reason: change <= -50 ? 'Large 24h drawdown is reducing this score.' : 'Live market-ranking data', color: colors[index % colors.length],
    url: address ? `https://dexscreener.com/${dexChain[chain]}/${address}` : 'https://dexscreener.com'
  };
}

async function chainFeed(chain) {
  const key = `trench:market:chain:v1:${chain}`;
  const previous = await cacheGet(key);
  try {
    const data = await gmgn('/v1/market/rank', { chain, interval: '1h', limit: '18' });
    const payload = unwrap(data) || {};
    const rows = payload.rank || payload.list || [];
    if (rows.length) {
      await cacheSet(key, { data, cachedAt: Date.now() }, SNAPSHOT_TTL);
      return { chain, data };
    }
  } catch { /* Use the last real result instead of a false zero. */ }
  return { chain, data: previous?.data || null };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=240');
  if (cached.payload && Date.now() < cached.expires) return res.status(200).json(cached.payload);
  try {
    const [feeds, global, prices] = await Promise.all([
      Promise.all(chainIds.map(chainFeed)),
      fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(6000) }).then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true', { signal: AbortSignal.timeout(6000) }).then((response) => response.ok ? response.json() : null).catch(() => null)
    ]);
    const allTokens = feeds.flatMap(({ chain, data }) => {
      const payload = unwrap(data) || {};
      const rows = payload.rank || payload.list || [];
      return rows.map((row, index) => token(row, chain, index));
    }).filter((item) => item.vol > 0 && item.liq > 0);
    const tokens = allTokens.filter((item, index, list) => list.findIndex((other) => other.chain === item.chain && other.symbol === item.symbol) === index).sort((a, b) => b.score - a.score).slice(0, 50);
    if (!tokens.length) return res.status(502).json({ error: 'No live market data returned', tokens: [] });
    const marketData = global?.data;
    const cap = Number(marketData?.total_market_cap?.usd || 0);
    const volume = Number(marketData?.total_volume?.usd || 0);
    const change = Number(marketData?.market_cap_change_percentage_24h_usd || 0);
    const trackedVol = allTokens.reduce((total, item) => total + item.vol, 0) * 1e6;
    const quote = (id, symbol, label) => ({ symbol, label, price: `$${Number(prices?.[id]?.usd || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, change: prices?.[id]?.usd_24h_change || 0 });
    const chainVolumes = chainIds.map((id) => ({ chain: chainNames[id], vol: allTokens.filter((item) => item.chain === chainNames[id]).reduce((total, item) => total + Number(item.vol || 0), 0) }));
    const payload = { tokens, market: { sentiment: change > 3 ? 'Greed' : change < -3 ? 'Fear' : 'Neutral', score: change > 3 ? 74 : change < -3 ? 32 : 51, marketCap: usd(cap), marketChange: change, volume: usd(volume), volumeChange: 0, onChain: usd(trackedVol), assets: [quote('bitcoin', 'BTC', 'Bitcoin'), quote('ethereum', 'ETH', 'Ethereum'), quote('solana', 'SOL', 'Solana'), quote('binancecoin', 'BNB', 'BNB Chain')], chainVolumes, updated: 'Live market feed' } };
    cached = { payload, expires: Date.now() + 90000 };
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Market data unavailable', tokens: [] });
  }
}
