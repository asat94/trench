import { cacheGet, cacheSet } from './_cache.js';

const CMC = 'https://pro-api.coinmarketcap.com';
export const NETWORKS = { 'BNB Chain': 'bsc', Solana: 'solana', 'Robinhood Chain': 'robinhood', Ethereum: 'eth', Base: 'base' };
export function networkOf(platform) {
  const name = `${platform?.name || ''} ${platform?.slug || ''} ${platform?.symbol || ''}`.toLowerCase();
  if (/robinhood/.test(name)) return 'robinhood';
  if (/\bbase\b/.test(name)) return 'base';
  if (/\b(bnb|bsc)\b|binance-smart-chain|bnb-smart-chain/.test(name)) return 'bsc';
  if (/solana|\bsol\b/.test(name)) return 'solana';
  if (/ethereum|\beth\b/.test(name)) return 'eth';
  return null;
}
export function validAddress(network, value) {
  const address = String(value || '').trim();
  if (network === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
}
export function contractsFromInfo(items) {
  const contracts = Object.fromEntries(Object.values(NETWORKS).map((n) => [n, new Set()]));
  for (const token of items) {
    const deployments = [{ platform: token.platform, contract_address: token.platform?.token_address }, ...(Array.isArray(token.contract_address) ? token.contract_address : [])];
    for (const deployment of deployments) {
      const network = networkOf(deployment.platform);
      const address = network && validAddress(network, deployment.contract_address);
      if (address) contracts[network].add(address);
    }
    const explorers = { 'etherscan.io': 'eth', 'bscscan.com': 'bsc', 'basescan.org': 'base', 'solscan.io': 'solana' };
    for (const explorer of token.urls?.explorer || []) {
      try {
        const url = new URL(explorer);
        const network = explorers[url.hostname.replace(/^www\./, '')];
        const match = url.pathname.match(/^\/token\/([^/]+)\/?$/);
        const address = network && match && validAddress(network, match[1]);
        if (address) contracts[network].add(address);
      } catch { /* Ignore malformed catalogue links. */ }
    }
  }
  return Object.fromEntries(Object.entries(contracts).map(([n, values]) => [n, [...values].sort()]));
}
async function cmc(path, params, signal) {
  const url = new URL(path, CMC);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }, signal });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(`registry_http_${response.status}`);
    let message = String(body.status?.error_message || '');
    for (const key of ['CMC_API_KEY', 'BITQUERY_ACCESS_TOKEN', 'DUNE_API_KEY']) {
      if (process.env[key]) message = message.split(process.env[key]).join('[redacted]');
    }
    error.details = { endpoint: path, code: /^\d+$/.test(String(body.status?.error_code)) ? Number(body.status.error_code) : null, message: message.slice(0, 500) };
    throw error;
  }
  // CMC endpoints may encode the success code as either 0 or "0".
  // A truthiness check treats "0" as an error and prevents every Bitquery request.
  const code = body.status?.error_code;
  if (code !== undefined && code !== null && Number(code) !== 0) {
    const safeCode = /^\d+$/.test(String(code)) ? String(code) : 'unknown';
    throw new Error(`registry_rejected_${safeCode}`);
  }
  return body.data;
}
export async function loadRegistry(market, signal) {
  const key = `trench:rwa:registry:v1:${market}`;
  const cached = await cacheGet(key);
  if (cached && Date.now() - cached.created < 86400000) return cached;
  if (!process.env.CMC_API_KEY) throw new Error('registry_key_missing');
  const assets = [];
  let complete = false;
  // CMC's catalogue includes underlying assets without any issued tokens.
  // Advance by the number actually returned, and use total_size as well as has_more.
  let offset = 1;
  for (let page = 0; page < 64; page++) {
    const pageKey = `${key}:page:${offset}`;
    let data = await cacheGet(pageKey);
    if (!data) {
      data = await cmc('/v5/real-world-assets/assets/list', { start: offset, limit: 250, sort: 'rwa_rank', sort_dir: 'asc', ...(market === 'stocks' ? { asset_type: 'stock' } : {}) }, signal);
      await cacheSet(pageKey, data, 3600);
    }
    if (!Array.isArray(data?.rwa_assets)) throw new Error('registry_invalid');
    assets.push(...data.rwa_assets.filter((a) => a.has_tokens));
    offset += data.rwa_assets.length;
    const total = Number(data.total_size);
    if (data.has_more === false || data.has_more === 'false' || (Number.isFinite(total) && total >= 0 && offset > total)) { complete = true; break; }
    if (!data.rwa_assets.length) throw new Error('registry_catalogue_incomplete');
  }
  if (!complete) throw new Error('registry_catalogue_incomplete');
  const ids = [...new Set(assets.map((a) => a.rwa_id).filter((id) => Number.isInteger(id) && id > 0))];
  const tokenIds = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const data = await cmc('/v5/real-world-assets/quotes/latest', { rwa_id: ids.slice(i, i + 100).join(',') }, signal);
    if (!Array.isArray(data?.rwa_assets)) throw new Error('registry_invalid');
    for (const asset of data.rwa_assets) {
      if (market === 'stocks' && asset.asset_type !== 'stock') continue;
      for (const token of asset.tokens || []) if (Number.isInteger(token.crypto_id)) tokenIds.add(token.crypto_id);
    }
  }
  if (!tokenIds.size || tokenIds.size > 1500) throw new Error('registry_token_coverage');
  const info = [];
  const tokens = [...tokenIds];
  for (let i = 0; i < tokens.length; i += 100) {
    const data = await cmc('/v2/cryptocurrency/info', { id: tokens.slice(i, i + 100).join(','), skip_invalid: 'true' }, signal);
    if (!data || typeof data !== 'object') throw new Error('registry_invalid');
    info.push(...Object.values(data).flatMap((value) => Array.isArray(value) ? value : [value]));
  }
  const registry = { created: Date.now(), contracts: contractsFromInfo(info), tokenCount: tokens.length };
  // The issuer's public catalogue provides deployments missing from primary-platform metadata.
  try {
    const response = await fetch('https://api.robinhood.com/rhj/assets', { signal });
    if (response.ok) {
      const body = await response.json();
      const symbols = new Set(assets.map((a) => String(a.symbol).toUpperCase()));
      const robinhood = new Set(registry.contracts.robinhood);
      for (const asset of body.assets || []) {
        if (asset.status !== 'ASSET_STATUS_ACTIVE' || !symbols.has(String(asset.tokenSymbol).toUpperCase())) continue;
        for (const deployment of asset.deployments || []) {
          const address = Number(deployment.chainId) === 4663 && validAddress('robinhood', deployment.contractAddress);
          if (address) robinhood.add(address);
        }
      }
      registry.contracts.robinhood = [...robinhood].sort();
    }
  } catch { /* CMC deployments remain available if the public catalogue is down. */ }
  await cacheSet(key, registry, 86400);
  return registry;
}
