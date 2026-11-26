import { randomUUID } from "node:crypto";
import {
  AppError,
  SAFE_TEXT,
  accessStep,
  decryptField,
  dummyPasswordHash,
  encryptField,
  hashPassword,
  hashRecoveryCodes,
  ipAllowedByUser,
  loadEnv,
  matchRecoveryCode,
  matchTotpStep,
  needsRehash,
  newRecoveryCodes,
  newTotpSecret,
  passwordRejection,
  portalAccess,
  qrSvg,
  totpKeyUri,
  totpSecretBytes,
  totpSecretText,
  verifyPassword,
  type PortalBlock,
} from "@gchopro/core";
import { eq } from "drizzle-orm";
import { appendAudit, type Actor } from "./audit.js";
import type { Db } from "./client.js";
import { getDb } from "./client.js";
import { consumeLimit } from "./limits.js";
import { sessions, subscriptions, users } from "./schema.js";
import {
  createSession,
  forgetSessions,
  isSessionRecord,
  markMfaVerified,
  publishRevoked,
  readSession,
  revokeAllSessions,
  type RevokeReason,
  type SessionRecord,
} from "./sessions.js";

export type LoginFailure = { ok: false; status: number; code: string; message: string };
export type LoginSuccess = {
  ok: true;
  token: string;
  userId: string;
  mustChangePassword: boolean;
  enrollRequired: boolean;
};

function roleFor(app: "admin" | "portal"): "admin" | "user" {
  return app === "admin" ? "admin" : "user";
}

function account(
  user: { id: string; role: "admin" | "user" } | null,
): { userId: string; role: "admin" | "user" } | null {
  if (user === null) return null;
  return { userId: user.id, role: user.role };
}

function actorFor(
  user: { userId: string; role: "admin" | "user" } | null,
  ip: string | null,
  requestId: string,
): Actor {
  if (user === null) return { userId: null, role: null, kind: "system", ip, requestId };
  return { userId: user.userId, role: user.role, kind: user.role, ip, requestId };
}

function invalid(): LoginFailure {
  return {
    ok: false,
    status: 401,
    code: "invalid_credentials",
    message: SAFE_TEXT.invalid_credentials,
  };
}

function blocked(code: PortalBlock): LoginFailure {
  const message =
    code === "user_disabled"
      ? SAFE_TEXT.user_disabled
      : code === "no_sim"
        ? SAFE_TEXT.no_sim
        : code === "subscription_inactive"
          ? SAFE_TEXT.subscription_inactive
          : SAFE_TEXT.ip_not_allowed;
  return { ok: false, status: 403, code, message };
}

async function openSubscription(db: Db, userId: string) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const rank = { active: 0, scheduled: 1, paused: 2, expired: 3, disabled: 4 };
  rows.sort((left, right) => rank[left.status] - rank[right.status]);
  return rows[0] ?? null;
}

export async function login(input: {
  app: "admin" | "portal";
  username: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
  requestId?: string;
}): Promise<LoginSuccess | LoginFailure> {
  const requestId = input.requestId ?? randomUUID();
  const requestedApp: "admin" | "portal" = input.app;
  if (input.ip !== null) await consumeLimit("loginIp", input.ip);
  const db = getDb();
  const now = new Date();
  const found = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username.toLowerCase()))
    .limit(1);
  const user = found[0] ?? null;
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(await dummyPasswordHash(), input.password);
  if (user === null || !passwordOk || user.role !== roleFor(requestedApp)) {
    const locked = user !== null && user.lockedUntil !== null && user.lockedUntil > now;
    await db.transaction(async (tx) => {
      if (user !== null && user.role === roleFor(requestedApp) && !passwordOk && !locked) {
        const failures = user.failedLoginCount + 1;
        await tx
          .update(users)
          .set({
            failedLoginCount: failures >= 5 ? 0 : failures,
            lockedUntil:
              failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : user.lockedUntil,
          })
          .where(eq(users.id, user.id));
      }
      await appendAudit(
        tx,
        actorFor(account(user), input.ip, requestId),
        locked ? "auth.login_locked" : "auth.login_failed",
        { type: "user", id: user?.id ?? null },
        null,
        { username: input.username.toLowerCase(), app: requestedApp },
      );
    });
    if (locked) return { ok: false, status: 401, code: "locked", message: SAFE_TEXT.locked };
    return invalid();
  }
  if (user.status !== "active" || user.deletedAt !== null) {
    await db.transaction(async (tx) => {
      await appendAudit(
        tx,
        actorFor(account(user), input.ip, requestId),
        "auth.login_failed",
        { type: "user", id: user.id },
        null,
        {
          reason: "user_disabled",
        },
      );
    });
    return blocked("user_disabled");
  }
  if (user.lockedUntil !== null && user.lockedUntil > now) {
    await db.transaction(async (tx) => {
      await appendAudit(
        tx,
        actorFor(account(user), input.ip, requestId),
        "auth.login_locked",
        { type: "user", id: user.id },
        null,
        null,
      );
    });
    return { ok: false, status: 401, code: "locked", message: SAFE_TEXT.locked };
  }
  if (requestedApp === "portal") {
    const subscription = await openSubscription(db, user.id);
    const access = portalAccess({
      status: user.status,
      deletedAt: user.deletedAt,
      simId: user.simId,
      ipAllowed: ipAllowedByUser(input.ip, user.ipAllowlist),
      subscription:
        subscription === null
          ? null
          : { status: subscription.status, expiryBehavior: subscription.expiryBehavior },
    });
    if (!access.ok) {
      await db.transaction(async (tx) => {
        await appendAudit(
          tx,
          actorFor(account(user), input.ip, requestId),
          "auth.login_failed",
          { type: "user", id: user.id },
          null,
          {
            reason: access.error,
          },
        );
      });
      return blocked(access.error);
    }
  }
  const token = await db.transaction(async (tx) => {
    if (needsRehash(user.passwordHash)) {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(input.password) })
        .where(eq(users.id, user.id));
    }
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.id, user.id));
    const created = await createSession(tx, {
      userId: user.id,
      app: requestedApp,
      mfaVerified: requestedApp === "portal",
      ip: input.ip,
      userAgent: input.userAgent,
      now,
    });
    await appendAudit(
      tx,
      actorFor(account(user), input.ip, requestId),
      "auth.login_succeeded",
      { type: "user", id: user.id },
      null,
      {
        app: requestedApp,
      },
    );
    return created;
  });
  return {
    ok: true,
    token,
    userId: user.id,
    mustChangePassword: user.mustChangePassword,
    enrollRequired: requestedApp === "admin" && !user.totpEnabled,
  };
}

export async function logout(
  token: string | undefined,
  ip: string | null,
  requestId: string = randomUUID(),
): Promise<void> {
  const session = await readSession(token);
  if (!isSessionRecord(session)) return;
  const now = new Date();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: "logout" })
      .where(eq(sessions.id, session.sessionId));
    await appendAudit(
      tx,
      actorFor(session, ip, requestId),
      "auth.logout",
      { type: "session", id: session.sessionId },
      null,
      null,
    );
  });
  await forgetSessions([session.sessionId]);
}

export async function changePassword(input: {
  token: string | undefined;
  currentPassword: string;
  newPassword: string;
  ip: string | null;
  requestId?: string;
}): Promise<void> {
  const requestId = input.requestId ?? randomUUID();
  const session = await requireRecord(input.token);
  if (session.app === "admin" && !session.mfaVerified) {
    throw new AppError(401, "mfa_required", SAFE_TEXT.mfa_required);
  }
  if (session.app === "portal" && !session.allowSelfPasswordChange) {
    throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  }
  const rejection = passwordRejection(input.newPassword, session.username);
  if (rejection !== null) throw new AppError(400, "invalid_body", rejection);
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = rows[0];
  if (user === undefined || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError(401, "invalid_credentials", SAFE_TEXT.invalid_credentials);
  }
  const now = new Date();
  const revoked = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: now,
        mustChangePassword: false,
      })
      .where(eq(users.id, user.id));
    await tx.update(sessions).set({ createdAt: now }).where(eq(sessions.id, session.sessionId));
    const ids = await revokeAllSessions(tx, {
      userId: user.id,
      reason: "password_change",
      exceptSessionId: session.sessionId,
      now,
    });
    await appendAudit(
      tx,
      actorFor(session, input.ip, requestId),
      "auth.password_changed",
      { type: "user", id: user.id },
      null,
      null,
    );
    return ids;
  });
  await forgetSessions([session.sessionId, ...revoked]);
  if (revoked.length > 0) await publishRevoked(user.id, "password_change");
}

export async function acceptAup(
  token: string | undefined,
  ip: string | null,
  requestId: string = randomUUID(),
): Promise<void> {
  const session = await requireRecord(token);
  if (session.app !== "portal") throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  if (accessStep(stepInput(session)) === "password") {
    throw new AppError(403, "forbidden", "Change the password before accepting the terms.");
  }
  const now = new Date();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ aupAcceptedAt: now }).where(eq(users.id, session.userId));
    await appendAudit(
      tx,
      actorFor(session, ip, requestId),
      "aup.accepted",
      { type: "user", id: session.userId },
      null,
      null,
    );
  });
  await forgetSessions([session.sessionId]);
}

export async function enrollTotp(
  token: string | undefined,
): Promise<{ otpauthUrl: string; qrSvg: string }> {
  const session = await requireRecord(token);
  if (session.app !== "admin") throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  if (session.totpEnabled)
    throw new AppError(409, "forbidden", "An authenticator is already enrolled.");
  const env = loadEnv();
  const key = env.FIELD_ENCRYPTION_KEYS[env.FIELD_ENCRYPTION_ACTIVE_KEY_ID];
  if (key === undefined) throw new AppError(500, "internal", "The request failed.");
  const secret = newTotpSecret();
  const text = totpSecretText(secret);
  const db = getDb();
  await db
    .update(users)
    .set({
      totpSecretEnc: encryptField(
        key,
        env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
        `users.totp_secret_enc.${session.userId}`,
        text,
      ),
      totpEnabled: false,
    })
    .where(eq(users.id, session.userId));
  const otpauthUrl = totpKeyUri(session.username, secret);
  return { otpauthUrl, qrSvg: await qrSvg(otpauthUrl) };
}

export async function verifyTotp(input: {
  token: string | undefined;
  code?: string;
  recoveryCode?: string;
  ip: string | null;
  requestId?: string;
}): Promise<{ recoveryCodes?: string[] }> {
  const requestId = input.requestId ?? randomUUID();
  const session = await requireRecord(input.token);
  if (session.app !== "admin") throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  const env = loadEnv();
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = rows[0];
  if (user === undefined || user.totpSecretEnc === null) {
    throw new AppError(400, "mfa_required", "Enroll an authenticator first.");
  }
  const activeKey = new Map(Object.entries(env.FIELD_ENCRYPTION_KEYS)).get(
    env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
  );
  if (activeKey === undefined) throw new AppError(500, "internal", "The request failed.");
  const secret = totpSecretBytes(
    decryptField(env.FIELD_ENCRYPTION_KEYS, `users.totp_secret_enc.${user.id}`, user.totpSecretEnc),
  );
  let recoveryCodes: string[] | undefined;
  if (input.recoveryCode !== undefined) {
    if (!user.totpEnabled)
      throw new AppError(401, "invalid_credentials", SAFE_TEXT.invalid_credentials);
    const index = await matchRecoveryCode(input.recoveryCode, user.recoveryCodesHash ?? []);
    if (index === null)
      throw new AppError(401, "invalid_credentials", SAFE_TEXT.invalid_credentials);
    const next: string[] = [];
    let position = 0;
    for (const hash of user.recoveryCodesHash ?? []) {
      next.push(position === index ? "" : (hash ?? ""));
      position += 1;
    }
    await db.update(users).set({ recoveryCodesHash: next }).where(eq(users.id, user.id));
  } else if (input.code !== undefined) {
    const step = matchTotpStep(secret, input.code, user.totpLastUsedStep);
    if (step === null)
      throw new AppError(401, "invalid_credentials", SAFE_TEXT.invalid_credentials);
    const patch: { totpLastUsedStep: bigint; totpEnabled?: boolean; recoveryCodesHash?: string[] } =
      {
        totpLastUsedStep: step,
      };
    if (!user.totpEnabled) {
      recoveryCodes = newRecoveryCodes();
      patch.totpEnabled = true;
      patch.recoveryCodesHash = await hashRecoveryCodes(recoveryCodes);
    }
    await db.update(users).set(patch).where(eq(users.id, user.id));
  } else {
    throw new AppError(400, "invalid_body", SAFE_TEXT.invalid_body);
  }
  await markMfaVerified(db, session.sessionId);
  await db.transaction(async (tx) => {
    await appendAudit(
      tx,
      actorFor(session, input.ip, requestId),
      user.totpEnabled ? "auth.totp_verified" : "auth.totp_enrolled",
      {
        type: "user",
        id: user.id,
      },
      null,
      null,
    );
  });
  return recoveryCodes === undefined ? {} : { recoveryCodes };
}

export async function grantSudo(input: {
  token: string | undefined;
  password: string;
  code?: string;
  recoveryCode?: string;
}): Promise<Date> {
  const session = await requireRecord(input.token);
  if (accessStep(stepInput(session)) !== "ok")
    throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = rows[0];
  if (user === undefined || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(401, "invalid_credentials", SAFE_TEXT.invalid_credentials);
  }
  await verifyTotp({
    token: input.token,
    code: input.code,
    recoveryCode: input.recoveryCode,
    ip: null,
  });
  const until = new Date(Date.now() + 10 * 60 * 1000);
  const { getRedis } = await import("./redis.js");
  await getRedis().set(`sudo:${session.sessionId}`, until.toISOString(), "EX", 600);
  return until;
}

export async function assertSudo(sessionId: string): Promise<void> {
  const { getRedis } = await import("./redis.js");
  const value = await getRedis().get(`sudo:${sessionId}`);
  if (value === null) throw new AppError(403, "sudo_required", SAFE_TEXT.sudo_required);
}

export async function revokeUserSessions(input: {
  actorToken: string | undefined;
  userId: string;
  reason?: RevokeReason;
  ip: string | null;
  requestId?: string;
}): Promise<void> {
  const requestId = input.requestId ?? randomUUID();
  const actor = await requireReady(input.actorToken, "admin");
  const reason = input.reason ?? "admin_revoke";
  const db = getDb();
  const now = new Date();
  const ids = await db.transaction(async (tx) => {
    const revoked = await revokeAllSessions(tx, { userId: input.userId, reason, now });
    await appendAudit(
      tx,
      actorFor(actor, input.ip, requestId),
      "auth.sessions_revoked",
      { type: "user", id: input.userId },
      null,
      {
        reason,
      },
    );
    return revoked;
  });
  await forgetSessions(ids);
  await publishRevoked(input.userId, reason);
}

export async function requireRecord(token: string | undefined): Promise<SessionRecord> {
  const session = await readSession(token);
  if (isSessionRecord(session)) return session;
  const code =
    session === "revoked" || session === "password_changed"
      ? "session_revoked"
      : "invalid_credentials";
  const status = session === "user_disabled" ? 403 : 401;
  throw new AppError(
    status,
    code,
    session === "user_disabled" ? SAFE_TEXT.user_disabled : SAFE_TEXT.session_revoked,
  );
}

export async function requireReady(
  token: string | undefined,
  app: "admin" | "portal",
): Promise<SessionRecord> {
  const session = await requireRecord(token);
  if (session.app !== app)
    throw new AppError(401, "invalid_credentials", SAFE_TEXT.session_revoked);
  await consumeLimit(app === "admin" ? "adminApi" : "portalApi", session.userId);
  if (accessStep(stepInput(session)) !== "ok") {
    throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  }
  return session;
}

function stepInput(session: SessionRecord) {
  return {
    app: session.app,
    mfaVerified: session.mfaVerified,
    mustChangePassword: session.mustChangePassword,
    aupAcceptedAt: session.aupAcceptedAt === null ? null : new Date(session.aupAcceptedAt),
  };
}

export function sessionStep(session: SessionRecord) {
  return accessStep(stepInput(session));
}
