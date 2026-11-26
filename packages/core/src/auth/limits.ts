export const RATE_LIMITS = {
  loginIp: { points: 20, durationSeconds: 60 },
  loginUsername: { points: 5, durationSeconds: 15 * 60 },
  portalApi: { points: 120, durationSeconds: 60 },
  adminApi: { points: 300, durationSeconds: 60 },
  deviceApi: { points: 120, durationSeconds: 60 },
  registerIp: { points: 10, durationSeconds: 60 },
  csvImport: { points: 5, durationSeconds: 60 * 60 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;
