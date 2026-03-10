/**
 * redis.ts — IORedis Singleton
 *
 * A single Redis connection shared across the process.  In Next.js dev mode,
 * hot-reload would create new connections on every file change, so we pin the
 * client to the Node.js global object the same way we do with Prisma.
 *
 * Edge-Case Coverage:
 *  - Network partition: ioredis retries with exponential backoff by default.
 *  - OOM: Redis is configured with maxmemory=512mb + allkeys-lru in docker-compose.
 *  - Silent failure guard: error events are logged; unhandled rejections surface.
 */

import IORedis from "ioredis";
import { log } from "@/lib/logger";

const globalForRedis = globalThis as unknown as {
    redis: IORedis | undefined;
};

function createRedisClient(): IORedis {
    if (!process.env.REDIS_URL) {
        throw new Error("[Redis] REDIS_URL environment variable is not set.");
    }

    const client = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ compatibility
        enableReadyCheck: true,
        lazyConnect: false,
    });

    client.on("connect", () =>
        log.info('redis', 'Connected to Redis server')
    );
    client.on("error", (err) =>
        log.error('redis', 'Connection error', { error: err.message })
    );
    client.on("reconnecting", (delay: number) =>
        log.warn('redis', 'Reconnecting', { delayMs: delay })
    );

    return client;
}

export const redis: IORedis =
    globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = redis;
}
