import { randomBytes } from "node:crypto";
import {
  assertSeedAllowed,
  hashPassword,
  loadEnv,
  parseSeedIdentity,
  verifyPassword,
} from "@gchopro/core";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { deviceTokenHash, encryptField, phoneIndex } from "./field-crypto.js";
import {
  conversations,
  devices,
  messages,
  optOuts,
  rateLimitPolicies,
  settings,
  sims,
  subscriptions,
  templates,
  users,
} from "./schema.js";

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

function addMonthsInKarachi(from: Date, months: number): Date {
  const local = new Date(from.getTime() + KARACHI_OFFSET_MS);
  local.setUTCMonth(local.getUTCMonth() + months);
  return new Date(local.getTime() - KARACHI_OFFSET_MS);
}

function printSecret(label: string, value: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`${label}: ${value}\n`);
    return;
  }
  process.stdout.write(`${label} issued. Re-run pnpm db:seed in a terminal to see it once.\n`);
}

const env = loadEnv();
assertSeedAllowed(env.APP_ENV);
const identity = parseSeedIdentity(process.env);
const client = postgres(env.DATABASE_OWNER_URL, { max: 1 });
const db = drizzle(client);
const activeKey = env.FIELD_ENCRYPTION_KEYS[env.FIELD_ENCRYPTION_ACTIVE_KEY_ID];
if (activeKey === undefined) {
  throw new Error("Invalid environment: FIELD_ENCRYPTION_ACTIVE_KEY_ID");
}

const conservativeId = uuidv7();
const veryConservativeId = uuidv7();
const customId = uuidv7();
const now = new Date();

await db
  .insert(rateLimitPolicies)
  .values([
    {
      id: conservativeId,
      name: "Conservative (default)",
      isDefault: true,
      gapBaseSeconds: 15,
      gapJitterSeconds: 5,
      perMinute: 3,
      perHour: 50,
      perDay: 300,
      segmentsPerDay: 400,
      maxGroupRecipients: 50,
    },
    {
      id: veryConservativeId,
      name: "Very conservative",
      isDefault: false,
      gapBaseSeconds: 30,
      gapJitterSeconds: 10,
      perMinute: 2,
      perHour: 30,
      perDay: 150,
      segmentsPerDay: 400,
      maxGroupRecipients: 50,
    },
    {
      id: customId,
      name: "Custom (template)",
      isDefault: false,
      gapBaseSeconds: 15,
      gapJitterSeconds: 5,
      perMinute: 3,
      perHour: 50,
      perDay: 300,
      segmentsPerDay: 400,
      maxGroupRecipients: 50,
    },
  ])
  .onConflictDoNothing();

const policyRows = await db.select().from(rateLimitPolicies);
const conservative = policyRows.find((row) => row.name === "Conservative (default)");
if (conservative === undefined) throw new Error("Conservative policy was not seeded");

const settingRows: { key: string; value: unknown }[] = [
  { key: "kill_switch", value: { enabled: false, reason: null, since: null } },
  { key: "min_gap_floor_seconds", value: 5 },
  { key: "default_policy_id", value: conservative.id },
  { key: "default_timezone", value: "Asia/Karachi" },
  { key: "default_region", value: "PK" },
  {
    key: "translation",
    value: {
      provider: "none",
      deepl: { plan: "free" },
      google: {},
      libretranslate: { url: null },
      preview_before_send: true,
    },
  },
  {
    key: "opt_out_keywords",
    value: [
      "STOP",
      "STOPALL",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "退订",
      "取消",
      "停止",
      "TD",
    ],
  },
  { key: "opt_in_keywords", value: ["START", "UNSTOP", "订阅"] },
  { key: "opt_out_scope", value: "global" },
  { key: "test_numbers", value: [] },
  {
    key: "opt_out_confirmation",
    value: {
      enabled: true,
      text_en: "You have been unsubscribed and will not receive further messages.",
      text_zh: "您已退订，将不会再收到消息。",
    },
  },
  { key: "sender_signature", value: { enabled: false, text: "" } },
  { key: "content_rules", value: { blocked_keywords: [], block_urls: false } },
  {
    key: "health",
    value: {
      consecutive_failure_threshold: 3,
      suspension_signal_threshold: 2,
      offline_after_seconds: 90,
      battery_low_percent: 20,
    },
  },
  {
    key: "alerts",
    value: { email: { enabled: false, to: [] }, telegram: { enabled: false, chat_id: null } },
  },
  { key: "retention", value: { message_body_days: 180, audit_days: 730 } },
  { key: "portal", value: { expiry_behavior_default: "block", allow_admin_support_view: false } },
  { key: "branding", value: { product_name: "GChoPro" } },
];

await db
  .insert(settings)
  .values(settingRows.map((row) => ({ key: row.key, value: row.value })))
  .onConflictDoNothing();

const adminId = uuidv7();
await db
  .insert(users)
  .values({
    id: adminId,
    role: "admin",
    username: identity.SEED_ADMIN_USERNAME,
    displayName: "Administrator",
    passwordHash: await hashPassword(identity.SEED_ADMIN_PASSWORD),
    passwordChangedAt: now,
    mustChangePassword: true,
    totpEnabled: false,
    timezone: "Asia/Karachi",
  })
  .onConflictDoNothing();

const admin = (
  await db.select().from(users).where(eq(users.username, identity.SEED_ADMIN_USERNAME))
)[0];
if (admin === undefined) throw new Error("Admin user was not seeded");

const opsPassword = process.env.SEED_OPS_PASSWORD;
if (opsPassword !== undefined && opsPassword.length >= 16) {
  await db
    .insert(users)
    .values({
      id: uuidv7(),
      role: "admin",
      username: "ops",
      displayName: "Operations",
      passwordHash: await hashPassword(opsPassword),
      passwordChangedAt: now,
      mustChangePassword: true,
      totpEnabled: false,
      timezone: "Asia/Karachi",
    })
    .onConflictDoNothing();
  const ops = (await db.select().from(users).where(eq(users.username, "ops")))[0];
  if (ops === undefined || !(await verifyPassword(ops.passwordHash, opsPassword))) {
    throw new Error("Operations admin was not seeded");
  }
}

await db
  .insert(templates)
  .values([
    {
      id: uuidv7(),
      ownerUserId: null,
      name: "Greeting",
      body: "Hello {name}, …",
      variables: ["name"],
      lang: "en",
      kind: "template",
      createdBy: admin.id,
    },
    {
      id: uuidv7(),
      ownerUserId: null,
      name: "Thanks, noted.",
      body: "Thanks, noted.",
      variables: [],
      lang: "en",
      kind: "quick_reply",
      createdBy: admin.id,
    },
    {
      id: uuidv7(),
      ownerUserId: null,
      name: "收到，谢谢。",
      body: "收到，谢谢。",
      variables: [],
      lang: "zh",
      kind: "quick_reply",
      createdBy: admin.id,
    },
  ])
  .onConflictDoNothing();

if (env.APP_ENV === "development") {
  const existing = (await db.select().from(users).where(eq(users.username, "demo1")))[0];
  if (existing === undefined) {
    const deviceId = uuidv7();
    const sim1 = uuidv7();
    const sim2 = uuidv7();
    const demo1 = uuidv7();
    const demo2 = uuidv7();
    const token = randomBytes(32).toString("hex");
    const configuredDemo = process.env.SEED_DEMO_PASSWORD;
    const sharedDemo =
      configuredDemo !== undefined && configuredDemo.length >= 16 ? configuredDemo : null;
    const demo1Password = sharedDemo ?? randomBytes(18).toString("base64url");
    const demo2Password = sharedDemo ?? randomBytes(18).toString("base64url");
    const peer1 = "+15005550001";
    const peer2 = "+15005550002";
    const conversation1 = uuidv7();
    const conversation2 = uuidv7();
    const message1 = uuidv7();
    const message2 = uuidv7();
    const body1 = "Hello from GChoPro.";
    const body2 = "Second line.";

    await db.insert(devices).values({
      id: deviceId,
      name: "Dev Phone",
      status: "active",
      tokenHash: deviceTokenHash(env.TOKEN_PEPPER, token),
      protocolVersion: 2,
      paused: false,
    });
    await db.insert(sims).values([
      {
        id: sim1,
        deviceId,
        slotIndex: 0,
        subscriptionId: 1,
        activeOnDevice: true,
        health: "active",
        carrierName: "Dev Carrier",
      },
      {
        id: sim2,
        deviceId,
        slotIndex: 1,
        subscriptionId: 2,
        activeOnDevice: true,
        health: "active",
        carrierName: "Dev Carrier",
      },
    ]);
    await db.insert(users).values([
      {
        id: demo1,
        role: "user",
        username: "demo1",
        displayName: "Demo 1",
        passwordHash: await hashPassword(demo1Password),
        passwordChangedAt: now,
        mustChangePassword: true,
        simId: sim1,
        userLanguage: "zh",
        recipientLanguage: "en",
        translationEnabled: true,
        timezone: "Asia/Karachi",
        createdBy: admin.id,
      },
      {
        id: demo2,
        role: "user",
        username: "demo2",
        displayName: "Demo 2",
        passwordHash: await hashPassword(demo2Password),
        passwordChangedAt: now,
        mustChangePassword: true,
        simId: sim2,
        userLanguage: "en",
        recipientLanguage: "en",
        translationEnabled: false,
        timezone: "Asia/Karachi",
        createdBy: admin.id,
      },
    ]);
    await db.insert(subscriptions).values([
      {
        id: uuidv7(),
        userId: demo1,
        planUnit: "month",
        planQuantity: 1,
        startsAt: now,
        endsAt: addMonthsInKarachi(now, 1),
        status: "active",
        expiryBehavior: "block",
        createdBy: admin.id,
      },
      {
        id: uuidv7(),
        userId: demo2,
        planUnit: "day",
        planQuantity: 2,
        startsAt: now,
        endsAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        status: "active",
        expiryBehavior: "block",
        createdBy: admin.id,
      },
    ]);
    await db.insert(conversations).values([
      {
        id: conversation1,
        userId: demo1,
        simId: sim1,
        peerNumberEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `conversations.peer_number_enc.${conversation1}`,
          peer1,
        ),
        peerNumberHash: phoneIndex(env.PHONE_INDEX_KEY, peer1),
        lastPreviewEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `conversations.last_preview_enc.${conversation1}`,
          body1,
        ),
        lastMessageAt: now,
      },
      {
        id: conversation2,
        userId: demo2,
        simId: sim2,
        peerNumberEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `conversations.peer_number_enc.${conversation2}`,
          peer2,
        ),
        peerNumberHash: phoneIndex(env.PHONE_INDEX_KEY, peer2),
        lastPreviewEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `conversations.last_preview_enc.${conversation2}`,
          body2,
        ),
        lastMessageAt: now,
      },
    ]);
    await db.insert(messages).values([
      {
        id: message1,
        conversationId: conversation1,
        userId: demo1,
        simId: sim1,
        deviceId,
        direction: "out",
        peerNumberHash: phoneIndex(env.PHONE_INDEX_KEY, peer1),
        wireBodyEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `messages.wire_body_enc.${message1}`,
          body1,
        ),
        wireLang: "en",
        encoding: "gsm7",
        segments: 1,
        status: "delivered",
        sentAt: now,
        deliveredAt: now,
      },
      {
        id: message2,
        conversationId: conversation2,
        userId: demo2,
        simId: sim2,
        deviceId,
        direction: "out",
        peerNumberHash: phoneIndex(env.PHONE_INDEX_KEY, peer2),
        wireBodyEnc: encryptField(
          activeKey,
          env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
          `messages.wire_body_enc.${message2}`,
          body2,
        ),
        wireLang: "en",
        encoding: "gsm7",
        segments: 1,
        status: "delivered",
        sentAt: now,
        deliveredAt: now,
      },
    ]);
    const optOutId = uuidv7();
    await db.insert(optOuts).values({
      id: optOutId,
      numberHash: phoneIndex(env.PHONE_INDEX_KEY, "+15005550006"),
      numberEnc: encryptField(
        activeKey,
        env.FIELD_ENCRYPTION_ACTIVE_KEY_ID,
        `opt_outs.number_enc.${optOutId}`,
        "+15005550006",
      ),
      scope: "global",
      source: "admin",
    });
    printSecret("Dev Phone token", token);
    if (sharedDemo === null) {
      printSecret("demo1 password", demo1Password);
      printSecret("demo2 password", demo2Password);
    }
  }
}

await client.end();
process.stdout.write("seed complete\n");
