import { hashPassword, sessionIdFromToken } from "@gchopro/core";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { verifyAuditChain } from "./audit.js";
import { closeDb, getDb } from "./client.js";
import { login, revokeUserSessions } from "./login.js";
import { closeRedis } from "./redis.js";
import { sessions, users } from "./schema.js";
import { forgetSessions, isSessionRecord, readSession } from "./sessions.js";

const password = "integration-password-1";

describe("auth integration", () => {
  const username = `it${uuidv7().slice(0, 8)}`;
  let userId = "";
  let adminToken = "";

  afterAll(async () => {
    await closeDb();
    await closeRedis();
  });

  it("locks a portal user after five failures and writes a hash chain", async () => {
    const db = getDb();
    userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      role: "user",
      username,
      displayName: "Integration",
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await login({
        app: "portal",
        username,
        password: "wrong-password-value",
        ip: "127.0.0.1",
        userAgent: "vitest",
      });
      expect(result.ok).toBe(false);
    }
    const locked = await login({
      app: "portal",
      username,
      password,
      ip: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.code).toBe("locked");
    const chain = await verifyAuditChain(db);
    expect(chain.ok).toBe(true);
  });

  it("publishes session.revoked for an admin revoke", async () => {
    const adminName = `ia${uuidv7().slice(0, 8)}`;
    const db = getDb();
    await db.insert(users).values({
      id: uuidv7(),
      role: "admin",
      username: adminName,
      displayName: "Integration Admin",
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      totpEnabled: true,
      status: "active",
    });
    const signedIn = await login({
      app: "admin",
      username: adminName,
      password,
      ip: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) return;
    adminToken = signedIn.token;
    const sessionId = sessionIdFromToken(adminToken);
    await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
    await forgetSessions([sessionId]);
    const session = await readSession(adminToken);
    expect(isSessionRecord(session)).toBe(true);
    const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: 2 });
    const heard = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("revocation was not published within 5s")),
        5000,
      );
      redis.on("message", (_channel, message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    await redis.subscribe(`user:${userId}`);
    await revokeUserSessions({
      actorToken: adminToken,
      userId,
      ip: "127.0.0.1",
    });
    const message = await heard;
    expect(message).toContain("admin_revoke");
    await redis.quit();
  });
});
