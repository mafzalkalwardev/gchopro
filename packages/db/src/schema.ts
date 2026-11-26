import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  cidr,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const createdAt = () => tz("created_at").defaultNow().notNull();

const updatedAt = () =>
  tz("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const NIL_USER_ID = "00000000-0000-0000-0000-000000000000";

export const userRole = pgEnum("user_role", ["admin", "user"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const lang = pgEnum("lang", ["zh", "en"]);
export const sessionApp = pgEnum("session_app", ["admin", "portal"]);
export const revokeReason = pgEnum("revoke_reason", [
  "logout",
  "password_reset",
  "password_change",
  "user_disabled",
  "subscription_inactive",
  "admin_revoke",
  "sim_unassigned",
  "expired",
]);
export const deviceStatus = pgEnum("device_status", ["pairing", "active", "retired"]);
export const deviceNetwork = pgEnum("device_network", ["wifi", "cellular", "none", "unknown"]);
export const numberSource = pgEnum("number_source", ["device", "admin"]);
export const simHealth = pgEnum("sim_health", [
  "active",
  "no_service",
  "absent",
  "locked",
  "suspected_suspended",
  "error",
  "paused_admin",
  "inactive",
  "retired",
]);
export const simEventKind = pgEnum("sim_event_kind", [
  "state_report",
  "health_change",
  "send_failure",
  "admin_pause",
  "admin_resume",
  "retest_started",
  "retest_passed",
  "retest_failed",
]);
export const planUnit = pgEnum("plan_unit", ["day", "week", "month", "year"]);
export const subStatus = pgEnum("sub_status", [
  "scheduled",
  "active",
  "paused",
  "expired",
  "disabled",
]);
export const expiryBehavior = pgEnum("expiry_behavior", ["block", "read_only"]);
export const direction = pgEnum("direction", ["out", "in"]);
export const smsEncoding = pgEnum("sms_encoding", ["gsm7", "ucs2"]);
export const msgStatus = pgEnum("msg_status", [
  "scheduled",
  "queued",
  "held",
  "dispatched",
  "sent",
  "delivered",
  "failed",
  "blocked",
  "cancelled",
  "received",
]);
export const holdReason = pgEnum("hold_reason", [
  "rate_minute",
  "rate_hour",
  "rate_day",
  "window",
  "sim_unhealthy",
  "kill_switch",
  "subscription",
  "device_offline",
  "translation_pending",
  "rate_segments",
]);
export const blockReason = pgEnum("block_reason", [
  "opted_out",
  "content_rule",
  "subscription_inactive",
  "limit_reached",
  "user_disabled",
  "no_sim",
  "invalid_number",
]);
export const failureClass = pgEnum("failure_class", [
  "transient",
  "sim_problem",
  "suspension_signal",
  "permanent",
  "unknown",
]);
export const translationRole = pgEnum("translation_role", ["outbound_original", "inbound_display"]);
export const translationProvider = pgEnum("translation_provider", [
  "deepl",
  "google",
  "libretranslate",
  "none",
]);
export const groupSendStatus = pgEnum("group_send_status", [
  "queued",
  "in_progress",
  "completed",
  "cancelled",
]);
export const consentSource = pgEnum("consent_source", [
  "existing_customer",
  "verbal",
  "written",
  "web_form",
  "imported_with_consent",
  "other",
]);
export const optOutScope = pgEnum("opt_out_scope", ["global", "user"]);
export const optOutSource = pgEnum("opt_out_source", ["keyword", "admin", "import"]);
export const templateKind = pgEnum("template_kind", ["template", "quick_reply"]);
export const windowTimezoneMode = pgEnum("window_timezone_mode", ["user", "fixed"]);
export const overLimitAction = pgEnum("over_limit_action", ["hold", "reject"]);
export const actorKind = pgEnum("actor_kind", ["admin", "user", "device", "system"]);
export const alertType = pgEnum("alert_type", [
  "device_offline",
  "device_battery_low",
  "device_app_stopped",
  "sim_state_change",
  "sim_suspected_suspended",
  "sim_failure_spike",
  "queue_backlog",
  "kill_switch_changed",
  "subscription_expiring",
  "backup_failed",
  "backup_restore_test",
  "login_anomaly",
  "translation_provider_error",
]);
export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "critical"]);
export const noticeAudience = pgEnum("notice_audience", ["all", "selected"]);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull().default("Handset"),
    status: deviceStatus("status").notNull(),
    pairingCodeHash: text("pairing_code_hash"),
    pairingExpiresAt: tz("pairing_expires_at"),
    pairingAttempts: integer("pairing_attempts").notNull().default(0),
    tokenHash: text("token_hash"),
    tokenPrevHash: text("token_prev_hash"),
    tokenPrevExpiresAt: tz("token_prev_expires_at"),
    tokenRotatedAt: tz("token_rotated_at"),
    protocolVersion: integer("protocol_version").notNull(),
    slotsOnDevice: smallint("slots_on_device").notNull().default(0),
    rotateRequested: boolean("rotate_requested").notNull().default(false),
    appVersion: text("app_version"),
    model: text("model"),
    androidSdk: integer("android_sdk"),
    lastHeartbeatAt: tz("last_heartbeat_at"),
    battery: smallint("battery"),
    charging: boolean("charging"),
    network: deviceNetwork("network"),
    smsRateLimitNote: text("sms_rate_limit_note"),
    paused: boolean("paused").notNull().default(false),
    createdAt: createdAt(),
    retiredAt: tz("retired_at"),
  },
  (table) => [
    index("devices_status").on(table.status),
    uniqueIndex("devices_token_hash_unique").on(table.tokenHash),
    uniqueIndex("devices_token_prev_hash_unique").on(table.tokenPrevHash),
    check(
      "devices_battery_range",
      sql`${table.battery} IS NULL OR (${table.battery} >= 0 AND ${table.battery} <= 100)`,
    ),
  ],
);

export const rateLimitPolicies = pgTable(
  "rate_limit_policies",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull().unique(),
    isDefault: boolean("is_default").notNull().default(false),
    gapBaseSeconds: integer("gap_base_seconds").notNull().default(15),
    gapJitterSeconds: integer("gap_jitter_seconds").notNull().default(5),
    perMinute: integer("per_minute").notNull().default(3),
    perHour: integer("per_hour").notNull().default(50),
    perDay: integer("per_day").notNull().default(300),
    segmentsPerDay: integer("segments_per_day").notNull().default(400),
    maxGroupRecipients: integer("max_group_recipients").notNull().default(50),
    windowStart: time("window_start").notNull().default("09:00:00"),
    windowEnd: time("window_end").notNull().default("20:00:00"),
    windowDays: smallint("window_days")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'`),
    windowTimezoneMode: windowTimezoneMode("window_timezone_mode").notNull().default("user"),
    windowTimezone: text("window_timezone"),
    overLimitAction: overLimitAction("over_limit_action").notNull().default("hold"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id),
  },
  (table) => [
    uniqueIndex("rate_limit_policies_one_default")
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
    // The minimum gap floor lives in settings.min_gap_floor_seconds (default 5) and is enforced in core.
    check(
      "rate_limit_policies_jitter",
      sql`${table.gapJitterSeconds} >= 0 AND ${table.gapJitterSeconds} <= ${table.gapBaseSeconds} / 2`,
    ),
    check(
      "rate_limit_policies_caps",
      sql`${table.gapBaseSeconds} >= 1 AND ${table.perMinute} >= 1 AND ${table.perHour} >= 1 AND ${table.perDay} >= 1 AND ${table.segmentsPerDay} >= 1 AND ${table.maxGroupRecipients} >= 1`,
    ),
  ],
);

export const sims = pgTable(
  "sims",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    slotIndex: smallint("slot_index").notNull(),
    subscriptionId: integer("subscription_id").notNull(),
    isEmbedded: boolean("is_embedded").notNull().default(false),
    carrierName: text("carrier_name"),
    displayName: text("display_name"),
    mccMnc: text("mcc_mnc"),
    countryIso: text("country_iso"),
    phoneNumberEnc: text("phone_number_enc"),
    phoneNumberHash: text("phone_number_hash"),
    numberSource: numberSource("number_source"),
    activeOnDevice: boolean("active_on_device").notNull().default(false),
    health: simHealth("health").notNull(),
    healthReason: text("health_reason"),
    healthChangedAt: tz("health_changed_at"),
    simState: text("sim_state"),
    serviceState: text("service_state"),
    signalLevel: smallint("signal_level"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSendOkAt: tz("last_send_ok_at"),
    lastReceiveAt: tz("last_receive_at"),
    lastFailureAt: tz("last_failure_at"),
    lastFailureCode: integer("last_failure_code"),
    lastFailureName: text("last_failure_name"),
    pausedByAdmin: boolean("paused_by_admin").notNull().default(false),
    pausedReason: text("paused_reason"),
    inboundEnabled: boolean("inbound_enabled").notNull().default(true),
    nextSendAt: tz("next_send_at"),
    rateLimitPolicyId: uuid("rate_limit_policy_id").references(() => rateLimitPolicies.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    retiredAt: tz("retired_at"),
  },
  (table) => [
    uniqueIndex("sims_device_subscription_open")
      .on(table.deviceId, table.subscriptionId)
      .where(sql`${table.retiredAt} IS NULL`),
    uniqueIndex("sims_device_slot_active")
      .on(table.deviceId, table.slotIndex)
      .where(sql`${table.retiredAt} IS NULL AND ${table.activeOnDevice}`),
    uniqueIndex("sims_phone_hash_unique")
      .on(table.phoneNumberHash)
      .where(sql`${table.phoneNumberHash} IS NOT NULL`),
    check(
      "sims_signal_range",
      sql`${table.signalLevel} IS NULL OR (${table.signalLevel} >= 0 AND ${table.signalLevel} <= 4)`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    role: userRole("role").notNull(),
    username: citext("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: tz("password_changed_at").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    allowSelfPasswordChange: boolean("allow_self_password_change").notNull().default(true),
    status: userStatus("status").notNull().default("active"),
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpLastUsedStep: bigint("totp_last_used_step", { mode: "bigint" }),
    recoveryCodesHash: text("recovery_codes_hash").array(),
    simId: uuid("sim_id").references(() => sims.id),
    rateLimitPolicyId: uuid("rate_limit_policy_id").references(() => rateLimitPolicies.id),
    userLanguage: lang("user_language").notNull().default("en"),
    recipientLanguage: lang("recipient_language").notNull().default("en"),
    translationEnabled: boolean("translation_enabled").notNull().default(false),
    timezone: text("timezone").notNull().default("Asia/Karachi"),
    allowExport: boolean("allow_export").notNull().default(true),
    ipAllowlist: cidr("ip_allowlist").array(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tz("locked_until"),
    lastLoginAt: tz("last_login_at"),
    aupAcceptedAt: tz("aup_accepted_at"),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz("deleted_at"),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_sim_id_unique")
      .on(table.simId)
      .where(sql`${table.simId} IS NOT NULL`),
    index("users_role_status").on(table.role, table.status),
    check("users_admin_no_sim", sql`${table.role} <> 'admin' OR ${table.simId} IS NULL`),
    check("users_username_shape", sql`${table.username} ~ '^[a-z0-9._-]{3,40}$'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app: sessionApp("app").notNull(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: tz("last_seen_at").notNull(),
    expiresAt: tz("expires_at").notNull(),
    absoluteExpiresAt: tz("absolute_expires_at").notNull(),
    revokedAt: tz("revoked_at"),
    revokeReason: revokeReason("revoke_reason"),
  },
  (table) => [
    index("sessions_user_active")
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("sessions_expires_at").on(table.expiresAt),
  ],
);

export const simEvents = pgTable(
  "sim_events",
  {
    id: uuid("id").primaryKey(),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id),
    at: tz("at").defaultNow().notNull(),
    kind: simEventKind("kind").notNull(),
    fromHealth: simHealth("from_health"),
    toHealth: simHealth("to_health"),
    detail: jsonb("detail"),
  },
  (table) => [index("sim_events_sim_at").on(table.simId, table.at.desc())],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planUnit: planUnit("plan_unit").notNull(),
    planQuantity: integer("plan_quantity").notNull(),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    status: subStatus("status").notNull(),
    pausedAt: tz("paused_at"),
    pausedRemainingSeconds: bigint("paused_remaining_seconds", { mode: "bigint" }),
    expiryBehavior: expiryBehavior("expiry_behavior").notNull().default("block"),
    reminderSentAt: tz("reminder_sent_at"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("subscriptions_user").on(table.userId),
    uniqueIndex("subscriptions_one_open")
      .on(table.userId)
      .where(sql`${table.status} IN ('active', 'paused')`),
    check("subscriptions_quantity_positive", sql`${table.planQuantity} >= 1`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    nameEnc: text("name_enc").notNull(),
    numberEnc: text("number_enc").notNull(),
    numberHash: text("number_hash").notNull(),
    consentSource: consentSource("consent_source").notNull(),
    consentNote: text("consent_note"),
    consentAt: tz("consent_at"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("contacts_user_number").on(table.userId, table.numberHash)],
);

export const contactGroups = pgTable(
  "contact_groups",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("contact_groups_user_name").on(table.userId, table.name)],
);

export const contactGroupMembers = pgTable(
  "contact_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => contactGroups.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.contactId] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id),
    peerNumberEnc: text("peer_number_enc").notNull(),
    peerNumberHash: text("peer_number_hash").notNull(),
    peerCountry: text("peer_country"),
    contactId: uuid("contact_id").references(() => contacts.id),
    lastMessageAt: tz("last_message_at"),
    lastPreviewEnc: text("last_preview_enc"),
    unreadCount: integer("unread_count").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("conversations_user_peer").on(table.userId, table.peerNumberHash),
    index("conversations_user_last").on(table.userId, table.lastMessageAt.desc()),
    index("conversations_tags").using("gin", table.tags),
  ],
);

export const groupSends = pgTable("group_sends", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name"),
  bodyTemplateEnc: text("body_template_enc"),
  recipientCount: integer("recipient_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  status: groupSendStatus("status").notNull(),
  createdAt: createdAt(),
  completedAt: tz("completed_at"),
});

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    name: text("name").notNull(),
    body: text("body").notNull(),
    variables: text("variables")
      .array()
      .notNull()
      .default(sql`'{}'`),
    lang: lang("lang"),
    kind: templateKind("kind").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("templates_owner_name").on(
      sql`coalesce(${table.ownerUserId}, '${sql.raw(NIL_USER_ID)}'::uuid)`,
      table.name,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    direction: direction("direction").notNull(),
    peerNumberHash: text("peer_number_hash").notNull(),
    wireBodyEnc: text("wire_body_enc"),
    wireLang: lang("wire_lang"),
    encoding: smsEncoding("encoding"),
    segments: smallint("segments"),
    status: msgStatus("status").notNull(),
    holdReason: holdReason("hold_reason"),
    blockReason: blockReason("block_reason"),
    failureCode: integer("failure_code"),
    failureName: text("failure_name"),
    failureClass: failureClass("failure_class"),
    attempts: smallint("attempts").notNull().default(0),
    groupSendId: uuid("group_send_id").references(() => groupSends.id),
    templateId: uuid("template_id").references(() => templates.id),
    scheduledFor: tz("scheduled_for"),
    queuedAt: tz("queued_at"),
    dispatchedAt: tz("dispatched_at"),
    leaseExpiresAt: tz("lease_expires_at"),
    sentAt: tz("sent_at"),
    deliveredAt: tz("delivered_at"),
    failedAt: tz("failed_at"),
    receivedAt: tz("received_at"),
    providerId: text("provider_id"),
    partsSent: smallint("parts_sent"),
    partsDelivered: smallint("parts_delivered"),
    idempotencyKey: text("idempotency_key"),
    isRetest: boolean("is_retest").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("messages_conversation_created").on(table.conversationId, table.createdAt.desc()),
    index("messages_user_created").on(table.userId, table.createdAt.desc()),
    index("messages_sim_status").on(table.simId, table.status),
    index("messages_scheduled")
      .on(table.status, table.scheduledFor)
      .where(sql`${table.status} = 'scheduled'`),
    index("messages_dispatched")
      .on(table.deviceId, table.status)
      .where(sql`${table.status} = 'dispatched'`),
    uniqueIndex("messages_device_provider")
      .on(table.deviceId, table.providerId)
      .where(sql`${table.providerId} IS NOT NULL`),
    uniqueIndex("messages_idempotency_key").on(table.idempotencyKey),
  ],
);

export const messagePartReports = pgTable(
  "message_part_reports",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    event: text("event").notNull(),
    partIndex: smallint("part_index").notNull(),
    resultCode: integer("result_code"),
    resultName: text("result_name"),
    reportedAt: tz("reported_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.event, table.partIndex] })],
);

export const messageTranslations = pgTable(
  "message_translations",
  {
    id: uuid("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    role: translationRole("role").notNull(),
    sourceLang: lang("source_lang").notNull(),
    targetLang: lang("target_lang").notNull(),
    sourceTextEnc: text("source_text_enc").notNull(),
    translatedTextEnc: text("translated_text_enc"),
    provider: translationProvider("provider").notNull(),
    providerModel: text("provider_model"),
    characters: integer("characters"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("message_translations_message_role").on(table.messageId, table.role)],
);

export const optOuts = pgTable(
  "opt_outs",
  {
    id: uuid("id").primaryKey(),
    numberHash: text("number_hash").notNull(),
    scope: optOutScope("scope").notNull(),
    userId: uuid("user_id").references(() => users.id),
    source: optOutSource("source").notNull(),
    keyword: text("keyword"),
    sourceMessageId: uuid("source_message_id").references(() => messages.id),
    createdAt: createdAt(),
    reversedAt: tz("reversed_at"),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reverseReason: text("reverse_reason"),
  },
  (table) => [
    uniqueIndex("opt_outs_active_unique")
      .on(
        table.numberHash,
        table.scope,
        sql`coalesce(${table.userId}, '${sql.raw(NIL_USER_ID)}'::uuid)`,
      )
      .where(sql`${table.reversedAt} IS NULL`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedByDefaultAsIdentity(),
    at: tz("at").defaultNow().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorRole: text("actor_role"),
    actorIp: inet("actor_ip"),
    actorKind: actorKind("actor_kind").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (table) => [
    index("audit_logs_at").on(table.at.desc()),
    index("audit_logs_target").on(table.targetType, table.targetId),
    index("audit_logs_actor").on(table.actorUserId, table.at.desc()),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey(),
    type: alertType("type").notNull(),
    severity: alertSeverity("severity").notNull(),
    deviceId: uuid("device_id").references(() => devices.id),
    simId: uuid("sim_id").references(() => sims.id),
    userId: uuid("user_id").references(() => users.id),
    title: text("title").notNull(),
    detail: jsonb("detail"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
    acknowledgedAt: tz("acknowledged_at"),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
    resolvedAt: tz("resolved_at"),
    notifiedChannels: text("notified_channels")
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    uniqueIndex("alerts_open_dedupe")
      .on(table.dedupeKey)
      .where(sql`${table.resolvedAt} IS NULL`),
  ],
);

export const paymentsLog = pgTable(
  "payments_log",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    paidAt: tz("paid_at").notNull(),
    notes: text("notes"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedAt: tz("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (table) => [check("payments_amount_nonnegative", sql`${table.amountMinor} >= 0`)],
);

export const notices = pgTable("notices", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: noticeAudience("audience").notNull(),
  userIds: uuid("user_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
  startsAt: tz("starts_at"),
  endsAt: tz("ends_at"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const noticeReads = pgTable(
  "notice_reads",
  {
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    readAt: tz("read_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.noticeId, table.userId] })],
);

export const statsDaily = pgTable(
  "stats_daily",
  {
    day: date("day").notNull(),
    userId: uuid("user_id").references(() => users.id),
    simId: uuid("sim_id")
      .notNull()
      .references(() => sims.id),
    userScopeId: uuid("user_scope_id").generatedAlwaysAs(
      sql`coalesce("user_id", '${sql.raw(NIL_USER_ID)}'::uuid)`,
    ),
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    received: integer("received").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
    segmentsOut: integer("segments_out").notNull().default(0),
    optOuts: integer("opt_outs").notNull().default(0),
    deliveryMsSum: bigint("delivery_ms_sum", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    deliveryMsCount: integer("delivery_ms_count").notNull().default(0),
    limitHolds: integer("limit_holds").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.day, table.simId, table.userScopeId] })],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id),
});
