/**
 * Redis client singleton (ioredis). Used later for BullMQ queues, rate
 * limiting, and hot-report caching. Lazy-connects on first command so the
 * app still boots when Redis is briefly unavailable at startup.
 */
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis(): Redis {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  // Never crash the server process on background connection errors.
  client.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
  return client;
}

export const redis: Redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
