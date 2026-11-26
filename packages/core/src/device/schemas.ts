import { z } from "zod";

const iso = z.string().datetime();

export const registerBody = z.object({
  code: z.string(),
  name: z.string().min(1).max(80),
  protocolVersion: z.number().int(),
  appVersion: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  androidSdk: z.number().int().min(1).max(100),
});

export const heartbeatBody = z.object({
  battery: z.number().int().min(0).max(100),
  charging: z.boolean(),
  network: z.enum(["wifi", "cellular", "none", "unknown"]),
  appVersion: z.string().min(1).max(40),
  androidSdk: z.number().int().min(1).max(100),
  activeModemCount: z.number().int().min(0).max(8),
  uptimeSec: z.number().int().min(0),
});

export const reportedSim = z.object({
  subscriptionId: z.number().int(),
  slotIndex: z.number().int().min(0).max(7),
  isEmbedded: z.boolean(),
  carrierName: z.string().max(80).nullable().optional(),
  displayName: z.string().max(80).nullable().optional(),
  mcc: z.string().max(4).nullable().optional(),
  mnc: z.string().max(4).nullable().optional(),
  countryIso: z.string().max(8).nullable().optional(),
  number: z.string().max(32),
  simState: z.string().max(64).nullable().optional(),
  serviceState: z.string().max(64).nullable().optional(),
  signalLevel: z.number().int().min(0).max(4).nullable().optional(),
});

export const simReportBody = z.object({
  reportedAt: iso,
  slotsOnDevice: z.number().int().min(0).max(8),
  sims: z.array(reportedSim).max(8),
});

const reportEvent = z.enum(["sent", "failed", "delivered", "delivery_failed", "delivery_pending"]);

export const statusReport = z.object({
  id: z.string().uuid(),
  event: reportEvent,
  partIndex: z.number().int().min(0).max(20),
  partCount: z.number().int().min(1).max(20),
  subscriptionId: z.number().int(),
  resultCode: z.number().int().nullable().optional(),
  resultName: z.string().max(80).nullable().optional(),
  radioErrorCode: z.number().int().nullable().optional(),
  at: iso,
});

export const statusReportBody = z.union([
  statusReport,
  z.object({ reports: z.array(statusReport).min(1).max(50) }),
]);

export const deviceEvent = z.object({
  kind: z.enum([
    "permission_missing",
    "service_restarted",
    "battery_optimization_on",
    "sms_limit_prompt_shown",
    "app_updated",
  ]),
  detail: z.record(z.string(), z.unknown()).optional(),
  at: iso.optional(),
});

export const deviceEventsBody = z.object({
  events: z.array(deviceEvent).min(1).max(20),
});

export const inboxMessage = z.object({
  providerId: z.string().min(1).max(80),
  subscriptionId: z.number().int(),
  address: z.string().min(1).max(32),
  body: z.string().max(2000),
  direction: z.literal("in"),
  receivedAt: iso,
});

export const inboxBody = z.object({
  messages: z.array(inboxMessage).max(50),
});

export const pairingRequest = z.object({
  name: z.string().min(1).max(80).optional(),
});

export const devicePatch = z.object({
  name: z.string().min(1).max(80).optional(),
  paused: z.boolean().optional(),
  smsRateLimitNote: z.string().max(500).nullable().optional(),
});

export const retireRequest = z.object({
  confirm: z.literal("RETIRE"),
});

export const simPatch = z.object({
  phoneNumber: z.string().min(1).max(32).optional(),
  rateLimitPolicyId: z.string().uuid().nullable().optional(),
});

export const pauseRequest = z.object({
  reason: z.string().min(1).max(200),
});

export const retestRequest = z.object({
  testNumber: z.string().min(1).max(32),
});

export type RegisterBody = z.infer<typeof registerBody>;
export type HeartbeatBody = z.infer<typeof heartbeatBody>;
export type SimReportBody = z.infer<typeof simReportBody>;
export type ReportedSimInput = z.infer<typeof reportedSim>;
export type StatusReport = z.infer<typeof statusReport>;
export type InboxMessage = z.infer<typeof inboxMessage>;
