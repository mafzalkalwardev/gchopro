import {
  SESSION_CACHE_SECONDS,
  effectiveStatus,
  newSessionToken,
  portalAccess,
  sessionIdFromToken,
  sessionRejection,
  sessionWindow,
  slideExpiry,
  type SessionRejection,
  type SubStatus,
} from "@gchopro/core";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "./client.js";
import { getRedis } from "./redis.js";
import { sessions, subscriptions, users } from "./schema.js";
export type RevokeReason =
  | "logout"
  | "password_reset"
  | "password_change"
  | "user_disabled"
  | "subscription_inactive"
  | "admin_revoke"
  | "sim_unassigned"
  | "expired";

export type SessionRecord = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  app: "admin" | "portal";
  mfaVerified: boolean;
  mustChangePassword: boolean;
  allowSelfPasswordChange: boolean;
  totpEnabled: boolean;
  aupAcceptedAt: string | null;
  readOnly: boolean;
  scheduled: boolean;
  blocked: boolean;
  expiresAt: string;
  absoluteExpiresAt: string;
  passwordChangedAt: string;
  sessionCreatedAt: string;
  userStatus: "active" | "disabled";
  deletedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string;
};

type Query = Pick<Db, "insert" | "update" | "select">;

function cacheKey(sessionId: string): string {
  return `sess:${sessionId}`;
}

export async function forgetSessions(sessionIds: readonly string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await getRedis().del(...sessionIds.map(cacheKey));
}

export async function publishRevoked(userId: string, reason: RevokeReason): Promise<void> {
  await getRedis().publish(`user:${userId}`, JSON.stringify({ reason }));
}

export async function createSession(
  db: Query,
  input: {
    userId: string;
    app: "admin" | "portal";
    mfaVerified: boolean;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  },
): Promise<string> {
  const token = newSessionToken();
  const window = sessionWindow(input.app, input.now);
  await db.insert(sessions).values({
    id: sessionIdFromToken(token),
    userId: input.userId,
    app: input.app,
    mfaVerified: input.mfaVerified,
    ip: input.ip,
    userAgent: input.userAgent === null ? null : input.userAgent.slice(0, 300),
    lastSeenAt: input.now,
    expiresAt: window.expiresAt,
    absoluteExpiresAt: window.absoluteExpiresAt,
  });
  return token;
}

export async function revokeAllSessions(
  db: Query,
  input: { userId: string; reason: RevokeReason; exceptSessionId?: string; now: Date },
): Promise<string[]> {
  const filters = [eq(sessions.userId, input.userId), isNull(sessions.revokedAt)];
  if (input.exceptSessionId !== undefined) filters.push(ne(sessions.id, input.exceptSessionId));
  const updated = await db
    .update(sessions)
    .set({ revokedAt: input.now, revokeReason: input.reason })
    .where(and(...filters))
    .returning({ id: sessions.id });
  return updated.map((row) => row.id);
}

export async function markMfaVerified(db: Query, sessionId: string): Promise<void> {
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
  await forgetSessions([sessionId]);
}

export async function readSession(
  token: string | undefined,
  now = new Date(),
): Promise<SessionRecord | SessionRejection | null> {
  if (token === undefined || token.length === 0) return null;
  const sessionId = sessionIdFromToken(token);
  const redis = getRedis();
  try {
    const cached = await redis.get(cacheKey(sessionId));
    if (cached !== null) {
      const record = JSON.parse(cached) as SessionRecord;
      record.blocked = record.blocked ?? false;
      const rejection = rejectionOf(record, now);
      if (rejection !== null) return rejection;
      return record;
    }
  } catch {
    // A cache miss falls through to Postgres. Revocation still deletes the key.
  }
  const db = (await import("./client.js")).getDb();
  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const record: SessionRecord = {
    sessionId,
    userId: row.user.id,
    username: row.user.username,
    displayName: row.user.displayName,
    role: row.user.role,
    app: row.session.app,
    mfaVerified: row.session.mfaVerified,
    mustChangePassword: row.user.mustChangePassword,
    allowSelfPasswordChange: row.user.allowSelfPasswordChange,
    totpEnabled: row.user.totpEnabled,
    aupAcceptedAt: row.user.aupAcceptedAt === null ? null : row.user.aupAcceptedAt.toISOString(),
    readOnly: false,
    scheduled: false,
    blocked: false,
    expiresAt: row.session.expiresAt.toISOString(),
    absoluteExpiresAt: row.session.absoluteExpiresAt.toISOString(),
    passwordChangedAt: row.user.passwordChangedAt.toISOString(),
    sessionCreatedAt: row.session.createdAt.toISOString(),
    userStatus: row.user.status,
    deletedAt: row.user.deletedAt === null ? null : row.user.deletedAt.toISOString(),
    revokedAt: row.session.revokedAt === null ? null : row.session.revokedAt.toISOString(),
    lastSeenAt: row.session.lastSeenAt.toISOString(),
  };
  const rejection = rejectionOf(record, now);
  if (rejection !== null) return rejection;
  await applyPortalAccess(db, record, row.user.simId, now);
  if (now.getTime() - row.session.lastSeenAt.getTime() >= 60_000) {
    const expiresAt = slideExpiry(record.app, now, row.session.absoluteExpiresAt);
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, sessionId));
    record.lastSeenAt = now.toISOString();
    record.expiresAt = expiresAt.toISOString();
  }
  try {
    await redis.set(cacheKey(sessionId), JSON.stringify(record), "EX", SESSION_CACHE_SECONDS);
  } catch {
    // The database remains the source of truth.
  }
  return record;
}

function accessRank(status: SubStatus): number {
  if (status === "active") return 0;
  if (status === "scheduled") return 1;
  if (status === "paused") return 2;
  if (status === "expired") return 3;
  return 4;
}

async function applyPortalAccess(
  db: Query,
  record: SessionRecord,
  simId: string | null,
  now: Date,
): Promise<void> {
  if (record.app !== "portal") return;
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, record.userId));
  const current = [...rows].sort(
    (left, right) => accessRank(left.status) - accessRank(right.status),
  )[0];
  const access = portalAccess({
    status: record.userStatus,
    deletedAt: record.deletedAt === null ? null : new Date(record.deletedAt),
    simId,
    ipAllowed: true,
    subscription:
      current === undefined
        ? null
        : {
            status: effectiveStatus({
              status: current.status,
              startsAt: current.startsAt,
              endsAt: current.endsAt,
              now,
            }),
            expiryBehavior: current.expiryBehavior,
          },
  });
  if (!access.ok) {
    record.blocked = true;
    return;
  }
  record.readOnly = access.readOnly;
  record.scheduled = access.scheduled;
}

function rejectionOf(record: SessionRecord, now: Date): SessionRejection | null {
  const revokedAt = record.revokedAt ?? null;
  return sessionRejection({
    revokedAt: revokedAt === null ? null : new Date(revokedAt),
    expiresAt: new Date(record.expiresAt),
    absoluteExpiresAt: new Date(record.absoluteExpiresAt),
    now,
    userStatus: record.userStatus,
    deletedAt: record.deletedAt === null ? null : new Date(record.deletedAt),
    passwordChangedAt: new Date(record.passwordChangedAt),
    sessionCreatedAt: new Date(record.sessionCreatedAt),
  });
}

export function isSessionRecord(
  value: SessionRecord | SessionRejection | null,
): value is SessionRecord {
  return value !== null && typeof value === "object" && "sessionId" in value;
}
