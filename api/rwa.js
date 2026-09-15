import { fetchPublicPulse, createPublicPulse } from './_rwa-public.js';

// Limited public view: no paid archive queries and no invented time ranges.
export default async function handler(req, res) {
  const market = req.query.market === 'stocks' ? 'stocks' : 'rwa';
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await fetchPublicPulse(market);
    if (!result.available) throw new Error('public_unavailable');
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json(result);
  } catch {
    return res.status(503).json({ ...createPublicPulse([], market), message: 'The public snapshot is temporarily unavailable. Please try again later.' });
  }
}
