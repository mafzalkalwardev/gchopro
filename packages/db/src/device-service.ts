import { randomUUID } from "node:crypto";
import {
  AppError,
  HEARTBEAT_INTERVAL_MS,
  PAIRING_TTL_MS,
  POLL_INTERVAL_MS,
  PROTOCOL_VERSION,
  SAFE_TEXT,
  SIM_REPORT_STALE_MS,
  TOKEN_GRACE_MS,
  countSegments,
  evaluateHealth,
  newDeviceToken,
  newPairingCode,
  notReadySince,
  pairingCodeValid,
  pairingDecision,
  reconcileSims,
  serviceOutSince,
  settingSchemas,
  testNumberAllowed,
  tokenNeedsRotation,
  type ReportedSimInput,
  type SimHealth,
  type SimReportBody,
} from "@gchopro/core";
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { appendAudit } from "./audit.js";
import type { Db } from "./client.js";
import { getDb } from "./client.js";
import {
  blank,
  cryptoEnv,
  defaultPolicyId,
  indexPhone,
  isHealth,
  killSwitchOn,
  normalizePhone,
  openSeal,
  readHealth,
  readRegion,
  seal,
  tokenHash,
  type AdminActor,
  type HealthSettings,
} from "./device-shared.js";
import { consumeLimit } from "./limits.js";
import { syncDeviceAlert } from "./alerts-service.js";
import {
  alerts,
  conversations,
  devices,
  messages,
  settings,
  simEvents,
  sims,
  users,
} from "./schema.js";
import { forgetSessions, publishRevoked, revokeAllSessions } from "./sessions.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type SimRow = typeof sims.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;

function actor(admin: AdminActor) {
  return {
    userId: admin.userId,
    role: admin.role,
    kind: "admin" as const,
    ip: admin.ip,
    requestId: admin.requestId,
  };
}

function systemActor(requestId: string) {
  return { userId: null, role: null, kind: "system" as const, ip: null, requestId };
}

async function suspensionCount(tx: Tx, simId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.simId, simId),
        eq(messages.failureClass, "suspension_signal"),
        gte(messages.failedAt, since),
      ),
    );
  return rows.length;
}

function nextHealth(input: {
  device: DeviceRow;
  row: SimRow;
  activeOnDevice: boolean;
  simState: string | null;
  serviceState: string | null;
  signalLevel: number | null;
  consecutiveFailures: number;
  suspensionSignals24h: number;
  now: Date;
  settings: HealthSettings;
  clearSuspension: boolean;
}): SimHealth {
  const current = isHealth(input.row.health) ? input.row.health : "active";
  return evaluateHealth({
    deviceRetired: input.device.status === "retired",
    pausedByAdmin: input.row.pausedByAdmin,
    activeOnDevice: input.activeOnDevice,
    simState: input.simState,
    serviceState: input.serviceState,
    signalLevel: input.signalLevel,
    current,
    consecutiveFailures: input.consecutiveFailures,
    suspensionSignals24h: input.suspensionSignals24h,
    notReadySince: notReadySince(input.row.simState, input.simState, input.row.updatedAt),
    serviceOutSince: serviceOutSince(
      input.row.serviceState,
      input.serviceState,
      input.row.updatedAt,
    ),
    lastHeartbeatAt: input.device.lastHeartbeatAt,
    now: input.now,
    consecutiveFailureThreshold: input.settings.consecutive_failure_threshold,
    suspensionSignalThreshold: input.settings.suspension_signal_threshold,
    clearSuspension: input.clearSuspension,
  });
}

async function enterSuspension(tx: Tx, simId: string, deviceId: string, requestId: string) {
  await tx
    .update(messages)
    .set({ status: "held", holdReason: "sim_unhealthy" })
    .where(and(eq(messages.simId, simId), inArray(messages.status, ["queued", "scheduled"])));
  const simRows = await tx
    .select({ carrierName: sims.carrierName, lastFailureName: sims.lastFailureName })
    .from(sims)
    .where(eq(sims.id, simId))
    .limit(1);
  const owners = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.simId, simId))
    .limit(1);
  const dedupeKey = `sim_suspected_suspended:${simId}`;
  const open = await tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.resolvedAt)))
    .limit(1);
  if (open.length === 0) {
    await tx.insert(alerts).values({
      id: uuidv7(),
      type: "sim_suspected_suspended",
      severity: "critical",
      deviceId,
      simId,
      userId: owners[0]?.id,
      title: "SIM may be suspended",
      detail: {
        carrier: simRows[0]?.carrierName ?? null,
        lastFailureName: simRows[0]?.lastFailureName ?? null,
        userId: owners[0]?.id ?? null,
      },
      dedupeKey,
      notifiedChannels: [],
    });
  }
  await appendAudit(
    tx,
    systemActor(requestId),
    "sim.suspected_suspended",
    { type: "sim", id: simId },
    null,
    { health: "suspected_suspended" },
  );
}

async function saveHealth(
  tx: Tx,
  input: {
    device: DeviceRow;
    row: SimRow;
    activeOnDevice: boolean;
    simState: string | null;
    serviceState: string | null;
    signalLevel: number | null;
    consecutiveFailures: number;
    now: Date;
    settings: HealthSettings;
    clearSuspension: boolean;
    patch: Partial<typeof sims.$inferInsert>;
    requestId: string;
    inventory?: boolean;
  },
): Promise<SimHealth> {
  const signals = await suspensionCount(tx, input.row.id, input.now);
  const health = nextHealth({ ...input, suspensionSignals24h: signals });
  const changed = health !== input.row.health;
  await tx
    .update(sims)
    .set({
      ...input.patch,
      activeOnDevice: input.activeOnDevice,
      health,
      simState: input.simState,
      serviceState: input.serviceState,
      signalLevel: input.signalLevel,
      consecutiveFailures: input.consecutiveFailures,
      healthReason: health,
      healthChangedAt: changed ? input.now : input.row.healthChangedAt,
      retiredAt: health === "retired" ? input.now : input.patch.retiredAt,
    })
    .where(eq(sims.id, input.row.id));
  if (input.inventory !== false) {
    await tx.insert(simEvents).values({
      id: uuidv7(),
      simId: input.row.id,
      at: input.now,
      kind: "state_report",
      fromHealth: isHealth(input.row.health) ? input.row.health : null,
      toHealth: health,
      detail: { simState: input.simState, serviceState: input.serviceState },
    });
  }
  if (changed) {
    await tx.insert(simEvents).values({
      id: uuidv7(),
      simId: input.row.id,
      at: input.now,
      kind: "health_change",
      fromHealth: isHealth(input.row.health) ? input.row.health : null,
      toHealth: health,
      detail: { simState: input.simState, serviceState: input.serviceState },
    });
  }
  if (health === "suspected_suspended" && input.row.health !== "suspected_suspended") {
    await enterSuspension(tx, input.row.id, input.device.id, input.requestId);
  }
  if (input.clearSuspension && health === "active") {
    await tx
      .update(messages)
      .set({ status: "queued", holdReason: null, queuedAt: input.now })
      .where(
        and(
          eq(messages.simId, input.row.id),
          eq(messages.status, "held"),
          eq(messages.holdReason, "sim_unhealthy"),
        ),
      );
    await tx
      .update(alerts)
      .set({ resolvedAt: input.now })
      .where(
        and(
          eq(alerts.dedupeKey, `sim_suspected_suspended:${input.row.id}`),
          isNull(alerts.resolvedAt),
        ),
      );
  }
  const watched =
    health === "absent" || health === "locked" || health === "no_service" || health === "error";
  const stateKey = `sim_state_change:${input.row.id}`;
  if (changed && watched) {
    const openState = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.dedupeKey, stateKey), isNull(alerts.resolvedAt)))
      .limit(1);
    if (openState.length === 0) {
      await tx.insert(alerts).values({
        id: uuidv7(),
        type: "sim_state_change",
        severity: "warning",
        deviceId: input.device.id,
        simId: input.row.id,
        title: "SIM health changed",
        detail: { health },
        dedupeKey: stateKey,
        notifiedChannels: [],
      });
    }
  }
  if (changed && health === "active") {
    await tx
      .update(alerts)
      .set({ resolvedAt: input.now })
      .where(and(eq(alerts.dedupeKey, stateKey), isNull(alerts.resolvedAt)));
  }
  return health;
}

async function phoneFields(
  tx: Tx,
  simId: string,
  raw: string,
  region: string,
  source: "device" | "admin",
): Promise<{
  phoneNumberEnc: string | null;
  phoneNumberHash: string | null;
  numberSource: "device" | "admin" | null;
}> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { phoneNumberEnc: null, phoneNumberHash: null, numberSource: null };
  }
  const e164 = normalizePhone(trimmed, region);
  const hash = indexPhone(e164);
  const taken = await tx
    .select({ id: sims.id })
    .from(sims)
    .where(eq(sims.phoneNumberHash, hash))
    .limit(1);
  if (taken[0] !== undefined && taken[0].id !== simId) {
    return { phoneNumberEnc: null, phoneNumberHash: null, numberSource: null };
  }
  return {
    phoneNumberEnc: seal(`sims.phone_number_enc.${simId}`, e164),
    phoneNumberHash: hash,
    numberSource: source,
  };
}

async function reportedPhone(
  tx: Tx,
  simId: string,
  raw: string,
  region: string,
): Promise<{
  phoneNumberEnc: string | null;
  phoneNumberHash: string | null;
  numberSource: "device" | "admin" | null;
}> {
  try {
    return await phoneFields(tx, simId, raw, region, "device");
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      return { phoneNumberEnc: null, phoneNumberHash: null, numberSource: null };
    }
    throw error;
  }
}

export async function createPairing(admin: AdminActor, name?: string) {
  const code = newPairingCode();
  const now = new Date();
  const id = uuidv7();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(devices).values({
      id,
      name: name ?? "Handset",
      status: "pairing",
      pairingCodeHash: tokenHash(code),
      pairingExpiresAt: expiresAt,
      pairingAttempts: 0,
      protocolVersion: PROTOCOL_VERSION,
    });
    await appendAudit(tx, actor(admin), "device.pairing_created", { type: "device", id }, null, {
      name: name ?? "Handset",
      expiresAt: expiresAt.toISOString(),
    });
  });
  return {
    deviceId: id,
    code,
    expiresAt: expiresAt.toISOString(),
    gatewayUrl: cryptoEnv().gatewayUrl,
  };
}

export async function registerDevice(input: {
  code: string;
  name: string;
  protocolVersion: number;
  appVersion: string;
  model: string;
  androidSdk: number;
  ip: string;
}) {
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    throw new AppError(426, "upgrade_required", SAFE_TEXT.upgrade_required);
  }
  await consumeLimit("registerIp", input.ip);
  if (!pairingCodeValid(input.code)) {
    throw new AppError(400, "invalid_code_format", SAFE_TEXT.invalid_code_format);
  }
  const now = new Date();
  const db = getDb();
  const hash = tokenHash(input.code);
  const found = await db
    .select()
    .from(devices)
    .where(and(eq(devices.status, "pairing"), eq(devices.pairingCodeHash, hash)))
    .limit(1);
  const row = found[0];
  const decision = pairingDecision({
    found: row !== undefined,
    expiresAt: row?.pairingExpiresAt ?? null,
    attempts: row?.pairingAttempts ?? 0,
    now,
  });
  if (row === undefined || decision === "reject") {
    if (row === undefined) {
      const open = await db
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.status, "pairing"),
            gt(devices.pairingExpiresAt, now),
            sql`${devices.pairingAttempts} < 5`,
          ),
        );
      const only = open.length === 1 ? open[0] : undefined;
      if (only !== undefined) {
        await db
          .update(devices)
          .set({ pairingAttempts: sql`${devices.pairingAttempts} + 1` })
          .where(eq(devices.id, only.id));
      }
    }
    throw new AppError(404, "pairing_not_found", SAFE_TEXT.pairing_not_found);
  }
  const token = newDeviceToken();
  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({
        name: input.name,
        status: "active",
        pairingCodeHash: null,
        pairingExpiresAt: null,
        tokenHash: tokenHash(token),
        tokenRotatedAt: now,
        appVersion: input.appVersion,
        model: input.model,
        androidSdk: input.androidSdk,
        protocolVersion: PROTOCOL_VERSION,
      })
      .where(eq(devices.id, row.id));
    await appendAudit(
      tx,
      { userId: null, role: null, kind: "device", ip: input.ip, requestId: randomUUID() },
      "device.registered",
      { type: "device", id: row.id },
      null,
      { name: input.name },
    );
  });
  return {
    id: row.id,
    token,
    name: input.name,
    protocolVersion: PROTOCOL_VERSION,
    pollIntervalMs: POLL_INTERVAL_MS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  };
}

export async function authenticateDevice(deviceId: string, token: string, now = new Date()) {
  const hash = tokenHash(token);
  const rows = await getDb()
    .select()
    .from(devices)
    .where(
      or(
        eq(devices.tokenHash, hash),
        and(eq(devices.tokenPrevHash, hash), gt(devices.tokenPrevExpiresAt, now)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.status !== "active") {
    throw new AppError(401, "device_revoked", SAFE_TEXT.device_revoked);
  }
  if (row.id !== deviceId) throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  const rotate = tokenNeedsRotation({
    rotatedAt: row.tokenRotatedAt,
    now,
    maxAgeDays: cryptoEnv().maxTokenAgeDays,
    requested: row.rotateRequested,
    usingPrevious: row.tokenHash !== hash,
  });
  return { device: row, rotate };
}

export async function recordHeartbeat(
  device: DeviceRow,
  input: {
    battery: number;
    charging: boolean;
    network: "wifi" | "cellular" | "none" | "unknown";
    appVersion: string;
    androidSdk: number;
    activeModemCount: number;
  },
) {
  const now = new Date();
  const db = getDb();
  await db
    .update(devices)
    .set({
      lastHeartbeatAt: now,
      battery: input.battery,
      charging: input.charging,
      network: input.network,
      appVersion: input.appVersion,
      androidSdk: input.androidSdk,
      slotsOnDevice: input.activeModemCount,
    })
    .where(eq(devices.id, device.id));
  await syncDeviceAlert(device.id, now);
  const latest = await db
    .select({ at: simEvents.at })
    .from(simEvents)
    .innerJoin(sims, eq(sims.id, simEvents.simId))
    .where(and(eq(sims.deviceId, device.id), eq(simEvents.kind, "state_report")))
    .orderBy(desc(simEvents.at))
    .limit(1);
  const reportedAt = latest[0]?.at ?? null;
  const requestSimReport =
    reportedAt === null || now.getTime() - reportedAt.getTime() > SIM_REPORT_STALE_MS;
  return {
    serverTime: now.toISOString(),
    paused: device.paused,
    pollIntervalMs: POLL_INTERVAL_MS,
    requestSimReport,
  };
}

export async function reportSims(device: DeviceRow, body: SimReportBody) {
  const now = new Date();
  const requestId = randomUUID();
  const db = getDb();
  const settings = await readHealth(db);
  const region = await readRegion(db);
  const policyId = await defaultPolicyId(db);
  const existing = await db.select().from(sims).where(eq(sims.deviceId, device.id));
  const identities = [];
  for (const report of body.sims) {
    const number = blank(report.number);
    let hash: string | null = null;
    if (number !== null) {
      try {
        hash = indexPhone(normalizePhone(number, region));
      } catch {
        hash = null;
      }
    }
    identities.push({
      subscriptionId: report.subscriptionId,
      slotIndex: report.slotIndex,
      carrierName: blank(report.carrierName),
      phoneNumberHash: hash,
    });
  }
  const plan = reconcileSims(
    existing.map((row) => ({
      id: row.id,
      subscriptionId: row.subscriptionId,
      slotIndex: row.slotIndex,
      carrierName: row.carrierName,
      phoneNumberHash: row.phoneNumberHash,
      retired: row.retiredAt !== null,
    })),
    identities,
  );
  const byId = new Map(existing.map((row) => [row.id, row]));
  const reportsByIndex = new Map(body.sims.map((report, index) => [index, report]));
  const results: { subscriptionId: number; simId: string; health: SimHealth }[] = [];
  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ slotsOnDevice: body.slotsOnDevice })
      .where(eq(devices.id, device.id));
    const apply = async (row: SimRow, report: ReportedSimInput, activeOnDevice: boolean) => {
      const keepAdminNumber = row.numberSource === "admin" && blank(report.number) === null;
      const phone = keepAdminNumber
        ? {
            phoneNumberEnc: row.phoneNumberEnc,
            phoneNumberHash: row.phoneNumberHash,
            numberSource: row.numberSource,
          }
        : await reportedPhone(tx, row.id, report.number, region);
      const phonePatch = phone.phoneNumberHash === null && !keepAdminNumber ? {} : phone;
      const health = await saveHealth(tx, {
        device,
        row,
        activeOnDevice,
        simState: blank(report.simState),
        serviceState: blank(report.serviceState),
        signalLevel: report.signalLevel ?? null,
        consecutiveFailures: row.consecutiveFailures,
        now,
        settings,
        clearSuspension: false,
        requestId,
        patch: {
          slotIndex: report.slotIndex,
          subscriptionId: report.subscriptionId,
          isEmbedded: report.isEmbedded,
          carrierName: blank(report.carrierName),
          displayName: blank(report.displayName),
          mccMnc:
            blank(report.mcc) === null && blank(report.mnc) === null
              ? null
              : `${report.mcc ?? ""}${report.mnc ?? ""}`,
          countryIso: blank(report.countryIso),
          retiredAt: null,
          ...phonePatch,
        },
      });
      results.push({ subscriptionId: report.subscriptionId, simId: row.id, health });
    };
    for (const match of plan.matched) {
      const row = byId.get(match.id);
      const report = reportsByIndex.get(match.reportIndex);
      if (row === undefined || report === undefined) continue;
      await apply(row, report, true);
    }
    for (const match of plan.reactivated) {
      const row = byId.get(match.id);
      const report = reportsByIndex.get(match.reportIndex);
      if (row === undefined || report === undefined) continue;
      await apply({ ...row, retiredAt: null }, report, true);
    }
    for (const index of plan.created) {
      const report = reportsByIndex.get(index);
      if (report === undefined) continue;
      const id = uuidv7();
      const phone = await reportedPhone(tx, id, report.number, region);
      const draft: SimRow = {
        id,
        deviceId: device.id,
        slotIndex: report.slotIndex,
        subscriptionId: report.subscriptionId,
        isEmbedded: report.isEmbedded,
        carrierName: blank(report.carrierName),
        displayName: blank(report.displayName),
        mccMnc: null,
        countryIso: blank(report.countryIso),
        phoneNumberEnc: phone.phoneNumberEnc,
        phoneNumberHash: phone.phoneNumberHash,
        numberSource: phone.numberSource,
        activeOnDevice: true,
        health: "active",
        healthReason: null,
        healthChangedAt: now,
        simState: blank(report.simState),
        serviceState: blank(report.serviceState),
        signalLevel: report.signalLevel ?? null,
        consecutiveFailures: 0,
        lastSendOkAt: null,
        lastReceiveAt: null,
        lastFailureAt: null,
        lastFailureCode: null,
        lastFailureName: null,
        pausedByAdmin: false,
        pausedReason: null,
        inboundEnabled: true,
        nextSendAt: null,
        rateLimitPolicyId: policyId,
        createdAt: now,
        updatedAt: now,
        retiredAt: null,
      };
      await tx.insert(sims).values(draft);
      const health = await saveHealth(tx, {
        device,
        row: draft,
        activeOnDevice: true,
        simState: draft.simState,
        serviceState: draft.serviceState,
        signalLevel: draft.signalLevel,
        consecutiveFailures: 0,
        now,
        settings,
        clearSuspension: false,
        requestId,
        patch: {},
      });
      results.push({ subscriptionId: report.subscriptionId, simId: id, health });
    }
    for (const id of plan.missing) {
      const row = byId.get(id);
      if (row === undefined) continue;
      await saveHealth(tx, {
        device,
        row,
        activeOnDevice: false,
        simState: row.simState,
        serviceState: row.serviceState,
        signalLevel: row.signalLevel,
        consecutiveFailures: row.consecutiveFailures,
        now,
        settings,
        clearSuspension: false,
        requestId,
        patch: {},
      });
    }
  });
  return { sims: results };
}

export async function rotateDeviceToken(device: DeviceRow) {
  const token = newDeviceToken();
  const now = new Date();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({
        tokenPrevHash: device.tokenHash,
        tokenPrevExpiresAt: new Date(now.getTime() + TOKEN_GRACE_MS),
        tokenHash: tokenHash(token),
        tokenRotatedAt: now,
        rotateRequested: false,
      })
      .where(eq(devices.id, device.id));
    await appendAudit(
      tx,
      systemActor(randomUUID()),
      "device.token_rotated",
      { type: "device", id: device.id },
      null,
      { at: now.toISOString() },
    );
  });
  return { token };
}

export async function requestRotation(admin: AdminActor, deviceId: string) {
  const db = getDb();
  const rows = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  const row = rows[0];
  if (row === undefined || row.status !== "active") {
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
  await db.transaction(async (tx) => {
    await tx.update(devices).set({ rotateRequested: true }).where(eq(devices.id, deviceId));
    await appendAudit(
      tx,
      actor(admin),
      "device.rotate_requested",
      { type: "device", id: deviceId },
      null,
      {
        rotateRequested: true,
      },
    );
  });
}

export async function retireDevice(admin: AdminActor, deviceId: string) {
  const db = getDb();
  const now = new Date();
  const rows = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  const device = rows[0];
  if (device === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  const simRows = await db.select().from(sims).where(eq(sims.deviceId, deviceId));
  const simIds = simRows.map((row) => row.id);
  const revokedSessionIds: string[] = [];
  const assigned =
    simIds.length === 0
      ? []
      : await db.select({ id: users.id }).from(users).where(inArray(users.simId, simIds));
  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({
        status: "retired",
        retiredAt: now,
        tokenHash: null,
        tokenPrevHash: null,
        tokenPrevExpiresAt: null,
        rotateRequested: false,
      })
      .where(eq(devices.id, deviceId));
    if (simIds.length > 0) {
      await tx
        .update(sims)
        .set({ health: "retired", activeOnDevice: false, retiredAt: now, pausedByAdmin: false })
        .where(inArray(sims.id, simIds));
      await tx.update(users).set({ simId: null }).where(inArray(users.simId, simIds));
      await tx
        .update(messages)
        .set({ status: "cancelled" })
        .where(and(inArray(messages.simId, simIds), eq(messages.status, "held")));
    }
    await appendAudit(tx, actor(admin), "device.retired", { type: "device", id: deviceId }, null, {
      sims: simIds,
    });
    for (const user of assigned) {
      const ids = await revokeAllSessions(tx, { userId: user.id, reason: "sim_unassigned", now });
      revokedSessionIds.push(...ids);
    }
  });
  await forgetSessions(revokedSessionIds);
  for (const user of assigned) {
    await publishRevoked(user.id, "sim_unassigned");
  }
  return deviceSnapshot(deviceId);
}

async function deviceSnapshot(deviceId: string) {
  const listed = await listDevices();
  const found = listed.find((item) => item.id === deviceId);
  if (found === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  return found;
}

export async function listDevices(status?: string) {
  const db = getDb();
  const now = new Date();
  const settings = await readHealth(db);
  const deviceQuery = db.select().from(devices).orderBy(desc(devices.createdAt));
  const deviceRows =
    status === "pairing" || status === "active" || status === "retired"
      ? await deviceQuery.where(eq(devices.status, status))
      : await deviceQuery;
  const simRows = deviceRows.length === 0 ? [] : await db.select().from(sims);
  const cutoff = now.getTime() - settings.offline_after_seconds * 1000;
  return deviceRows.map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    online: device.lastHeartbeatAt !== null && device.lastHeartbeatAt.getTime() >= cutoff,
    lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
    battery: device.battery,
    charging: device.charging,
    network: device.network,
    appVersion: device.appVersion,
    model: device.model,
    androidSdk: device.androidSdk,
    slotsOnDevice: device.slotsOnDevice,
    paused: device.paused,
    sims: simRows
      .filter((sim) => sim.deviceId === device.id && sim.retiredAt === null)
      .map((sim) => ({
        id: sim.id,
        slotIndex: sim.slotIndex,
        subscriptionId: sim.subscriptionId,
        carrierName: sim.carrierName,
        health: sim.health,
        phoneNumber: openSeal(`sims.phone_number_enc.${sim.id}`, sim.phoneNumberEnc),
      })),
  }));
}

export async function getDevice(deviceId: string) {
  const device = await deviceSnapshot(deviceId);
  const rows = await getDb()
    .select()
    .from(alerts)
    .where(eq(alerts.deviceId, deviceId))
    .orderBy(desc(alerts.createdAt))
    .limit(40);
  return {
    ...device,
    events: rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      at: row.createdAt.toISOString(),
      detail: row.detail,
    })),
  };
}

export async function patchDevice(
  admin: AdminActor,
  deviceId: string,
  patch: { name?: string; paused?: boolean; smsRateLimitNote?: string | null },
) {
  const db = getDb();
  const rows = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  if (rows[0] === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  await db.transaction(async (tx) => {
    await tx
      .update(devices)
      .set({
        name: patch.name,
        paused: patch.paused,
        smsRateLimitNote: patch.smsRateLimitNote,
      })
      .where(eq(devices.id, deviceId));
    await appendAudit(
      tx,
      actor(admin),
      "device.updated",
      { type: "device", id: deviceId },
      null,
      patch,
    );
  });
  return deviceSnapshot(deviceId);
}

function usageOf(rows: { simId: string; segments: number | null }[], simId: string) {
  const mine = rows.filter((row) => row.simId === simId);
  return {
    sent: mine.length,
    segments: mine.reduce((sum, row) => sum + (row.segments ?? 1), 0),
  };
}

export async function listSims(filter: { health?: string; deviceId?: string; assigned?: boolean }) {
  const db = getDb();
  const simRows = await db.select().from(sims).orderBy(sims.slotIndex);
  const deviceRows = await db.select().from(devices);
  const userRows = await db
    .select({ id: users.id, username: users.username, simId: users.simId })
    .from(users)
    .where(isNull(users.deletedAt));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const sent = await db
    .select({ simId: messages.simId, segments: messages.segments })
    .from(messages)
    .where(and(inArray(messages.status, ["sent", "delivered"]), gte(messages.sentAt, start)));
  const devicesById = new Map(deviceRows.map((row) => [row.id, row]));
  const usersBySim = new Map(
    userRows.filter((row) => row.simId !== null).map((row) => [row.simId, row]),
  );
  return simRows
    .filter((sim) => {
      if (filter.deviceId !== undefined && sim.deviceId !== filter.deviceId) return false;
      if (filter.health !== undefined && sim.health !== filter.health) return false;
      const assigned = usersBySim.has(sim.id);
      if (filter.assigned === true && !assigned) return false;
      if (filter.assigned === false && assigned) return false;
      return true;
    })
    .map((sim) => {
      const device = devicesById.get(sim.deviceId);
      const user = usersBySim.get(sim.id);
      return {
        id: sim.id,
        deviceId: sim.deviceId,
        deviceName: device?.name ?? "",
        slotIndex: sim.slotIndex,
        subscriptionId: sim.subscriptionId,
        carrierName: sim.carrierName,
        phoneNumber: openSeal(`sims.phone_number_enc.${sim.id}`, sim.phoneNumberEnc),
        numberSource: sim.numberSource,
        health: sim.health,
        healthReason: sim.healthReason,
        healthChangedAt: sim.healthChangedAt?.toISOString() ?? null,
        signalLevel: sim.signalLevel,
        serviceState: sim.serviceState,
        simState: sim.simState,
        consecutiveFailures: sim.consecutiveFailures,
        lastSendOkAt: sim.lastSendOkAt?.toISOString() ?? null,
        lastReceiveAt: sim.lastReceiveAt?.toISOString() ?? null,
        assignedUser: user ? { id: user.id, username: user.username } : null,
        usageToday: usageOf(sent, sim.id),
        policyId: sim.rateLimitPolicyId,
      };
    });
}

export async function getSim(simId: string) {
  const listed = await listSims({});
  const sim = listed.find((item) => item.id === simId);
  if (sim === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  const events = await getDb()
    .select()
    .from(simEvents)
    .where(eq(simEvents.simId, simId))
    .orderBy(desc(simEvents.at))
    .limit(40);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sent = await getDb()
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.simId, simId),
        inArray(messages.status, ["sent", "delivered"]),
        gte(messages.sentAt, since),
      ),
    );
  return {
    ...sim,
    events: events.map((event) => ({
      id: event.id,
      at: event.at.toISOString(),
      kind: event.kind,
      fromHealth: event.fromHealth,
      toHealth: event.toHealth,
      detail: event.detail,
    })),
    stats7d: { sent: sent.length },
  };
}

export async function patchSim(
  admin: AdminActor,
  simId: string,
  patch: { phoneNumber?: string; rateLimitPolicyId?: string | null },
) {
  const db = getDb();
  const rows = await db.select().from(sims).where(eq(sims.id, simId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  const region = await readRegion(db);
  await db.transaction(async (tx) => {
    const phone =
      patch.phoneNumber === undefined
        ? {}
        : await phoneFields(tx, simId, patch.phoneNumber, region, "admin");
    await tx
      .update(sims)
      .set({
        ...phone,
        rateLimitPolicyId:
          patch.rateLimitPolicyId === undefined ? undefined : patch.rateLimitPolicyId,
      })
      .where(eq(sims.id, simId));
    await appendAudit(tx, actor(admin), "sim.updated", { type: "sim", id: simId }, null, {
      numberChanged: patch.phoneNumber !== undefined,
      rateLimitPolicyId: patch.rateLimitPolicyId ?? null,
    });
  });
  return getSim(simId);
}

export async function pauseSim(admin: AdminActor, simId: string, reason: string) {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(sims).where(eq(sims.id, simId)).limit(1);
    const row = rows[0];
    if (row === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
    await tx
      .update(sims)
      .set({
        pausedByAdmin: true,
        pausedReason: reason,
        health: "paused_admin",
        healthChangedAt: now,
        healthReason: reason,
      })
      .where(eq(sims.id, simId));
    await tx.insert(simEvents).values({
      id: uuidv7(),
      simId,
      at: now,
      kind: "admin_pause",
      fromHealth: isHealth(row.health) ? row.health : null,
      toHealth: "paused_admin",
      detail: { reason },
    });
    await appendAudit(tx, actor(admin), "sim.paused", { type: "sim", id: simId }, null, { reason });
  });
  return getSim(simId);
}

export async function resumeSim(admin: AdminActor, simId: string) {
  const db = getDb();
  const now = new Date();
  const settings = await readHealth(db);
  const deviceRows = await db.select().from(devices);
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(sims).where(eq(sims.id, simId)).limit(1);
    const row = rows[0];
    if (row === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
    if (row.health !== "paused_admin") throw new AppError(409, "forbidden", SAFE_TEXT.forbidden);
    const device = deviceRows.find((item) => item.id === row.deviceId);
    if (device === undefined) throw new AppError(404, "not_found", SAFE_TEXT.not_found);
    const health = nextHealth({
      device,
      row: { ...row, pausedByAdmin: false },
      activeOnDevice: row.activeOnDevice,
      simState: row.simState,
      serviceState: row.serviceState,
      signalLevel: row.signalLevel,
      consecutiveFailures: row.consecutiveFailures,
      suspensionSignals24h: await suspensionCount(tx, simId, now),
      now,
      settings,
      clearSuspension: false,
    });
    await tx
      .update(sims)
      .set({
        pausedByAdmin: false,
        pausedReason: null,
        health,
        healthChangedAt: now,
        healthReason: "admin_resume",
      })
      .where(eq(sims.id, simId));
    await tx.insert(simEvents).values({
      id: uuidv7(),
      simId,
      at: now,
      kind: "admin_resume",
      fromHealth: "paused_admin",
      toHealth: health,
      detail: {},
    });
    await appendAudit(tx, actor(admin), "sim.resumed", { type: "sim", id: simId }, null, {
      health,
    });
  });
  return getSim(simId);
}

export async function retestSim(admin: AdminActor, simId: string, testNumber: string) {
  const db = getDb();
  if (await killSwitchOn(db)) throw new AppError(409, "forbidden", SAFE_TEXT.forbidden);
  const region = await readRegion(db);
  const e164 = normalizePhone(testNumber, region);
  const configured = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "test_numbers"))
    .limit(1);
  const parsed = settingSchemas.test_numbers.safeParse(configured[0]?.value);
  const allowed = [cryptoEnv().testNumbers ?? "", ...(parsed.success ? parsed.data : [])].join(",");
  if (!testNumberAllowed(e164, allowed)) {
    throw new AppError(403, "forbidden", SAFE_TEXT.forbidden);
  }
  const rows = await db.select().from(sims).where(eq(sims.id, simId)).limit(1);
  const sim = rows[0];
  if (sim === undefined || sim.retiredAt !== null)
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  const now = new Date();
  const body = `GChoPro line test ${now.toISOString()}`;
  const counted = countSegments(body);
  const messageId = uuidv7();
  const conversationId = uuidv7();
  const peerHash = indexPhone(e164);
  const scheduled = sim.nextSendAt !== null && sim.nextSendAt.getTime() > now.getTime();
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.userId, admin.userId), eq(conversations.peerNumberHash, peerHash)),
      )
      .limit(1);
    const conversation = existing[0];
    const usedConversation = conversation?.id ?? conversationId;
    if (conversation === undefined) {
      await tx.insert(conversations).values({
        id: conversationId,
        userId: admin.userId,
        simId,
        peerNumberEnc: seal(`conversations.peer_number_enc.${conversationId}`, e164),
        peerNumberHash: peerHash,
        lastMessageAt: now,
      });
    }
    await tx.insert(messages).values({
      id: messageId,
      conversationId: usedConversation,
      userId: admin.userId,
      simId,
      deviceId: sim.deviceId,
      direction: "out",
      peerNumberHash: peerHash,
      wireBodyEnc: seal(`messages.wire_body_enc.${messageId}`, body),
      encoding: counted.encoding,
      segments: counted.segments,
      status: scheduled ? "scheduled" : "queued",
      scheduledFor: scheduled ? sim.nextSendAt : null,
      queuedAt: scheduled ? null : now,
      isRetest: true,
    });
    await tx.insert(simEvents).values({
      id: uuidv7(),
      simId,
      at: now,
      kind: "retest_started",
      fromHealth: isHealth(sim.health) ? sim.health : null,
      toHealth: isHealth(sim.health) ? sim.health : null,
      detail: { messageId },
    });
    await appendAudit(tx, actor(admin), "sim.retest", { type: "sim", id: simId }, null, {
      messageId,
    });
  });
  return { messageId };
}

export async function noteSendOutcome(input: {
  simId: string;
  outcome: "sent" | "failed" | "delivered";
  failureName: string | null;
  failureCode: number | null;
  isRetest: boolean;
}) {
  const db = getDb();
  const now = new Date();
  const settings = await readHealth(db);
  const success = input.outcome === "sent" || input.outcome === "delivered";
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(sims).where(eq(sims.id, input.simId)).limit(1);
    const row = rows[0];
    if (row === undefined) return;
    const deviceRows = await tx.select().from(devices).where(eq(devices.id, row.deviceId)).limit(1);
    const device = deviceRows[0];
    if (device === undefined) return;
    const consecutiveFailures = success ? 0 : row.consecutiveFailures + 1;
    await saveHealth(tx, {
      device,
      row,
      activeOnDevice: row.activeOnDevice,
      simState: row.simState,
      serviceState: row.serviceState,
      signalLevel: row.signalLevel,
      consecutiveFailures,
      now,
      settings,
      clearSuspension: success && input.isRetest,
      requestId: randomUUID(),
      inventory: false,
      patch: {
        lastSendOkAt: success ? now : row.lastSendOkAt,
        lastFailureAt: success ? row.lastFailureAt : now,
        lastFailureCode: success ? row.lastFailureCode : input.failureCode,
        lastFailureName: success ? row.lastFailureName : input.failureName,
      },
    });
    if (input.isRetest) {
      await tx.insert(simEvents).values({
        id: uuidv7(),
        simId: row.id,
        at: now,
        kind: success ? "retest_passed" : "retest_failed",
        fromHealth: isHealth(row.health) ? row.health : null,
        toHealth: isHealth(row.health) ? row.health : null,
        detail: { outcome: input.outcome },
      });
    }
  });
}

export async function capacity() {
  const db = getDb();
  const deviceRows = await db.select().from(devices).where(eq(devices.status, "active"));
  const simRows = await db.select().from(sims);
  const userRows = await db
    .select({ id: users.id, simId: users.simId, role: users.role, status: users.status })
    .from(users)
    .where(and(eq(users.role, "user"), eq(users.status, "active"), isNull(users.deletedAt)));
  const assigned = new Set(userRows.filter((row) => row.simId !== null).map((row) => row.simId));
  const devicesOut = deviceRows.map((device) => {
    const active = simRows.filter(
      (sim) => sim.deviceId === device.id && sim.retiredAt === null && sim.activeOnDevice,
    );
    const assignedSims = active.filter((sim) => assigned.has(sim.id)).length;
    return {
      deviceId: device.id,
      name: device.name,
      slotsOnDevice: device.slotsOnDevice,
      activeSims: active.length,
      assignedSims,
      freeSims: active.length - assignedSims,
    };
  });
  const totals = devicesOut.reduce(
    (sum, device) => ({
      slots: sum.slots + device.slotsOnDevice,
      activeSims: sum.activeSims + device.activeSims,
      assigned: sum.assigned + device.assignedSims,
      free: sum.free + device.freeSims,
    }),
    { slots: 0, activeSims: 0, assigned: 0, free: 0 },
  );
  return {
    devices: devicesOut,
    totals: {
      ...totals,
      usersWithoutSim: userRows.filter((row) => row.simId === null).length,
    },
  };
}

export async function recordDeviceEvents(
  deviceId: string,
  events: { kind: string; detail?: Record<string, unknown>; at?: string }[],
) {
  const db = getDb();
  for (const event of events) {
    const type =
      event.kind === "battery_optimization_on"
        ? "device_battery_low"
        : event.kind === "sms_limit_prompt_shown"
          ? "sim_failure_spike"
          : "device_app_stopped";
    const at = event.at ?? new Date().toISOString();
    await db.insert(alerts).values({
      id: uuidv7(),
      type,
      severity: event.kind === "permission_missing" ? "warning" : "info",
      deviceId,
      title: event.kind,
      detail: { kind: event.kind, ...(event.detail ?? {}) },
      dedupeKey: `${deviceId}:${event.kind}:${at}`,
      notifiedChannels: [],
    });
  }
  return { ok: true };
}
