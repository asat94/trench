import { cacheGet, cacheSet } from './_cache.js';
import { normalizeRows, createPulse } from './_rwa-data.js';
import { fetchBitqueryPulse } from './_rwa-bitquery.js';

export default async function handler(req, res) {
  const market = req.query.market === 'stocks' ? 'stocks' : 'rwa';
  const period = ['1d', '7d', '30d'].includes(req.query.period) ? req.query.period : '30d';
  const queryId = market === 'stocks' ? process.env.DUNE_STOCKS_QUERY_ID : process.env.DUNE_RWA_QUERY_ID;
  const empty = (reason, message) => ({ ...createPulse([], market, period, null), available: false, reason, message });
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.BITQUERY_ACCESS_TOKEN?.trim()) {
    try {
      const snapshot = await fetchBitqueryPulse(market, period);
      const result = createPulse(snapshot.rows, market, period, snapshot.updated);
      const available = result.coverage.volume > 0 || result.coverage.holders > 0;
      res.setHeader('Cache-Control', 's-maxage=300');
      return res.status(200).json({ ...result, available, version: 'bitquery-v1.1', tokenCounts: snapshot.tokenCounts,
        reason: available ? 'partial_coverage' : 'provider_unavailable',
        message: available ? 'Figures cover tracked token contracts. Some networks or historical dates may be unavailable.' : 'Data could not be loaded for this period. Please try again later.',
        // Safe codes make deployment diagnosis possible without exposing keys or queries.
        diagnostics: snapshot.issues
      });
    } catch (error) {
      const known = ['registry_key_missing', 'registry_invalid', 'registry_catalogue_incomplete', 'registry_token_coverage', 'registry_rejected'];
      const code = known.includes(error.message) || /^registry_http_\d{3}$/.test(error.message) || /^registry_rejected_(\d+|unknown)$/.test(error.message) ? error.message : 'upstream_unavailable';
      return res.status(502).json({ ...empty(code, 'Data could not be loaded for this period. Please try again later.'), version: 'bitquery-v1.2', diagnostics: error.details || null });
    }
  }
  if (!process.env.DUNE_API_KEY || !/^\d+$/.test(queryId || '')) {
    return res.status(200).json(empty('setup_required', 'Market data is being connected.'));
  }
  try {
    const cacheKey = `trench:rwa:dune:v1:${market}:${queryId}`;
    let snapshot = await cacheGet(cacheKey);
    if (!snapshot) {
      const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results?limit=10000`, {
        headers: { 'X-Dune-API-Key': process.env.DUNE_API_KEY },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('Data request failed');
      const data = await response.json();
      if (data.state !== 'QUERY_STATE_COMPLETED' || data.next_offset != null || data.next_uri || !Array.isArray(data.result?.rows)) throw new Error('Incomplete query result');
      const updated = data.execution_ended_at;
      if (!updated || !Number.isFinite(Date.parse(updated)) || Date.now() - Date.parse(updated) > 48 * 3600000) throw new Error('Query needs refreshing');
      const rows = normalizeRows(data.result.rows);
      snapshot = { rows, updated };
      await cacheSet(cacheKey, snapshot, 900);
    }
    if (Date.now() - Date.parse(snapshot.updated) > 48 * 3600000) throw new Error('Cached query needs refreshing');
    const result = createPulse(snapshot.rows, market, period, snapshot.updated);
    return res.status(200).json({ ...result, available: result.coverage.volume > 0 || result.coverage.holders > 0 });
  } catch {
    return res.status(502).json(empty('unavailable', 'Market data is temporarily unavailable.'));
  }
}
