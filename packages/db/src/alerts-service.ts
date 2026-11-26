import {
  alertText,
  batteryLowOpen,
  batteryLowResolved,
  deviceOfflineDecision,
  loadEnv,
  renotifyDue,
  settingSchemas,
  type AlertSeverity,
} from "@gchopro/core";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "./client.js";
import { readHealth } from "./device-shared.js";
import { requireReady } from "./login.js";
import { alerts, devices, messageTranslations, settings } from "./schema.js";

export type AlertTransport = {
  email: (input: { to: string[]; subject: string; text: string }) => Promise<void>;
  telegram: (input: { chatId: string; text: string }) => Promise<void>;
};

type OpenAlert = {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  dedupeKey: string;
  lastNotifiedAt: Date | null;
};

async function findOpen(dedupeKey: string): Promise<OpenAlert | undefined> {
  const rows = await getDb()
    .select({
      id: alerts.id,
      type: alerts.type,
      severity: alerts.severity,
      title: alerts.title,
      dedupeKey: alerts.dedupeKey,
      lastNotifiedAt: alerts.lastNotifiedAt,
    })
    .from(alerts)
    .where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.resolvedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return undefined;
  return row;
}

async function openAlert(input: {
  type:
    | "device_offline"
    | "device_battery_low"
    | "sim_suspected_suspended"
    | "sim_state_change"
    | "kill_switch_changed"
    | "translation_provider_error";
  severity: AlertSeverity;
  title: string;
  dedupeKey: string;
  deviceId?: string;
  simId?: string;
  userId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const existing = await findOpen(input.dedupeKey);
  if (existing !== undefined) {
    if (existing.severity !== input.severity && input.severity === "critical") {
      await getDb()
        .update(alerts)
        .set({ severity: "critical", lastNotifiedAt: null })
        .where(eq(alerts.id, existing.id));
    }
    return;
  }
  await getDb()
    .insert(alerts)
    .values({
      id: uuidv7(),
      type: input.type,
      severity: input.severity,
      deviceId: input.deviceId,
      simId: input.simId,
      userId: input.userId,
      title: input.title,
      detail: input.detail ?? null,
      dedupeKey: input.dedupeKey,
      notifiedChannels: [],
    });
}

async function resolveAlert(dedupeKey: string): Promise<void> {
  await getDb()
    .update(alerts)
    .set({ resolvedAt: new Date() })
    .where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.resolvedAt)));
}

async function syncOneDevice(
  device: {
    id: string;
    status: string;
    lastHeartbeatAt: Date | null;
    battery: number | null;
    charging: boolean | null;
  },
  now: Date,
  offlineAfterSeconds: number,
  batteryLowPercent: number,
): Promise<void> {
  if (device.status === "retired") return;
  const offline = deviceOfflineDecision({
    lastHeartbeatAt: device.lastHeartbeatAt,
    now,
    offlineAfterSeconds,
  });
  const offlineKey = `device_offline:${device.id}`;
  if (offline.open) {
    await openAlert({
      type: "device_offline",
      severity: offline.severity,
      title: "Handset is offline",
      dedupeKey: offlineKey,
      deviceId: device.id,
    });
  } else {
    await resolveAlert(offlineKey);
  }
  const batteryKey = `device_battery_low:${device.id}`;
  const battery = {
    battery: device.battery,
    charging: device.charging,
    threshold: batteryLowPercent,
  };
  if (batteryLowOpen(battery)) {
    await openAlert({
      type: "device_battery_low",
      severity: "warning",
      title: "Handset battery is low",
      dedupeKey: batteryKey,
      deviceId: device.id,
    });
  } else if (batteryLowResolved(battery)) {
    await resolveAlert(batteryKey);
  }
}

const PROVIDER_ALERT = "translation_provider_error";

export async function noteTranslationResult(ok: boolean): Promise<void> {
  if (ok) {
    await resolveAlert(PROVIDER_ALERT);
    return;
  }
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await getDb()
    .select({ id: messageTranslations.id })
    .from(messageTranslations)
    .where(and(isNotNull(messageTranslations.error), gte(messageTranslations.createdAt, since)));
  if (rows.length < 5) return;
  await openAlert({
    type: "translation_provider_error",
    severity: "warning",
    title: "Translation provider is failing",
    dedupeKey: PROVIDER_ALERT,
  });
}

export async function syncDeviceAlert(deviceId: string, now = new Date()): Promise<void> {
  const db = getDb();
  const health = await readHealth(db);
  const rows = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  const device = rows[0];
  if (device === undefined) return;
  await syncOneDevice(device, now, health.offline_after_seconds, health.battery_low_percent);
}

export async function sweepDeviceAlerts(now = new Date()): Promise<void> {
  const db = getDb();
  const health = await readHealth(db);
  const rows = await db.select().from(devices).where(isNull(devices.retiredAt));
  for (const device of rows) {
    await syncOneDevice(device, now, health.offline_after_seconds, health.battery_low_percent);
  }
}

export async function defaultAlertTransport(): Promise<AlertTransport> {
  const env = loadEnv();
  return {
    email: async (input) => {
      if (env.SMTP_HOST === undefined || env.SMTP_FROM === undefined || input.to.length === 0)
        return;
      const nodemailer = (await import("nodemailer")) as {
        createTransport: (options: object) => {
          sendMail: (mail: object) => Promise<unknown>;
        };
      };
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        auth:
          env.SMTP_USER === undefined
            ? undefined
            : { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" },
      });
      await transport.sendMail({
        from: env.SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    },
    telegram: async (input) => {
      if (env.TELEGRAM_BOT_TOKEN === undefined) return;
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
      });
    },
  };
}

export async function deliverPendingAlerts(
  transport?: AlertTransport,
  now = new Date(),
): Promise<number> {
  const db = getDb();
  const channelRow = await db.select().from(settings).where(eq(settings.key, "alerts")).limit(1);
  const channels = settingSchemas.alerts.safeParse(channelRow[0]?.value);
  if (!channels.success) return 0;
  const sender = transport ?? (await defaultAlertTransport());
  const open = await db.select().from(alerts).where(isNull(alerts.resolvedAt));
  let sent = 0;
  for (const alert of open) {
    if (
      !renotifyDue({
        severity: alert.severity,
        lastNotifiedAt: alert.lastNotifiedAt,
        now,
      })
    ) {
      continue;
    }
    const text = alertText({ title: alert.title, type: alert.type });
    const notified: string[] = [];
    if (channels.data.email.enabled && channels.data.email.to.length > 0) {
      await sender.email({ to: channels.data.email.to, subject: alert.title, text });
      notified.push("email");
    }
    if (channels.data.telegram.enabled && channels.data.telegram.chat_id !== null) {
      await sender.telegram({ chatId: channels.data.telegram.chat_id, text });
      notified.push("telegram");
    }
    if (notified.length === 0) continue;
    await db
      .update(alerts)
      .set({ lastNotifiedAt: now, notifiedChannels: notified })
      .where(eq(alerts.id, alert.id));
    sent += 1;
  }
  return sent;
}

export async function listAlerts(
  token: string | undefined,
  status: "open" | "acknowledged" | "resolved",
) {
  await requireReady(token, "admin");
  const rows = await getDb().select().from(alerts);
  return rows
    .filter((row) => {
      if (status === "resolved") return row.resolvedAt !== null;
      if (status === "acknowledged") return row.acknowledgedAt !== null && row.resolvedAt === null;
      return row.acknowledgedAt === null && row.resolvedAt === null;
    })
    .map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }));
}

export async function sendAlertTest(
  transport?: AlertTransport,
): Promise<{ email: boolean; telegram: boolean }> {
  const db = getDb();
  const channelRow = await db.select().from(settings).where(eq(settings.key, "alerts")).limit(1);
  const channels = settingSchemas.alerts.safeParse(channelRow[0]?.value);
  if (!channels.success) return { email: false, telegram: false };
  const sender = transport ?? (await defaultAlertTransport());
  const text = "GChoPro alert test";
  let email = false;
  let telegram = false;
  if (channels.data.email.enabled && channels.data.email.to.length > 0) {
    await sender.email({ to: channels.data.email.to, subject: "GChoPro alert test", text });
    email = true;
  }
  if (channels.data.telegram.enabled && channels.data.telegram.chat_id !== null) {
    await sender.telegram({ chatId: channels.data.telegram.chat_id, text });
    telegram = true;
  }
  return { email, telegram };
}

export async function acknowledgeAlert(token: string | undefined, id: string) {
  const session = await requireReady(token, "admin");
  const rows = await getDb()
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: session.userId })
    .where(eq(alerts.id, id))
    .returning({ id: alerts.id });
  return rows[0] ?? null;
}
