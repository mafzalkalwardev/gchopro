import { AppError, RATE_LIMITS, SAFE_TEXT, type RateLimitScope } from "@gchopro/core";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis } from "./redis.js";

const limiters = new Map<RateLimitScope, RateLimiterRedis>();

function limiter(scope: RateLimitScope): RateLimiterRedis {
  const existing = limiters.get(scope);
  if (existing) return existing;
  const budget = new Map<string, { points: number; durationSeconds: number }>(
    Object.entries(RATE_LIMITS),
  ).get(scope);
  if (budget === undefined) throw new AppError(500, "internal", "The request failed.");
  const created = new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: `rl:${scope}`,
    points: budget.points,
    duration: budget.durationSeconds,
  });
  limiters.set(scope, created);
  return created;
}

export async function consumeLimit(scope: RateLimitScope, key: string): Promise<void> {
  try {
    await limiter(scope).consume(key, 1);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      throw new AppError(429, "rate_limited", SAFE_TEXT.rate_limited);
    }
    throw new AppError(503, "rate_limited", SAFE_TEXT.rate_limited);
  }
}
