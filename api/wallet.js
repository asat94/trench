import { chainNames, gmgn, unwrap } from './_gmgn.js';
import { cacheGet, cacheSet } from './_cache.js';

const pending = new Map();
const PROFILE_FRESH_FOR = 24 * 60 * 60 * 1000;
const num = (value) => Number(value || 0);
const money = (value) => {
  const number = num(value), sign = number < 0 ? '-' : '', absolute = Math.abs(number);
  return sign + (absolute >= 1e6 ? `$${(absolute / 1e6).toFixed(2)}M` : absolute >= 1e3 ? `$${(absolute / 1e3).toFixed(1)}K` : `$${absolute.toFixed(0)}`);
};

function makeProfile(address, chain, stats, activityRaw) {
  const activityData = unwrap(activityRaw) || {};
  const activities = activityData.activities || activityData.list || [];
  const common = stats.common || {};
  const pnlStat = stats.pnl_stat || {};
  return {
    cachedAt: Date.now(),
    wallet: {
      address,
      chain: chainNames[chain],
      name: common.name || common.ens || common.twitter_username || null,
      tags: common.tags || common.tag ? [...(common.tags || []), common.tag].filter(Boolean) : ['Tracked wallet'],
      realized: money(stats.realized_profit),
      unrealized: money(stats.unrealized_profit),
      winRate: (stats.winrate ?? pnlStat.winrate) != null ? `${Math.round(num(stats.winrate ?? pnlStat.winrate) * 100)}%` : '—',
      pnl: (stats.pnl ?? stats.realized_profit_pnl) != null ? `${(num(stats.pnl ?? stats.realized_profit_pnl) * 100).toFixed(1)}%` : '—',
      buys: stats.buy_count ?? stats.buy_tx_count ?? '—',
      sells: stats.sell_count ?? stats.sell_tx_count ?? '—',
      reason: 'Listed in the live on-chain wallet activity feed; performance figures cover the last 30 days.'
    },
    activities: activities.slice(0, 12).map((item, index) => ({
      id: item.transaction_hash || index,
      type: String(item.type || item.event_type || 'trade').toUpperCase(),
      symbol: item.token?.symbol || item.symbol || 'TOKEN',
      name: item.token?.name || item.token?.symbol || 'Token',
      amount: money(item.cost_usd),
      time: item.timestamp ? new Date(num(item.timestamp) * (num(item.timestamp) < 1e12 ? 1000 : 1)).toLocaleString() : ''
    }))
  };
}

async function loadProfile(address, chain) {
  const statsRaw = await gmgn('/v1/user/wallet_stats', { chain, wallet_address: [address], period: '30d' });
  const stats = Array.isArray(unwrap(statsRaw)) ? unwrap(statsRaw)[0] : unwrap(statsRaw);
  const activityRaw = await gmgn('/v1/user/wallet_activity', { chain, wallet_address: address, limit: '12' }).catch(() => null);
  return makeProfile(address, chain, stats || {}, activityRaw);
}

export default async function handler(req, res) {
  // Never let a transient provider error become a CDN-cached wallet error.
  res.setHeader('Cache-Control', 'private, no-store');
  const chain = ['sol', 'bsc', 'base', 'eth', 'robinhood'].includes(req.query.chain) ? req.query.chain : 'sol';
  const address = String(req.query.address || '').trim();
  if (address.length < 20) return res.status(400).json({ error: 'A valid wallet address is required' });

  const key = `trench:wallet:v2:${chain}:${address.toLowerCase()}`;
  const cached = await cacheGet(key);
  const fresh = cached && Date.now() - Number(cached.cachedAt || 0) < PROFILE_FRESH_FOR;
  if (fresh) {
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=84600');
    return res.status(200).json({ ...cached, cached: true });
  }

  let request = pending.get(key);
  if (!request) {
    request = loadProfile(address, chain).then(async (profile) => {
      await cacheSet(key, profile);
      return profile;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
  }

  try {
    const profile = await request;
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=84600');
    return res.status(200).json({ ...profile, cached: false });
  } catch (error) {
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=84600');
      return res.status(200).json({ ...cached, cached: true, stale: true });
    }
    console.error('TRENCH wallet profile request failed', { chain, address, message: error.message });
    return res.status(502).json({ error: error.message || 'Wallet data is temporarily unavailable' });
  }
}
