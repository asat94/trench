const memory = new Map();
const rateBuckets = new Map();
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveMemorySlot(key, limit) {
  const now = Date.now();
  const bucket = Math.floor(now / 1000);
  const bucketKey = `${key}:${bucket}`;
  const count = rateBuckets.get(bucketKey) || 0;
  if (count >= limit) return false;
  rateBuckets.set(bucketKey, count + 1);
  return true;
}

async function reserveRedisSlot(key, limit) {
  const bucketKey = `${key}:${Math.floor(Date.now() / 1000)}`;
  const count = await redisRequest(`incr/${encodeURIComponent(bucketKey)}`);
  const value = Number(count?.result);
  if (!Number.isFinite(value)) return null;
  if (value === 1) await redisRequest(`expire/${encodeURIComponent(bucketKey)}/2`);
  return value <= limit;
}

// Coordinates all serverless instances so the free provider plan is not burst.
export async function takeRateLimitSlot(key, limit = 2, timeout = 9000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const reserved = await reserveRedisSlot(key, limit);
    if (reserved === true || (reserved === null && await reserveMemorySlot(key, limit))) return;
    const untilNextSecond = 1000 - (Date.now() % 1000);
    await pause(Math.max(80, untilNextSecond + 25));
  }
  throw new Error('Live data is busy. Please try again shortly.');
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
