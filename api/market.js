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
const MARKET_CACHE_KEY = 'trench:market:payload:v1';
const MARKET_REFRESH_FOR = 2 * 60 * 1000;
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

async function chainFeed(chain, refresh = false) {
  const key = `trench:market:chain:v1:${chain}`;
  const previous = await cacheGet(key);
  if (previous?.data && !refresh) return { chain, data: previous.data };
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

function dexToken(pair, chain, index) {
  const volume = Number(pair.volume?.h24 || 0);
  const liquidity = Number(pair.liquidity?.usd || 0);
  const cap = Number(pair.marketCap || pair.fdv || 0);
  const change = Number(pair.priceChange?.h24 || 0);
  const score = Math.max(8, Math.min(99, Math.round(35 + Math.min(22, Math.log10(volume + 1) * 3.5) + Math.min(15, Math.log10(liquidity + 1) * 2.8) + (change > 0 ? Math.min(14, change * .08) : -Math.min(42, Math.abs(change) * .45)))));
  return {
    name: pair.baseToken?.name || pair.baseToken?.symbol || 'Token', symbol: pair.baseToken?.symbol || 'TOKEN', chain: chainNames[chain], address: pair.baseToken?.address || '',
    logo: pair.info?.imageUrl || '', price: pair.priceUsd ? (Number(pair.priceUsd) < .01 ? `$${Number(pair.priceUsd).toPrecision(3)}` : `$${Number(pair.priceUsd).toFixed(4)}`) : '—',
    change, cap: cap / 1e6, vol: volume / 1e6, liq: liquidity / 1e6, age: pair.pairCreatedAt ? age(pair.pairCreatedAt / 1000) : '—', score,
    signal: change <= -50 ? 'Heavy selloff' : change <= -15 ? 'Weak momentum' : volume > liquidity ? 'High activity' : 'Trending',
    reason: 'Live DEX market data', color: colors[index % colors.length], url: pair.url || 'https://dexscreener.com'
  };
}

async function dexFallback() {
  const key = 'trench:market:dex-fallback:v1';
  const previous = await cacheGet(key);
  try {
    const boosts = await fetch('https://api.dexscreener.com/token-boosts/top/v1', { signal: AbortSignal.timeout(6000) }).then((response) => response.ok ? response.json() : []);
    const chainMap = { solana: 'sol', bsc: 'bsc', base: 'base', ethereum: 'eth' };
    const grouped = new Map();
    for (const item of Array.isArray(boosts) ? boosts : []) {
      const chain = chainMap[item.chainId];
      if (!chain || !item.tokenAddress) continue;
      const list = grouped.get(chain) || [];
      if (list.length < 30 && !list.includes(item.tokenAddress)) list.push(item.tokenAddress);
      grouped.set(chain, list);
    }
    const pairs = await Promise.all([...grouped.entries()].map(async ([chain, addresses]) => {
      const dexId = { sol: 'solana', bsc: 'bsc', base: 'base', eth: 'ethereum' }[chain];
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/${dexId}/${addresses.join(',')}`, { signal: AbortSignal.timeout(6000) });
      const data = response.ok ? await response.json() : [];
      return (Array.isArray(data) ? data : []).map((pair, index) => dexToken(pair, chain, index));
    }));
    const tokens = pairs.flat().filter((item) => item.vol > 0 && item.liq > 0).sort((a, b) => b.score - a.score).slice(0, 50);
    if (tokens.length) {
      await cacheSet(key, { tokens, cachedAt: Date.now() }, 30 * 60);
      return tokens;
    }
  } catch { /* The previously saved fallback remains available. */ }
  return previous?.tokens || [];
}

export default async function handler(req, res) {
  const refresh = req.query.refresh === '1';
  res.setHeader('Cache-Control', refresh ? 'private, no-store' : 's-maxage=90, stale-while-revalidate=240');
  if (!refresh && cached.payload && Date.now() < cached.expires) return res.status(200).json(cached.payload);
  const previousMarket = await cacheGet(MARKET_CACHE_KEY);
  if (!refresh && previousMarket?.payload) return res.status(200).json(previousMarket.payload);
  if (refresh && previousMarket?.payload && Date.now() - Number(previousMarket.cachedAt || 0) < MARKET_REFRESH_FOR) return res.status(200).json(previousMarket.payload);
  try {
    const [feeds, global, prices] = await Promise.all([
      Promise.all(chainIds.map((chain) => chainFeed(chain, refresh))),
      fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(6000) }).then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true', { signal: AbortSignal.timeout(6000) }).then((response) => response.ok ? response.json() : null).catch(() => null)
    ]);
    let allTokens = feeds.flatMap(({ chain, data }) => {
      const payload = unwrap(data) || {};
      const rows = payload.rank || payload.list || [];
      return rows.map((row, index) => token(row, chain, index));
    }).filter((item) => item.vol > 0 && item.liq > 0);
    if (!allTokens.length) allTokens = await dexFallback();
    const tokens = allTokens.filter((item, index, list) => list.findIndex((other) => other.chain === item.chain && other.symbol === item.symbol) === index).sort((a, b) => b.score - a.score).slice(0, 50);
    if (!tokens.length) {
      if (previousMarket?.payload) return res.status(200).json(previousMarket.payload);
      return res.status(502).json({ error: 'No live market data returned', tokens: [] });
    }
    const marketData = global?.data;
    const cap = Number(marketData?.total_market_cap?.usd || 0);
    const volume = Number(marketData?.total_volume?.usd || 0);
    const change = Number(marketData?.market_cap_change_percentage_24h_usd || 0);
    const trackedVol = allTokens.reduce((total, item) => total + item.vol, 0) * 1e6;
    const quote = (id, symbol, label) => ({ symbol, label, price: `$${Number(prices?.[id]?.usd || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, change: prices?.[id]?.usd_24h_change || 0 });
    const chainVolumes = chainIds.map((id) => ({ chain: chainNames[id], vol: allTokens.filter((item) => item.chain === chainNames[id]).reduce((total, item) => total + Number(item.vol || 0), 0) }));
    const payload = { tokens, market: { sentiment: change > 3 ? 'Greed' : change < -3 ? 'Fear' : 'Neutral', score: change > 3 ? 74 : change < -3 ? 32 : 51, marketCap: usd(cap), marketChange: change, volume: usd(volume), volumeChange: 0, onChain: usd(trackedVol), assets: [quote('bitcoin', 'BTC', 'Bitcoin'), quote('ethereum', 'ETH', 'Ethereum'), quote('solana', 'SOL', 'Solana'), quote('binancecoin', 'BNB', 'BNB Chain')], chainVolumes, updated: 'Live market feed' } };
    cached = { payload, expires: Date.now() + 90000 };
    await cacheSet(MARKET_CACHE_KEY, { payload, cachedAt: Date.now() }, SNAPSHOT_TTL);
    return res.status(200).json(payload);
  } catch (error) {
    if (previousMarket?.payload) return res.status(200).json(previousMarket.payload);
    return res.status(502).json({ error: error.message || 'Market data unavailable', tokens: [] });
  }
}
