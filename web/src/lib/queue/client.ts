/**
 * lib/queue/client.ts
 * BullMQ Redis connection options (plain object, NOT an IORedis instance).
 *
 * Why a plain options object instead of an IORedis instance?
 * BullMQ bundles its own vendored copy of ioredis internally. Passing an
 * IORedis instance from the top-level `ioredis` package causes a structural
 * type incompatibility between the two versions' AbstractConnector classes.
 * Passing a plain options object sidesteps this entirely — BullMQ constructs
 * its own internal IORedis client from the options.
 *
 * BullMQ requirement: maxRetriesPerRequest MUST be null for blocking operations.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Shared BullMQ connection options.
 * Pass this directly to `new Queue(name, { connection })` and
 * `new Worker(name, fn, { connection })`.
 */
export const redisConnection = {
    url: REDIS_URL,
    maxRetriesPerRequest: null as null, // Required by BullMQ
    enableReadyCheck: false,
    reconnectOnError(err: Error) {
        return err.message.startsWith("READONLY");
    },
};

export type RedisConnectionOptions = typeof redisConnection;
