import { cacheGet, cacheSet } from './_cache.js';

const CMC = 'https://pro-api.coinmarketcap.com';
const ROBINHOOD = 'https://api.robinhood.com/rhj';
const CHAIN_NAMES = ['BNB Chain', 'Solana', 'Robinhood Chain', 'Ethereum', 'Base'];
const PERIOD_MS = { '1d': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 };
const MAX_ASSETS = 100;
const MAX_HOLDER_TOKENS = 4;

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const sumValues = (values) => {
  const present = values.filter((value) => Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
};

function cmcHeaders() {
  return { Accept: 'application/json', 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY };
}

async function getJson(url, options = {}, timeout = 6500) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const error = new Error(`Upstream request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function trackedChain(platform = {}) {
  const text = `${platform.name || ''} ${platform.slug || ''} ${platform.symbol || ''}`.toLowerCase();
  if (/robinhood/.test(text)) return 'Robinhood Chain';
  if (/\b(bnb|bsc)\b|binance-smart-chain|bnb-smart-chain/.test(text)) return 'BNB Chain';
  if (/solana|\bsol\b/.test(text)) return 'Solana';
  if (/ethereum|\beth\b/.test(text)) return 'Ethereum';
  if (/\bbase\b/.test(text)) return 'Base';
  return null;
}

function blankChain(chain) {
  return { chain, volume: null, holders: null, traders: null, value: null, tokenCount: 0, contracts: [] };
}

function unpackInfo(data) {
  return Object.values(data?.data || {}).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
}

async function fetchCmcMarket(market) {
  const listUrl = new URL(`${CMC}/v5/real-world-assets/assets/list`);
  listUrl.searchParams.set('limit', String(MAX_ASSETS));
  listUrl.searchParams.set('sort', 'tokenized_market_cap');
  listUrl.searchParams.set('sort_dir', 'desc');
  listUrl.searchParams.set('convert', 'USD');
  if (market === 'stocks') listUrl.searchParams.set('asset_type', 'stock');

  const list = await getJson(listUrl, { headers: cmcHeaders() });
  const assets = list?.data?.rwa_assets || [];
  const ids = assets.map((asset) => asset.rwa_id).filter(Boolean).slice(0, MAX_ASSETS);
  if (!ids.length) throw new Error('CoinMarketCap returned no RWA assets.');

  const quoteUrl = new URL(`${CMC}/v5/real-world-assets/quotes/latest`);
  quoteUrl.searchParams.set('rwa_id', ids.join(','));
  quoteUrl.searchParams.set('convert', 'USD');
  quoteUrl.searchParams.set('skip_invalid', 'true');
  const quoteData = await getJson(quoteUrl, { headers: cmcHeaders() });
  const rwaAssets = quoteData?.data?.rwa_assets || [];
  const tokens = rwaAssets.flatMap((asset) => (asset.tokens || []).map((token) => ({
    ...token,
    assetType: asset.asset_type,
    rwaId: asset.rwa_id
  }))).filter((token) => token.crypto_id);

  const tokenIds = [...new Set(tokens.map((token) => token.crypto_id))].slice(0, 250);
  const infoUrl = new URL(`${CMC}/v2/cryptocurrency/info`);
  infoUrl.searchParams.set('id', tokenIds.join(','));
  infoUrl.searchParams.set('aux', 'platform');
  infoUrl.searchParams.set('skip_invalid', 'true');
  const infoData = tokenIds.length ? await getJson(infoUrl, { headers: cmcHeaders() }) : { data: {} };
  const infoById = new Map(unpackInfo(infoData).map((item) => [Number(item.id), item]));
  const chains = new Map(CHAIN_NAMES.map((chain) => [chain, blankChain(chain)]));

  for (const token of tokens) {
    const platform = infoById.get(Number(token.crypto_id))?.platform;
    const chainName = trackedChain(platform);
    if (!chainName) continue;
    const chain = chains.get(chainName);
    chain.volume = (chain.volume || 0) + (finite(token.volume_24h) || 0);
    chain.value = (chain.value || 0) + (finite(token.market_cap) || 0);
    chain.tokenCount += 1;
    if (platform?.token_address) chain.contracts.push({
      address: platform.token_address,
      platform: platform.slug || platform.name,
      weight: finite(token.market_cap) || 0
    });
  }

  return {
    chains: [...chains.values()],
    updated: quoteData?.status?.timestamp || new Date().toISOString(),
    assetCount: rwaAssets.length
  };
}

async function holderCount(contract) {
  const url = new URL(`${CMC}/public-api/v1/dex/holders/count`);
  url.searchParams.set('platform', contract.platform);
  url.searchParams.set('tokenAddress', contract.address);
  try {
    const data = await getJson(url, { headers: { Accept: 'application/json' } }, 3500);
    return finite(data?.count ?? data?.data?.count);
  } catch { return null; }
}

async function addTrackedHolders(chains) {
  await Promise.all(chains.map(async (chain) => {
    const contracts = chain.contracts.sort((a, b) => b.weight - a.weight).slice(0, MAX_HOLDER_TOKENS);
    if (!contracts.length) return;
    const counts = await Promise.all(contracts.map(holderCount));
    chain.holders = sumValues(counts);
  }));
}

async function fetchRobinhoodCoverage() {
  try {
    const data = await getJson(`${ROBINHOOD}/assets`, { headers: { Accept: 'application/json' } }, 4500);
    const assets = (data?.assets || []).filter((asset) => asset.status === 'ASSET_STATUS_ACTIVE');
    return {
      assetCount: assets.length,
      deploymentCount: assets.flatMap((asset) => asset.deployments || []).filter((item) => Number(item.chainId) === 4663).length
    };
  } catch { return { assetCount: null, deploymentCount: null }; }
}

async function currentSnapshot(market) {
  const cacheKey = `trench:rwa:current:v3:${market}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const [cmc, robinhood] = await Promise.all([fetchCmcMarket(market), fetchRobinhoodCoverage()]);
  await addTrackedHolders(cmc.chains);
  const snapshot = {
    ts: Date.now(),
    updated: cmc.updated,
    assetCount: cmc.assetCount,
    robinhood,
    chains: cmc.chains.map(({ contracts, ...chain }) => chain)
  };
  await cacheSet(cacheKey, snapshot, 300);
  return snapshot;
}

function downsample(snapshots, period) {
  const selected = snapshots.filter((item) => item.ts >= Date.now() - PERIOD_MS[period]).sort((a, b) => a.ts - b.ts);
  if (period === '1d') return selected.slice(-24);
  const daily = new Map();
  for (const item of selected) daily.set(new Date(item.ts).toISOString().slice(0, 10), item);
  return [...daily.values()].slice(period === '7d' ? -7 : -30);
}

async function storeHistory(market, snapshot) {
  const key = `trench:rwa:history:v3:${market}`;
  const previous = await cacheGet(key);
  const history = Array.isArray(previous) ? previous.filter((item) => item?.ts > Date.now() - 31 * 86400000) : [];
  const last = history.at(-1);
  if (!last || snapshot.ts - last.ts > 45 * 60000) history.push(snapshot);
  else history[history.length - 1] = snapshot;
  await cacheSet(key, history, 32 * 86400);
  return history;
}

function responseFrom(history, snapshot, market, period) {
  const selected = downsample(history, period);
  const chains = CHAIN_NAMES.map((chainName) => {
    const metrics = { volume: [], holders: [], traders: [], value: [] };
    for (const item of selected) {
      const chain = item.chains.find((entry) => entry.chain === chainName);
      for (const metric of Object.keys(metrics)) {
        const value = finite(chain?.[metric]);
        if (value !== null) metrics[metric].push(value);
      }
    }
    return { chain: chainName, metrics };
  });
  const totals = Object.fromEntries(['volume', 'holders', 'traders', 'value'].map((metric) => [
    metric,
    sumValues(chains.map((chain) => chain.metrics[metric].at(-1)).filter((value) => value !== undefined))
  ]));
  const robinhoodCount = snapshot.robinhood?.deploymentCount;
  return {
    live: true,
    market,
    period,
    updated: new Date(snapshot.updated || snapshot.ts).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
    historyPoints: selected.length,
    totals,
    chains,
    note: `Live CMC RWA coverage across the five tracked networks${Number.isFinite(robinhoodCount) ? `; Robinhood reports ${robinhoodCount} active stock-token deployments` : ''}. Holder totals cover up to four leading tracked tokens per chain. Active-wallet history needs a separate onchain feed.`,
    sources: ['CoinMarketCap', 'Robinhood']
  };
}

export default async function handler(req, res) {
  const market = req.query.market === 'stocks' ? 'stocks' : 'rwa';
  const period = PERIOD_MS[req.query.period] ? req.query.period : '30d';
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');

  if (!process.env.CMC_API_KEY) {
    return res.status(503).json({ available: false, error: 'Live RWA data is not configured yet.' });
  }

  try {
    const snapshot = await currentSnapshot(market);
    const history = await storeHistory(market, snapshot);
    return res.status(200).json(responseFrom(history, snapshot, market, period));
  } catch (error) {
    const message = error?.status === 401 || error?.status === 403
      ? 'CoinMarketCap rejected this key or the current API plan does not include the RWA endpoint.'
      : error?.status === 429
        ? 'CoinMarketCap rate limit reached. Please try again shortly.'
        : 'Live RWA data could not be refreshed just now.';
    return res.status(502).json({ available: false, error: message });
  }
}
