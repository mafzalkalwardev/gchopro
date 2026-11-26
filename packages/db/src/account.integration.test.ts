import { randomUUID } from "node:crypto";
import { hashPassword, sendingBlocked } from "@gchopro/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  assignUserSim,
  createUser,
  disableUser,
  disableUserSubscription,
  enableUserSubscription,
  listPortalNotices,
  pauseUserSubscription,
  recordPayment,
  resetUserPassword,
  resumeUserSubscription,
  tickSubscriptions,
  voidPayment,
} from "./account-service.js";
import { closeDb, getDb } from "./client.js";
import { authenticateDevice, createPairing, registerDevice, reportSims } from "./device-service.js";
import { acceptAup, changePassword, login, sessionStep } from "./login.js";
import { closeRedis } from "./redis.js";
import { auditLogs, sessions, subscriptions, users } from "./schema.js";
import { isSessionRecord, readSession } from "./sessions.js";

describe("users, sessions, and subscriptions", () => {
  afterAll(async () => {
    await closeDb();
    await closeRedis();
  });

  it("creates a user, revokes for each blocked reason, and reminds once", async () => {
    const db = getDb();
    const adminId = uuidv7();
    const adminName = `m3${adminId.split("-").join("").slice(0, 8)}`;
    await db.insert(users).values({
      id: adminId,
      role: "admin",
      username: adminName,
      displayName: "Account integration",
      passwordHash: await hashPassword("integration-password-1"),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      status: "active",
    });
    const actor = {
      userId: adminId,
      role: "admin",
      ip: "203.0.113.60",
      requestId: randomUUID(),
    };
    const pairing = await createPairing(actor, "Account rack");
    const registered = await registerDevice({
      code: pairing.code,
      name: "Account rack",
      protocolVersion: 2,
      appVersion: "2.0.0",
      model: "Infinix X6528",
      androidSdk: 34,
      ip: "203.0.113.61",
    });
    const auth = await authenticateDevice(registered.id, registered.token);
    const reported = await reportSims(auth.device, {
      reportedAt: new Date().toISOString(),
      slotsOnDevice: 1,
      sims: [
        {
          subscriptionId: 7,
          slotIndex: 0,
          isEmbedded: false,
          carrierName: "Jazz",
          displayName: "SIM 1",
          mcc: "410",
          mnc: "01",
          countryIso: "pk",
          number: "+923009991111",
          simState: "SIM_STATE_READY",
          serviceState: "STATE_IN_SERVICE",
          signalLevel: 3,
        },
      ],
    });
    const lineId = reported.sims[0]?.simId;
    if (lineId === undefined) throw new Error("sim missing");

    const created = await createUser(actor, {
      username: `desk${adminId.split("-").join("").slice(0, 8)}`,
      displayName: "Desk user",
      simId: lineId,
      userLanguage: "en",
      recipientLanguage: "en",
      translationEnabled: false,
      timezone: "Asia/Karachi",
      allowExport: true,
      allowSelfPasswordChange: true,
      subscription: { planUnit: "month", planQuantity: 1, expiryBehavior: "block" },
    });
    expect(created.initialPassword).toHaveLength(16);
    const password = created.initialPassword ?? "";
    const subscriptionId = created.user.subscription?.id;
    if (subscriptionId === undefined) throw new Error("subscription missing");

    const signedIn = await login({
      app: "portal",
      username: created.user.username,
      password,
      ip: "203.0.113.62",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    expect(signedIn.ok && signedIn.mustChangePassword).toBe(true);
    if (!signedIn.ok) return;
    const open = await readSession(signedIn.token);
    expect(isSessionRecord(open) && sessionStep(open)).toBe("password");
    await changePassword({
      token: signedIn.token,
      currentPassword: password,
      newPassword: "integration-password-2",
      ip: "203.0.113.62",
      requestId: randomUUID(),
    });
    const changed = await readSession(signedIn.token);
    expect(isSessionRecord(changed) && sessionStep(changed)).toBe("aup");
    await acceptAup(signedIn.token, "203.0.113.62", randomUUID());
    const accepted = await readSession(signedIn.token);
    expect(isSessionRecord(accepted) && sessionStep(accepted)).toBe("ok");

    const reset = await resetUserPassword(actor, created.user.id);
    expect(reset.initialPassword).toHaveLength(16);
    const revoked = await db.select().from(sessions).where(eq(sessions.userId, created.user.id));
    expect(revoked.some((row) => row.revokeReason === "password_reset")).toBe(true);
    const stale = await readSession(signedIn.token);
    expect(isSessionRecord(stale)).toBe(false);
    const oldPassword = await login({
      app: "portal",
      username: created.user.username,
      password: "integration-password-2",
      ip: "203.0.113.63",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    expect(oldPassword.ok).toBe(false);

    const paused = await pauseUserSubscription(actor, subscriptionId);
    expect(paused.status).toBe("paused");
    expect(paused.pausedRemainingSeconds).toBeGreaterThan(60);
    const resumed = await resumeUserSubscription(actor, subscriptionId);
    expect(resumed.status).toBe("active");
    const drift = Math.abs(
      new Date(resumed.endsAt).getTime() - Date.now() - (paused.pausedRemainingSeconds ?? 0) * 1000,
    );
    expect(drift).toBeLessThan(5_000);

    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await db
      .update(subscriptions)
      .set({ endsAt: soon, reminderSentAt: null, status: "active" })
      .where(eq(subscriptions.id, subscriptionId));
    await tickSubscriptions(new Date());
    await tickSubscriptions(new Date());
    const notices = (await listPortalNotices(created.user.id)).filter(
      (notice) => notice.title === "Subscription ending",
    );
    expect(notices).toHaveLength(1);

    const payment = await recordPayment(actor, {
      userId: created.user.id,
      subscriptionId,
      amountMinor: 150000,
      currency: "pkr",
      method: "cash",
      paidAt: new Date().toISOString(),
      notes: "desk",
    });
    await voidPayment(actor, payment.id, "duplicate");
    const actions = await db.select({ action: auditLogs.action }).from(auditLogs);
    const names = actions.map((row) => row.action);
    expect(names).toContain("payment.recorded");
    expect(names).toContain("payment.voided");

    await disableUserSubscription(actor, subscriptionId, "closed");
    const disabledSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, created.user.id));
    expect(disabledSessions.some((row) => row.revokeReason === "subscription_inactive")).toBe(true);
    await enableUserSubscription(actor, subscriptionId);

    await db
      .update(subscriptions)
      .set({
        status: "expired",
        expiryBehavior: "read_only",
        endsAt: new Date(Date.now() - 60_000),
      })
      .where(eq(subscriptions.id, subscriptionId));
    const readonlyLogin = await login({
      app: "portal",
      username: created.user.username,
      password: reset.initialPassword ?? "",
      ip: "203.0.113.64",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    expect(readonlyLogin.ok).toBe(true);
    if (!readonlyLogin.ok) return;
    const readonlySession = await readSession(readonlyLogin.token);
    expect(isSessionRecord(readonlySession) && readonlySession.readOnly).toBe(true);
    expect(
      sendingBlocked({
        blocked: false,
        readOnly: true,
        scheduled: false,
      }),
    ).toBe(true);

    await assignUserSim(actor, created.user.id, null);
    const unassigned = await db.select().from(sessions).where(eq(sessions.userId, created.user.id));
    expect(unassigned.some((row) => row.revokeReason === "sim_unassigned")).toBe(true);
    await assignUserSim(actor, created.user.id, lineId);
    const restored = await login({
      app: "portal",
      username: created.user.username,
      password: reset.initialPassword ?? "",
      ip: "203.0.113.65",
      userAgent: "vitest",
      requestId: randomUUID(),
    });
    expect(restored.ok).toBe(true);
    await disableUser(actor, created.user.id, "left");
    const disabled = await db.select().from(sessions).where(eq(sessions.userId, created.user.id));
    expect(disabled.some((row) => row.revokeReason === "user_disabled")).toBe(true);
  }, 60_000);
});
