import { randomUUID } from "node:crypto";
import {
  AppError,
  SAFE_TEXT,
  addPlan,
  csvLine,
  digestDay,
  enableStatus,
  extendSubscription,
  generatePassword,
  hashPassword,
  passwordRejection,
  pauseSubscription,
  periodsOverlap,
  reminderDue,
  resumeEndsAt,
  settingSchemas,
  statusAtCreate,
  tickTransition,
  type ExtendSubscriptionBody,
  type NoticeCreate,
  type PaymentCreate,
  type SubscriptionInput,
  type UserCreate,
  type UserPatch,
} from "@gchopro/core";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { appendAudit, type Actor } from "./audit.js";
import { getDb, type Db } from "./client.js";
import { openSeal, type AdminActor } from "./device-shared.js";
import {
  forgetSessions,
  publishRevoked,
  revokeAllSessions,
  type RevokeReason,
} from "./sessions.js";
import {
  alerts,
  auditLogs,
  messages,
  noticeReads,
  notices,
  paymentsLog,
  rateLimitPolicies,
  sessions,
  settings,
  sims,
  subscriptions,
  users,
} from "./schema.js";

type Query = Pick<Db, "insert" | "update" | "select" | "execute">;
type SubStatus = "scheduled" | "active" | "paused" | "expired" | "disabled";

export type SubscriptionDTO = {
  id: string;
  userId: string;
  planUnit: "day" | "week" | "month" | "year";
  planQuantity: number;
  startsAt: string;
  endsAt: string;
  status: SubStatus;
  pausedAt: string | null;
  pausedRemainingSeconds: number | null;
  expiryBehavior: "block" | "read_only";
  reminderSentAt: string | null;
  notes: string | null;
};

export type UserDTO = {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "disabled";
  sim: {
    id: string;
    carrierName: string | null;
    phoneNumber: string | null;
    health: string;
  } | null;
  subscription: SubscriptionDTO | null;
  policyId: string | null;
  userLanguage: "zh" | "en";
  recipientLanguage: "zh" | "en";
  translationEnabled: boolean;
  timezone: string;
  allowExport: boolean;
  allowSelfPasswordChange: boolean;
  ipAllowlist: string[] | null;
  lastLoginAt: string | null;
  activeSessions: number;
};

const OPEN: SubStatus[] = ["scheduled", "active", "paused"];

function actorOf(actor: AdminActor): Actor {
  return {
    userId: actor.userId,
    role: actor.role,
    kind: "admin",
    ip: actor.ip,
    requestId: actor.requestId,
  };
}

function conflict(): AppError {
  return new AppError(409, "conflict", SAFE_TEXT.conflict);
}

function missing(): AppError {
  return new AppError(404, "not_found", SAFE_TEXT.not_found);
}

function invalid(message: string = SAFE_TEXT.invalid_body): AppError {
  return new AppError(400, "invalid_body", message);
}

function isUnique(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error ? isUnique(error.cause) : false;
}

function accessRank(status: SubStatus): number {
  if (status === "active") return 0;
  if (status === "scheduled") return 1;
  if (status === "paused") return 2;
  if (status === "expired") return 3;
  return 4;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

async function readTimezone(db: Query): Promise<string> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "default_timezone"))
    .limit(1);
  const parsed = settingSchemas.default_timezone.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : "Asia/Karachi";
}

async function readExpiry(db: Query): Promise<"block" | "read_only"> {
  const rows = await db.select().from(settings).where(eq(settings.key, "portal")).limit(1);
  const parsed = settingSchemas.portal.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data.expiry_behavior_default : "block";
}

async function release(revoked: { userId: string; reason: RevokeReason; ids: string[] }[]) {
  for (const item of revoked) {
    await forgetSessions(item.ids);
    await publishRevoked(item.userId, item.reason);
  }
}

async function blockMessages(
  db: Query,
  userId: string,
  reason: "subscription_inactive" | "user_disabled",
): Promise<void> {
  await db
    .update(messages)
    .set({ status: "blocked", blockReason: reason })
    .where(and(eq(messages.userId, userId), inArray(messages.status, ["queued", "held"])));
}

async function cancelSimMessages(db: Query, userId: string, simId: string): Promise<void> {
  await db
    .update(messages)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.simId, simId),
        inArray(messages.status, ["queued", "scheduled", "held"]),
      ),
    );
}

type SubRow = typeof subscriptions.$inferSelect;

function subscriptionDto(row: SubRow): SubscriptionDTO {
  return {
    id: row.id,
    userId: row.userId,
    planUnit: row.planUnit,
    planQuantity: row.planQuantity,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    pausedAt: iso(row.pausedAt),
    pausedRemainingSeconds:
      row.pausedRemainingSeconds === null ? null : Number(row.pausedRemainingSeconds),
    expiryBehavior: row.expiryBehavior,
    reminderSentAt: iso(row.reminderSentAt),
    notes: row.notes,
  };
}

async function userDto(db: Query, userId: string): Promise<UserDTO> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (user === undefined || user.role !== "user" || user.deletedAt !== null) throw missing();
  const simRows =
    user.simId === null ? [] : await db.select().from(sims).where(eq(sims.id, user.simId)).limit(1);
  const sim = simRows[0] ?? null;
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const current = [...subRows].sort(
    (left, right) => accessRank(left.status) - accessRank(right.status),
  )[0];
  const now = new Date();
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
  const activeSessions = sessionRows.filter(
    (row) => row.expiresAt > now && row.absoluteExpiresAt > now,
  ).length;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    sim:
      sim === null
        ? null
        : {
            id: sim.id,
            carrierName: sim.carrierName,
            phoneNumber: openSeal(`sims.phone_number_enc.${sim.id}`, sim.phoneNumberEnc),
            health: sim.health,
          },
    subscription: current === undefined ? null : subscriptionDto(current),
    policyId: user.rateLimitPolicyId,
    userLanguage: user.userLanguage,
    recipientLanguage: user.recipientLanguage,
    translationEnabled: user.translationEnabled,
    timezone: user.timezone,
    allowExport: user.allowExport,
    allowSelfPasswordChange: user.allowSelfPasswordChange,
    ipAllowlist: user.ipAllowlist,
    lastLoginAt: iso(user.lastLoginAt),
    activeSessions,
  };
}

async function requirePortalUser(db: Query, userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (user === undefined || user.role !== "user" || user.deletedAt !== null) throw missing();
  return user;
}

async function requireSim(db: Query, simId: string) {
  const rows = await db.select().from(sims).where(eq(sims.id, simId)).limit(1);
  const sim = rows[0];
  if (sim === undefined || sim.retiredAt !== null) throw conflict();
  const owners = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.simId, simId))
    .limit(1);
  return { sim, ownerId: owners[0]?.id ?? null };
}

async function assertPolicy(db: Query, policyId: string | null | undefined): Promise<void> {
  if (policyId === undefined || policyId === null) return;
  const rows = await db
    .select({ id: rateLimitPolicies.id })
    .from(rateLimitPolicies)
    .where(eq(rateLimitPolicies.id, policyId))
    .limit(1);
  if (rows[0] === undefined) throw invalid();
}

async function assertOpenPeriod(
  db: Query,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId?: string,
): Promise<void> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  for (const row of rows) {
    if (row.id === exceptId) continue;
    if (!OPEN.includes(row.status)) continue;
    if (periodsOverlap(startsAt, endsAt, row.startsAt, row.endsAt)) throw conflict();
  }
}

async function insertSubscription(
  db: Query,
  actor: AdminActor,
  user: { id: string; timezone: string },
  input: SubscriptionInput,
  now: Date,
): Promise<SubscriptionDTO> {
  const startsAt = input.startsAt === undefined ? now : new Date(input.startsAt);
  const endsAt = addPlan(startsAt, input.planUnit, input.planQuantity, user.timezone);
  if (endsAt <= startsAt) throw invalid();
  await assertOpenPeriod(db, user.id, startsAt, endsAt);
  const status = statusAtCreate(startsAt, now);
  const id = uuidv7();
  const expiryBehavior = input.expiryBehavior ?? (await readExpiry(db));
  await db.insert(subscriptions).values({
    id,
    userId: user.id,
    planUnit: input.planUnit,
    planQuantity: input.planQuantity,
    startsAt,
    endsAt,
    status,
    expiryBehavior,
    createdBy: actor.userId,
  });
  await appendAudit(
    db,
    actorOf(actor),
    "subscription.created",
    { type: "subscription", id },
    null,
    {
      userId: user.id,
      status,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  );
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw missing();
  return subscriptionDto(row);
}

export async function listUsers(filter: {
  q?: string;
  status?: string;
  subscription?: string;
  cursor?: string;
}): Promise<UserDTO[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "user"), isNull(users.deletedAt)))
    .orderBy(desc(users.createdAt));
  const needle = (filter.q ?? "").trim().toLowerCase().split("%").join("").split("_").join("");
  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const matched: string[] = [];
  for (const user of rows) {
    if (needle.length > 0) {
      const haystack = `${user.username} ${user.displayName}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    if (filter.status === "active" || filter.status === "disabled") {
      if (user.status !== filter.status) continue;
    }
    matched.push(user.id);
  }
  const start = filter.cursor === undefined ? 0 : matched.indexOf(filter.cursor) + 1;
  const page = matched.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + 50);
  const result: UserDTO[] = [];
  for (const id of page) {
    const dto = await userDto(db, id);
    const ends = dto.subscription === null ? null : new Date(dto.subscription.endsAt);
    if (filter.subscription === "active" && dto.subscription?.status !== "active") continue;
    if (filter.subscription === "expired" && dto.subscription?.status !== "expired") continue;
    if (filter.subscription === "expiring") {
      if (dto.subscription?.status !== "active" || ends === null || ends > horizon || ends <= now) {
        continue;
      }
    }
    result.push(dto);
  }
  return result;
}

export async function createUser(
  actor: AdminActor,
  input: UserCreate,
): Promise<{ user: UserDTO; initialPassword?: string }> {
  const db = getDb();
  await assertPolicy(db, input.policyId);
  if (input.simId) {
    const { ownerId } = await requireSim(db, input.simId);
    if (ownerId !== null) throw conflict();
  }
  const generated = input.password === undefined;
  const password = input.password ?? generatePassword(16);
  const rejection = passwordRejection(password, input.username);
  if (rejection !== null) throw invalid(rejection);
  const passwordHash = await hashPassword(password);
  const id = uuidv7();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        role: "user",
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: true,
        allowSelfPasswordChange: input.allowSelfPasswordChange,
        status: "active",
        simId: input.simId ?? null,
        rateLimitPolicyId: input.policyId ?? null,
        userLanguage: input.userLanguage,
        recipientLanguage: input.recipientLanguage,
        translationEnabled: input.translationEnabled,
        timezone: input.timezone,
        allowExport: input.allowExport,
        ipAllowlist: input.ipAllowlist && input.ipAllowlist.length > 0 ? input.ipAllowlist : null,
        createdBy: actor.userId,
      });
      await appendAudit(tx, actorOf(actor), "user.created", { type: "user", id }, null, {
        username: input.username,
        simId: input.simId ?? null,
      });
      if (input.subscription) {
        await insertSubscription(
          tx,
          actor,
          { id, timezone: input.timezone },
          input.subscription,
          now,
        );
      }
    });
  } catch (error) {
    if (isUnique(error)) throw conflict();
    throw error;
  }
  const user = await userDto(db, id);
  return generated ? { user, initialPassword: password } : { user };
}

export async function getUser(userId: string): Promise<
  UserDTO & {
    sessions: {
      id: string;
      app: string;
      ip: string | null;
      userAgent: string | null;
      createdAt: string;
      lastSeenAt: string;
      expiresAt: string;
    }[];
    usage: { minute: number; hour: number; day: number; segmentsDay: number };
    subscriptions: SubscriptionDTO[];
    payments: PaymentDTO[];
  }
> {
  const db = getDb();
  const dto = await userDto(db, userId);
  const now = new Date();
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return {
    ...dto,
    sessions: sessionRows
      .filter((row) => row.expiresAt > now && row.absoluteExpiresAt > now)
      .map((row) => ({
        id: row.id,
        app: row.app,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    usage: { minute: 0, hour: 0, day: 0, segmentsDay: 0 },
    subscriptions: subRows.map(subscriptionDto),
    payments: await listPayments({ userId }),
  };
}

export async function patchUser(
  actor: AdminActor,
  userId: string,
  input: UserPatch,
): Promise<UserDTO> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  await assertPolicy(db, input.policyId);
  const patch: {
    username?: string;
    displayName?: string;
    rateLimitPolicyId?: string | null;
    userLanguage?: "zh" | "en";
    recipientLanguage?: "zh" | "en";
    translationEnabled?: boolean;
    timezone?: string;
    allowExport?: boolean;
    allowSelfPasswordChange?: boolean;
    ipAllowlist?: string[] | null;
  } = {};
  if (input.username !== undefined) patch.username = input.username;
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.policyId !== undefined) patch.rateLimitPolicyId = input.policyId;
  if (input.userLanguage !== undefined) patch.userLanguage = input.userLanguage;
  if (input.recipientLanguage !== undefined) patch.recipientLanguage = input.recipientLanguage;
  if (input.translationEnabled !== undefined) patch.translationEnabled = input.translationEnabled;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.allowExport !== undefined) patch.allowExport = input.allowExport;
  if (input.allowSelfPasswordChange !== undefined) {
    patch.allowSelfPasswordChange = input.allowSelfPasswordChange;
  }
  if (input.ipAllowlist !== undefined) {
    patch.ipAllowlist =
      input.ipAllowlist && input.ipAllowlist.length > 0 ? input.ipAllowlist : null;
  }
  if (Object.values(patch).length === 0) throw invalid();
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set(patch).where(eq(users.id, user.id));
      await appendAudit(
        tx,
        actorOf(actor),
        "user.updated",
        { type: "user", id: user.id },
        null,
        patch,
      );
    });
  } catch (error) {
    if (isUnique(error)) throw conflict();
    throw error;
  }
  return userDto(db, user.id);
}

export async function resetUserPassword(
  actor: AdminActor,
  userId: string,
  newPassword?: string,
): Promise<{ initialPassword?: string }> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  const generated = newPassword === undefined;
  const password = newPassword ?? generatePassword(16);
  const rejection = passwordRejection(password, user.username);
  if (rejection !== null) throw invalid(rejection);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const ids = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: now, mustChangePassword: true })
      .where(eq(users.id, user.id));
    const revoked = await revokeAllSessions(tx, { userId: user.id, reason: "password_reset", now });
    await appendAudit(
      tx,
      actorOf(actor),
      "user.password_reset",
      { type: "user", id: user.id },
      null,
      {
        generated,
      },
    );
    return revoked;
  });
  await release([{ userId: user.id, reason: "password_reset", ids }]);
  return generated ? { initialPassword: password } : {};
}

export async function disableUser(
  actor: AdminActor,
  userId: string,
  reason: string,
): Promise<UserDTO> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  if (user.status === "disabled") throw conflict();
  const now = new Date();
  const ids = await db.transaction(async (tx) => {
    await tx.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
    await blockMessages(tx, user.id, "user_disabled");
    const revoked = await revokeAllSessions(tx, { userId: user.id, reason: "user_disabled", now });
    await appendAudit(tx, actorOf(actor), "user.disabled", { type: "user", id: user.id }, null, {
      reason,
    });
    return revoked;
  });
  await release([{ userId: user.id, reason: "user_disabled", ids }]);
  return userDto(db, user.id);
}

export async function enableUser(actor: AdminActor, userId: string): Promise<UserDTO> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  if (user.status !== "disabled") throw conflict();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ status: "active" }).where(eq(users.id, user.id));
    await appendAudit(
      tx,
      actorOf(actor),
      "user.enabled",
      { type: "user", id: user.id },
      null,
      null,
    );
  });
  return userDto(db, user.id);
}

export async function assignUserSim(
  actor: AdminActor,
  userId: string,
  simId: string | null,
): Promise<UserDTO> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  if (user.simId === simId) return userDto(db, user.id);
  if (simId !== null) {
    const { ownerId } = await requireSim(db, simId);
    if (ownerId !== null && ownerId !== user.id) throw conflict();
  }
  const now = new Date();
  const previous = user.simId;
  const ids = await db.transaction(async (tx) => {
    await tx.update(users).set({ simId }).where(eq(users.id, user.id));
    let revoked: string[] = [];
    if (previous !== null) {
      await cancelSimMessages(tx, user.id, previous);
      revoked = await revokeAllSessions(tx, { userId: user.id, reason: "sim_unassigned", now });
    }
    await appendAudit(
      tx,
      actorOf(actor),
      "user.sim_assigned",
      { type: "user", id: user.id },
      null,
      {
        from: previous,
        to: simId,
      },
    );
    return revoked;
  });
  if (previous !== null) await release([{ userId: user.id, reason: "sim_unassigned", ids }]);
  return userDto(db, user.id);
}

export async function listSubscriptions(filter: {
  status?: string;
  expiringWithinDays?: number;
}): Promise<SubscriptionDTO[]> {
  const db = getDb();
  const rows = await db.select().from(subscriptions).orderBy(subscriptions.endsAt);
  const now = new Date();
  return rows
    .filter((row) => {
      if (filter.status !== undefined && row.status !== filter.status) return false;
      if (filter.expiringWithinDays !== undefined) {
        const horizon = new Date(now.getTime() + filter.expiringWithinDays * 24 * 60 * 60 * 1000);
        if (row.status !== "active" || row.endsAt > horizon || row.endsAt <= now) return false;
      }
      return true;
    })
    .map(subscriptionDto);
}

export async function createSubscription(
  actor: AdminActor,
  userId: string,
  input: SubscriptionInput,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const user = await requirePortalUser(db, userId);
  return db.transaction(async (tx) => insertSubscription(tx, actor, user, input, new Date()));
}

async function requireSubscription(db: Query, id: string) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw missing();
  const user = await requirePortalUser(db, row.userId);
  return { row, user };
}

export async function extendUserSubscription(
  actor: AdminActor,
  id: string,
  input: ExtendSubscriptionBody,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const { row, user } = await requireSubscription(db, id);
  const now = new Date();
  const endsAt =
    "endsAt" in input
      ? new Date(input.endsAt)
      : (() => {
          const extended = extendSubscription({
            status: row.status,
            endsAt: row.endsAt,
            now,
            unit: input.planUnit,
            quantity: input.planQuantity,
            timeZone: user.timezone,
          });
          if (!extended.ok) throw conflict();
          return extended.endsAt;
        })();
  if (Number.isNaN(endsAt.getTime()) || endsAt <= row.startsAt) throw invalid();
  const status = endsAt > now ? "active" : "expired";
  if (status === "active") await assertOpenPeriod(db, user.id, row.startsAt, endsAt, row.id);
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        endsAt,
        status,
        planUnit: "planUnit" in input ? input.planUnit : row.planUnit,
        planQuantity: "planQuantity" in input ? input.planQuantity : row.planQuantity,
        pausedAt: null,
        pausedRemainingSeconds: null,
      })
      .where(eq(subscriptions.id, row.id));
    await appendAudit(
      tx,
      actorOf(actor),
      "subscription.extended",
      { type: "subscription", id: row.id },
      { status: row.status, endsAt: row.endsAt.toISOString() },
      { status, endsAt: endsAt.toISOString() },
    );
  });
  const next = await requireSubscription(db, id);
  return subscriptionDto(next.row);
}

export async function pauseUserSubscription(
  actor: AdminActor,
  id: string,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const { row } = await requireSubscription(db, id);
  const now = new Date();
  const paused = pauseSubscription({ status: row.status, endsAt: row.endsAt, now });
  if (!paused.ok) throw conflict();
  const ids = await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        status: "paused",
        pausedAt: now,
        pausedRemainingSeconds: paused.remainingSeconds,
      })
      .where(eq(subscriptions.id, row.id));
    await blockMessages(tx, row.userId, "subscription_inactive");
    const revoked = await revokeAllSessions(tx, {
      userId: row.userId,
      reason: "subscription_inactive",
      now,
    });
    await appendAudit(
      tx,
      actorOf(actor),
      "subscription.paused",
      { type: "subscription", id: row.id },
      null,
      { remainingSeconds: Number(paused.remainingSeconds) },
    );
    return revoked;
  });
  await release([{ userId: row.userId, reason: "subscription_inactive", ids }]);
  return subscriptionDto((await requireSubscription(db, id)).row);
}

export async function resumeUserSubscription(
  actor: AdminActor,
  id: string,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const { row } = await requireSubscription(db, id);
  if (row.status !== "paused" || row.pausedRemainingSeconds === null) throw conflict();
  const now = new Date();
  const endsAt = resumeEndsAt(row.pausedRemainingSeconds, now);
  await assertOpenPeriod(db, row.userId, now, endsAt, row.id);
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ status: "active", endsAt, pausedAt: null, pausedRemainingSeconds: null })
      .where(eq(subscriptions.id, row.id));
    await appendAudit(
      tx,
      actorOf(actor),
      "subscription.resumed",
      { type: "subscription", id: row.id },
      null,
      { endsAt: endsAt.toISOString() },
    );
  });
  return subscriptionDto((await requireSubscription(db, id)).row);
}

export async function disableUserSubscription(
  actor: AdminActor,
  id: string,
  reason: string,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const { row } = await requireSubscription(db, id);
  if (row.status === "disabled") throw conflict();
  const now = new Date();
  const ids = await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ status: "disabled" }).where(eq(subscriptions.id, row.id));
    await blockMessages(tx, row.userId, "subscription_inactive");
    const revoked = await revokeAllSessions(tx, {
      userId: row.userId,
      reason: "subscription_inactive",
      now,
    });
    await appendAudit(
      tx,
      actorOf(actor),
      "subscription.disabled",
      { type: "subscription", id: row.id },
      null,
      { reason },
    );
    return revoked;
  });
  await release([{ userId: row.userId, reason: "subscription_inactive", ids }]);
  return subscriptionDto((await requireSubscription(db, id)).row);
}

export async function enableUserSubscription(
  actor: AdminActor,
  id: string,
): Promise<SubscriptionDTO> {
  const db = getDb();
  const { row } = await requireSubscription(db, id);
  if (row.status !== "disabled") throw conflict();
  const now = new Date();
  const status = enableStatus(row.endsAt, now);
  if (status === "active") await assertOpenPeriod(db, row.userId, row.startsAt, row.endsAt, row.id);
  const ids = await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ status }).where(eq(subscriptions.id, row.id));
    await appendAudit(
      tx,
      actorOf(actor),
      "subscription.enabled",
      { type: "subscription", id: row.id },
      null,
      { status },
    );
    if (status === "expired" && row.expiryBehavior === "block") {
      await blockMessages(tx, row.userId, "subscription_inactive");
      return revokeAllSessions(tx, { userId: row.userId, reason: "expired", now });
    }
    return [];
  });
  if (ids.length > 0) await release([{ userId: row.userId, reason: "expired", ids }]);
  return subscriptionDto((await requireSubscription(db, id)).row);
}

export type PaymentDTO = {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amountMinor: number;
  currency: string;
  method: string;
  reference: string | null;
  paidAt: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

function paymentDto(row: typeof paymentsLog.$inferSelect): PaymentDTO {
  return {
    id: row.id,
    userId: row.userId,
    subscriptionId: row.subscriptionId,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    paidAt: row.paidAt.toISOString(),
    notes: row.notes,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
  };
}

export async function listPayments(filter: { userId?: string }): Promise<PaymentDTO[]> {
  const db = getDb();
  const rows = await db.select().from(paymentsLog).orderBy(desc(paymentsLog.paidAt));
  return rows
    .filter((row) => filter.userId === undefined || row.userId === filter.userId)
    .map(paymentDto);
}

export async function paymentsCsv(filter: { userId?: string }): Promise<string> {
  const rows = await listPayments(filter);
  const lines = [
    csvLine([
      "id",
      "userId",
      "amountMinor",
      "currency",
      "method",
      "reference",
      "paidAt",
      "voidedAt",
    ]),
  ];
  for (const row of rows) {
    lines.push(
      csvLine([
        row.id,
        row.userId,
        row.amountMinor,
        row.currency,
        row.method,
        row.reference,
        row.paidAt,
        row.voidedAt,
      ]),
    );
  }
  return lines.join("\n");
}

export async function recordPayment(actor: AdminActor, input: PaymentCreate): Promise<PaymentDTO> {
  const db = getDb();
  await requirePortalUser(db, input.userId);
  if (input.subscriptionId) {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1);
    if (rows[0] === undefined || rows[0].userId !== input.userId) throw invalid();
  }
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(paymentsLog).values({
      id,
      userId: input.userId,
      subscriptionId: input.subscriptionId ?? null,
      amountMinor: BigInt(input.amountMinor),
      currency: input.currency.toUpperCase(),
      method: input.method,
      reference: input.reference ?? null,
      paidAt: new Date(input.paidAt),
      notes: input.notes ?? null,
      recordedBy: actor.userId,
    });
    await appendAudit(tx, actorOf(actor), "payment.recorded", { type: "payment", id }, null, {
      userId: input.userId,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
    });
  });
  const rows = await db.select().from(paymentsLog).where(eq(paymentsLog.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw missing();
  return paymentDto(row);
}

export async function voidPayment(
  actor: AdminActor,
  id: string,
  reason: string,
): Promise<PaymentDTO> {
  const db = getDb();
  const rows = await db.select().from(paymentsLog).where(eq(paymentsLog.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw missing();
  if (row.voidedAt !== null) throw conflict();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(paymentsLog)
      .set({ voidedAt: now, voidedBy: actor.userId, voidReason: reason })
      .where(eq(paymentsLog.id, id));
    await appendAudit(tx, actorOf(actor), "payment.voided", { type: "payment", id }, null, {
      reason,
    });
  });
  const next = await db.select().from(paymentsLog).where(eq(paymentsLog.id, id)).limit(1);
  const updated = next[0];
  if (updated === undefined) throw missing();
  return paymentDto(updated);
}

export type NoticeDTO = {
  id: string;
  title: string;
  body: string;
  audience: "all" | "selected";
  userIds: string[];
  startsAt: string;
  endsAt: string;
  createdAt: string;
  read?: boolean;
};

function noticeDto(row: typeof notices.$inferSelect, read?: boolean): NoticeDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    userIds: row.userIds,
    startsAt: row.startsAt?.toISOString() ?? "",
    endsAt: row.endsAt?.toISOString() ?? "",
    createdAt: row.createdAt.toISOString(),
    read,
  };
}

export async function listNotices(): Promise<NoticeDTO[]> {
  const rows = await getDb().select().from(notices).orderBy(desc(notices.createdAt));
  return rows.map((row) => noticeDto(row));
}

export async function createNotice(actor: AdminActor, input: NoticeCreate): Promise<NoticeDTO> {
  if (new Date(input.endsAt) <= new Date(input.startsAt)) throw invalid();
  if (
    input.audience === "selected" &&
    (input.userIds === undefined || input.userIds.length === 0)
  ) {
    throw invalid();
  }
  const db = getDb();
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(notices).values({
      id,
      title: input.title,
      body: input.body,
      audience: input.audience,
      userIds: input.audience === "selected" ? (input.userIds ?? []) : [],
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      createdBy: actor.userId,
    });
    await appendAudit(tx, actorOf(actor), "notice.created", { type: "notice", id }, null, {
      audience: input.audience,
      title: input.title,
    });
  });
  const rows = await db.select().from(notices).where(eq(notices.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw missing();
  return noticeDto(row);
}

export async function deleteNotice(actor: AdminActor, id: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(notices).where(eq(notices.id, id)).limit(1);
  if (rows[0] === undefined) throw missing();
  await db.transaction(async (tx) => {
    await tx.delete(noticeReads).where(eq(noticeReads.noticeId, id));
    await tx.delete(notices).where(eq(notices.id, id));
    await appendAudit(tx, actorOf(actor), "notice.deleted", { type: "notice", id }, null, null);
  });
}

function noticeVisible(row: typeof notices.$inferSelect, userId: string, now: Date): boolean {
  if (row.startsAt !== null && row.startsAt > now) return false;
  if (row.endsAt !== null && row.endsAt <= now) return false;
  if (row.audience === "all") return true;
  return row.userIds.includes(userId);
}

export async function listPortalNotices(userId: string): Promise<NoticeDTO[]> {
  const db = getDb();
  const now = new Date();
  const rows = await db.select().from(notices).orderBy(desc(notices.createdAt));
  const reads = await db.select().from(noticeReads).where(eq(noticeReads.userId, userId));
  const readIds = new Set(reads.map((row) => row.noticeId));
  return rows
    .filter((row) => noticeVisible(row, userId, now))
    .map((row) => noticeDto(row, readIds.has(row.id)));
}

export async function markNoticeRead(userId: string, noticeId: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
  const notice = rows[0];
  if (notice === undefined || !noticeVisible(notice, userId, new Date())) throw missing();
  await db
    .insert(noticeReads)
    .values({ noticeId, userId, readAt: new Date() })
    .onConflictDoNothing();
}

export async function freeSims(): Promise<
  { id: string; carrierName: string | null; phoneNumber: string | null; health: string }[]
> {
  const db = getDb();
  const simRows = await db.select().from(sims).where(isNull(sims.retiredAt));
  const owners = await db
    .select({ simId: users.simId })
    .from(users)
    .where(and(eq(users.role, "user"), isNull(users.deletedAt)));
  const taken = new Set(owners.map((row) => row.simId).filter((id) => id !== null));
  return simRows
    .filter((sim) => sim.health === "active" && sim.activeOnDevice && !taken.has(sim.id))
    .map((sim) => ({
      id: sim.id,
      carrierName: sim.carrierName,
      phoneNumber: openSeal(`sims.phone_number_enc.${sim.id}`, sim.phoneNumberEnc),
      health: sim.health,
    }));
}

export async function listPolicies(): Promise<{ id: string; name: string }[]> {
  const rows = await getDb().select().from(rateLimitPolicies).orderBy(rateLimitPolicies.name);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function tickSubscriptions(now = new Date()): Promise<{
  activated: number;
  expired: number;
  reminders: number;
}> {
  const db = getDb();
  const zone = await readTimezone(db);
  const rows = await db.select().from(subscriptions);
  const revoked: { userId: string; reason: RevokeReason; ids: string[] }[] = [];
  let activated = 0;
  let expired = 0;
  let reminders = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const change = tickTransition({
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        expiryBehavior: row.expiryBehavior,
        now,
      });
      let status = row.status;
      if (change?.kind === "activate") {
        status = "active";
        activated += 1;
        await tx
          .update(subscriptions)
          .set({ status: "active" })
          .where(eq(subscriptions.id, row.id));
        await appendAudit(
          tx,
          { userId: null, role: null, kind: "system", ip: null, requestId: randomUUID() },
          "subscription.activated",
          { type: "subscription", id: row.id },
          null,
          null,
        );
      }
      if (change?.kind === "expire") {
        status = "expired";
        expired += 1;
        await tx
          .update(subscriptions)
          .set({ status: "expired" })
          .where(eq(subscriptions.id, row.id));
        await blockMessages(tx, row.userId, "subscription_inactive");
        await appendAudit(
          tx,
          { userId: null, role: null, kind: "system", ip: null, requestId: randomUUID() },
          "subscription.expired",
          { type: "subscription", id: row.id },
          null,
          { revoke: change.revoke },
        );
        if (change.revoke) {
          const ids = await revokeAllSessions(tx, { userId: row.userId, reason: "expired", now });
          revoked.push({ userId: row.userId, reason: "expired", ids });
        }
      }
      if (
        reminderDue({
          status,
          endsAt: row.endsAt,
          reminderSentAt: row.reminderSentAt,
          now,
        })
      ) {
        reminders += 1;
        const noticeId = uuidv7();
        await tx.insert(notices).values({
          id: noticeId,
          title: "Subscription ending",
          body: `Your subscription ends on ${row.endsAt.toISOString()}. Contact your administrator to extend it.`,
          audience: "selected",
          userIds: [row.userId],
          startsAt: now,
          endsAt: row.endsAt,
          createdBy: row.createdBy,
        });
        await tx
          .update(subscriptions)
          .set({ reminderSentAt: now })
          .where(eq(subscriptions.id, row.id));
        await appendAudit(
          tx,
          { userId: null, role: null, kind: "system", ip: null, requestId: randomUUID() },
          "subscription.reminder",
          { type: "subscription", id: row.id },
          null,
          { noticeId },
        );
      }
    }
    const day = digestDay(now, zone);
    if (day !== null) {
      const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const expiring = rows.filter((row) => {
        const change = tickTransition({
          status: row.status,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          expiryBehavior: row.expiryBehavior,
          now,
        });
        const status =
          change?.kind === "activate"
            ? "active"
            : change?.kind === "expire"
              ? "expired"
              : row.status;
        return status === "active" && row.endsAt > now && row.endsAt <= horizon;
      });
      if (expiring.length > 0) {
        const key = `subscription_expiring:${day}`;
        const open = await tx
          .select({ id: alerts.id })
          .from(alerts)
          .where(and(eq(alerts.dedupeKey, key), isNull(alerts.resolvedAt)))
          .limit(1);
        if (open[0] === undefined) {
          await tx.insert(alerts).values({
            id: uuidv7(),
            type: "subscription_expiring",
            severity: "warning",
            title: "Subscriptions expiring soon",
            detail: { day, count: expiring.length },
            dedupeKey: key,
            notifiedChannels: [],
          });
        }
      }
    }
  });
  await release(revoked);
  return { activated, expired, reminders };
}

export async function auditActions(actions: string[]): Promise<string[]> {
  const rows = await getDb().select({ action: auditLogs.action }).from(auditLogs);
  return rows.map((row) => row.action).filter((action) => actions.includes(action));
}
