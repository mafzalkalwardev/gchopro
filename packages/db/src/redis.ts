import { loadEnv } from "@gchopro/core";
import { Redis } from "ioredis";

let cached: Redis | undefined;

export function getRedis(): Redis {
  if (cached) return cached;
  cached = new Redis(loadEnv().REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  return cached;
}

export async function publishUser(userId: string, payload: unknown): Promise<void> {
  await getRedis().publish(`user:${userId}`, JSON.stringify(payload));
}

export async function closeRedis(): Promise<void> {
  if (!cached) return;
  await cached.quit();
  cached = undefined;
}

/** Dedicated connection. The shared client cannot subscribe and run commands. */
export function openUserEvents(
  userId: string,
  onMessage: (message: string) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  const redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
  const ready = redis.subscribe(`user:${userId}`).then(() => {
    redis.on("message", (_channel: string, message: string) => {
      onMessage(message);
    });
  });
  return {
    ready,
    close: async () => {
      await ready.catch(() => undefined);
      redis.disconnect();
    },
  };
}
