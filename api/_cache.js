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

async function reserveMemorySlot(key, limit, windowMs) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const bucketKey = `${key}:${bucket}`;
  const count = rateBuckets.get(bucketKey) || 0;
  if (count >= limit) return false;
  rateBuckets.set(bucketKey, count + 1);
  return true;
}

async function reserveRedisSlot(key, limit, windowMs) {
  const bucketKey = `${key}:${Math.floor(Date.now() / windowMs)}`;
  const count = await redisRequest(`incr/${encodeURIComponent(bucketKey)}`);
  const value = Number(count?.result);
  if (!Number.isFinite(value)) return null;
  if (value === 1) await redisRequest(`expire/${encodeURIComponent(bucketKey)}/${Math.max(2, Math.ceil(windowMs * 2 / 1000))}`);
  return value <= limit;
}

// Coordinates all serverless instances so a free provider plan is never burst.
export async function takeRateLimitSlot(key, limit = 1, timeout = 15000, windowMs = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const reserved = await reserveRedisSlot(key, limit, windowMs);
    if (reserved === true || (reserved === null && await reserveMemorySlot(key, limit, windowMs))) return;
    const untilNextWindow = windowMs - (Date.now() % windowMs);
    await pause(Math.max(80, untilNextWindow + 25));
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
