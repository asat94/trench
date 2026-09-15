import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './_cache.js';
import { NETWORKS, loadRegistry } from './_rwa-registry.js';
import { bitquery, volumeQuery, holdersQuery, parseVolume, parseHolders } from './_bitquery.js';
import { normalizeRows } from './_rwa-data.js';

const DAY = 86400000;
const pending = new Map();
const attempts = new Map();
async function reserveRefresh(key, signal) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const response = await fetch(url.replace(/\/$/, ''), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', `${key}:lease`, '1', 'NX', 'EX', 300]), signal
    });
    if (!response.ok) throw new Error('cache_unavailable');
    const body = await response.json();
    return body.result === 'OK';
  }
  if ((attempts.get(key) || 0) > Date.now()) return false;
  attempts.set(key, Date.now() + 300000);
  return true;
}
async function cachedQuery(key, query, variables, signal) {
  const cached = await cacheGet(key);
  if (cached && Date.now() - cached.at < (cached.error ? 300000 : 6 * 3600000)) return cached;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    if (!await reserveRefresh(key, signal)) return cached || { error: 'refreshing' };
    let result;
    try { result = { data: await bitquery(query, variables, signal), at: Date.now() }; }
    catch (error) { result = { error: error.code || 'unavailable', detail: error.details, at: Date.now() }; }
    // Failed requests are cached briefly, so refreshing the UI doesn't burn credits.
    await cacheSet(key, result, result.error ? 300 : 21600);
    return result;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
export async function fetchBitqueryPulse(market, period, now = Date.now()) {
  const signal = AbortSignal.timeout(50000);
  const end = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, i) => new Date(end - (30 - i) * DAY).toISOString().slice(0, 10));
  const selectedDays = days.slice(-parseInt(period));
  const registry = await loadRegistry(market, signal);
  const issues = [];
  const refreshed = [];
  const results = await Promise.all(Object.entries(NETWORKS).map(async ([chain, network]) => {
    const tokens = registry.contracts[network] || [];
    if (!tokens.length) { issues.push({ chain, metric: 'both', code: 'no_contracts' }); return []; }
    const hash = createHash('sha256').update(tokens.join(',')).digest('hex').slice(0, 16);
    const base = `trench:rwa:bitquery:v1:${network}:${hash}:${days.at(-1)}`;
    const holders = holdersQuery(network, selectedDays);
    const [volumeResult, holderResult] = await Promise.all([
      cachedQuery(`${base}:volume`, volumeQuery(network), { tokens, from: `${days[0]}T00:00:00Z`, to: new Date(end).toISOString() }, signal),
      holders ? cachedQuery(`${base}:holders:${period}`, holders, { tokens }, signal) : Promise.resolve({ error: 'history_unsupported' })
    ]);
    let volumes = new Map(), counts = new Map();
    try {
      if (volumeResult.error) { const error = new Error(volumeResult.error); error.detail = volumeResult.detail; throw error; }
      volumes = parseVolume(volumeResult.data, days);
      if (volumes.size) refreshed.push(volumeResult.at);
    } catch (error) { issues.push({ chain, metric: 'volume', code: error.code || error.message, detail: error.detail }); }
    try {
      if (holderResult.error) { const error = new Error(holderResult.error); error.detail = holderResult.detail; throw error; }
      counts = parseHolders(holderResult.data, selectedDays);
      if ([...counts.values()].some(Number.isFinite)) refreshed.push(holderResult.at);
    } catch (error) { issues.push({ chain, metric: 'holders', code: error.code || error.message, detail: error.detail }); }
    return selectedDays.map((day) => ({ blockchain: chain, day, onchain_volume_usd: volumes.get(day) ?? null, holders: counts.get(day) ?? null }));
  }));
  return {
    rows: normalizeRows(results.flat()), updated: refreshed.length ? new Date(Math.min(...refreshed)).toISOString() : null, issues,
    tokenCounts: Object.fromEntries(Object.entries(NETWORKS).map(([chain, network]) => [chain, registry.contracts[network]?.length || 0]))
  };
}
