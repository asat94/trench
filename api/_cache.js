const memory = new Map();
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

function memoryValue(key) {
  const entry = memory.get(key);
  return entry?.expires > Date.now() ? entry.value : null;
}

async function redisRequest(command) {
  if (!redisUrl || !redisToken) return null;
  try {
    const response = await fetch(`${redisUrl.replace(/\/$/, '')}/${command}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
      signal: AbortSignal.timeout(3500)
    });
    return response.ok ? response.json() : null;
  } catch { return null; }
}

export async function cacheGet(key) {
  const local = memoryValue(key);
  if (local) return local;
  const response = await redisRequest(`get/${encodeURIComponent(key)}`);
  if (!response?.result) return null;
  try {
    const value = JSON.parse(response.result);
    memory.set(key, { value, expires: Date.now() + 60 * 60 * 1000 });
    return value;
  } catch { return null; }
}

export async function cacheSet(key, value, seconds = 86400) {
  memory.set(key, { value, expires: Date.now() + seconds * 1000 });
  await redisRequest(`set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/EX/${seconds}`);
}
