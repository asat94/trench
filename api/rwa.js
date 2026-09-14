import { cacheGet, cacheSet } from './_cache.js';

const CMC = 'https://pro-api.coinmarketcap.com';
const ROBINHOOD = 'https://api.robinhood.com/rhj';
const LLAMA = 'https://api.llama.fi';
const CHAIN_NAMES = ['BNB Chain', 'Solana', 'Robinhood Chain', 'Ethereum', 'Base'];
const LLAMA_CHAINS = { 'BNB Chain': 'BSC', Solana: 'Solana', 'Robinhood Chain': 'Robinhood Chain', Ethereum: 'Ethereum', Base: 'Base' };
const PERIOD_MS = { '1d': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 };
const MAX_ASSETS = 100;

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

async function atStage(stage, request) {
  try { return await request; }
  catch (error) { error.stage = stage; throw error; }
}

function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function trackedChain(platform = {}) {
  const safePlatform = platform || {};
  const text = `${safePlatform.name || ''} ${safePlatform.slug || ''} ${safePlatform.symbol || ''}`.toLowerCase();
  if (/robinhood/.test(text)) return 'Robinhood Chain';
  if (/\b(bnb|bsc)\b|binance-smart-chain|bnb-smart-chain/.test(text)) return 'BNB Chain';
  if (/solana|\bsol\b/.test(text)) return 'Solana';
  if (/ethereum|\beth\b/.test(text)) return 'Ethereum';
  if (/\bbase\b/.test(text)) return 'Base';
  return null;
}

function blankChain(chain) {
  return { chain, tokenVolume1d: null, tokenVolume7d: null, tokenVolume30d: null, tokenValue: null, tokenCount: 0, contracts: [] };
}

function unpackInfo(data) {
  return Object.values(data?.data || {}).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
}

function unpackQuotes(data) {
  const assets = Array.isArray(data?.data) ? data.data : Object.values(data?.data || {}).flatMap((value) => Array.isArray(value) ? value : [value]);
  return assets.filter(Boolean).map((asset) => {
    const quotes = Array.isArray(asset.quote) ? asset.quote : Object.values(asset.quote || {});
    return [Number(asset.id), quotes.find((quote) => quote?.symbol === 'USD') || quotes[0] || {}];
  });
}

function addValue(target, key, value) {
  const number = finite(value);
  if (number !== null) target[key] = (target[key] || 0) + number;
}

async function fetchCmcMarket(market) {
  const listUrl = new URL(`${CMC}/v5/real-world-assets/assets/list`);
  listUrl.searchParams.set('limit', String(MAX_ASSETS));
  listUrl.searchParams.set('sort', 'tokenized_market_cap');
  listUrl.searchParams.set('sort_dir', 'desc');
  listUrl.searchParams.set('convert', 'USD');
  if (market === 'stocks') listUrl.searchParams.set('asset_type', 'stock');

  const list = await atStage('cmc-rwa-list', getJson(listUrl, { headers: cmcHeaders() }));
  const assets = list?.data?.rwa_assets || [];
  const ids = assets.map((asset) => asset.rwa_id).filter(Boolean).slice(0, MAX_ASSETS);
  if (!ids.length) throw new Error('CoinMarketCap returned no RWA assets.');

  const quoteUrl = new URL(`${CMC}/v5/real-world-assets/quotes/latest`);
  quoteUrl.searchParams.set('rwa_id', ids.join(','));
  quoteUrl.searchParams.set('convert', 'USD');
  quoteUrl.searchParams.set('skip_invalid', 'true');
  const quoteData = await atStage('cmc-rwa-quotes', getJson(quoteUrl, { headers: cmcHeaders() }));
  const rwaAssets = quoteData?.data?.rwa_assets || [];
  const tokens = rwaAssets.flatMap((asset) => (asset.tokens || []).map((token) => ({
    ...token,
    assetType: asset.asset_type,
    rwaId: asset.rwa_id
  }))).filter((token) => token.crypto_id);

  const tokenIds = [...new Set(tokens.map((token) => token.crypto_id))].slice(0, 250);
  const tokenBatches = chunks(tokenIds, 100);
  const [infoPages, marketPages] = tokenIds.length ? await Promise.all([
    atStage('cmc-token-platforms', Promise.all(tokenBatches.map((ids) => {
      const infoUrl = new URL(`${CMC}/v2/cryptocurrency/info`);
      infoUrl.searchParams.set('id', ids.join(','));
      infoUrl.searchParams.set('aux', 'platform');
      infoUrl.searchParams.set('skip_invalid', 'true');
      return getJson(infoUrl, { headers: cmcHeaders() });
    }))),
    atStage('cmc-token-periods', Promise.all(tokenBatches.map((ids) => {
      const marketUrl = new URL(`${CMC}/v3/cryptocurrency/quotes/latest`);
      marketUrl.searchParams.set('id', ids.join(','));
      marketUrl.searchParams.set('aux', 'volume_7d,volume_30d');
      marketUrl.searchParams.set('skip_invalid', 'true');
      return getJson(marketUrl, { headers: cmcHeaders() });
    })))
  ]) : [[], []];
  const infoById = new Map(infoPages.flatMap(unpackInfo).map((item) => [Number(item.id), item]));
  const quoteById = new Map(marketPages.flatMap(unpackQuotes));
  const chains = new Map(CHAIN_NAMES.map((chain) => [chain, blankChain(chain)]));

  for (const token of tokens) {
    const platform = infoById.get(Number(token.crypto_id))?.platform;
    const chainName = trackedChain(platform);
    if (!chainName) continue;
    const chain = chains.get(chainName);
    const quote = quoteById.get(Number(token.crypto_id)) || {};
    addValue(chain, 'tokenVolume1d', quote.volume_24h ?? token.volume_24h);
    addValue(chain, 'tokenVolume7d', quote.volume_7d);
    addValue(chain, 'tokenVolume30d', quote.volume_30d);
    addValue(chain, 'tokenValue', quote.market_cap ?? token.market_cap);
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

async function fetchDefiLlama() {
  const dexRequests = CHAIN_NAMES.map(async (chain) => {
    try {
      const slug = encodeURIComponent(LLAMA_CHAINS[chain]);
      const data = await getJson(`${LLAMA}/overview/dexs/${slug}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`, {}, 8000);
      const cutoff = Date.now() / 1000 - 31 * 86400;
      const series = (data?.totalDataChart || []).map((point) => [Number(point[0]), finite(point[1])]).filter(([timestamp, value]) => timestamp >= cutoff && value !== null);
      return [chain, { dexVolume1d: finite(data?.total24h), dexVolume7d: finite(data?.total7d), dexVolume30d: finite(data?.total30d), dexSeries: series }];
    } catch { return [chain, { dexVolume1d: null, dexVolume7d: null, dexVolume30d: null, dexSeries: [] }]; }
  });
  const [dexEntries, tvlData] = await Promise.all([
    Promise.all(dexRequests),
    getJson(`${LLAMA}/v2/chains`, {}, 8000).catch(() => [])
  ]);
  const tvlByChain = new Map((tvlData || []).map((item) => [String(item.name).toLowerCase(), finite(item.tvl)]));
  return new Map(dexEntries.map(([chain, data]) => {
    const llamaName = LLAMA_CHAINS[chain].toLowerCase();
    return [chain, { ...data, tvl: tvlByChain.get(llamaName) ?? null }];
  }));
}

async function currentSnapshot(market) {
  const cacheKey = `trench:rwa:current:v5:${market}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const [cmc, robinhood, defi] = await Promise.all([fetchCmcMarket(market), fetchRobinhoodCoverage(), fetchDefiLlama()]);
  const snapshot = {
    ts: Date.now(),
    updated: cmc.updated,
    assetCount: cmc.assetCount,
    robinhood,
    chains: cmc.chains.map(({ contracts, ...chain }) => ({ ...chain, ...defi.get(chain.chain) }))
  };
  await cacheSet(cacheKey, snapshot, 3600);
  return snapshot;
}
function responseFrom(snapshot, market, period) {
  const cutoff = Date.now() / 1000 - PERIOD_MS[period] / 1000;
  const chains = CHAIN_NAMES.map((chainName) => {
    const chain = snapshot.chains.find((entry) => entry.chain === chainName) || {};
    const metricValue = (value) => finite(value) === null ? [] : [finite(value)];
    const metrics = {
      tokenVolume: metricValue(chain[`tokenVolume${period}`]),
      tokenValue: metricValue(chain.tokenValue),
      dexVolume: (chain.dexSeries || []).filter(([timestamp]) => timestamp >= cutoff).map(([, value]) => value),
      tvl: metricValue(chain.tvl)
    };
    const summaries = {
      tokenVolume: finite(chain[`tokenVolume${period}`]),
      tokenValue: finite(chain.tokenValue),
      dexVolume: finite(chain[`dexVolume${period}`]),
      tvl: finite(chain.tvl)
    };
    return { chain: chainName, metrics, summaries };
  });
  const totals = Object.fromEntries(['tokenVolume', 'tokenValue', 'dexVolume', 'tvl'].map((metric) => [
    metric,
    sumValues(chains.map((chain) => chain.summaries[metric]))
  ]));
  return {
    live: true,
    market,
    period,
    updated: new Date(snapshot.updated || snapshot.ts).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
    totals,
    chains,
    sources: ['CoinMarketCap', 'DefiLlama']
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
    return res.status(200).json(responseFrom(snapshot, market, period));
  } catch (error) {
    const message = error?.status === 401 || error?.status === 403
      ? 'CoinMarketCap rejected this key or the current API plan does not include the RWA endpoint.'
      : error?.status === 429
        ? 'CoinMarketCap rate limit reached. Please try again shortly.'
        : 'Live RWA data could not be refreshed just now.';
    return res.status(502).json({ available: false, error: message, stage: error?.stage || 'aggregation' });
  }
}
