import { z } from "zod";

const phone = z.string().trim().min(1).max(32);
const body = z.string().min(1).max(2000);
const variables = z.record(z.string().max(40), z.string().max(200)).optional();

export const sendBody = z.object({
  to: phone,
  body,
  templateId: z.string().uuid().optional(),
  variables,
  scheduledFor: z.string().datetime().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const previewBody = z.object({
  to: phone.optional(),
  body,
  templateId: z.string().uuid().optional(),
  variables,
});

export const groupSendBody = z.object({
  name: z.string().trim().max(80).optional(),
  recipients: z.array(phone).max(500).optional(),
  groupId: z.string().uuid().optional(),
  body,
  templateId: z.string().uuid().optional(),
  variables,
  scheduledFor: z.string().datetime().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const conversationPatch = z.object({
  archived: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const consent = z.enum([
  "existing_customer",
  "verbal",
  "written",
  "web_form",
  "imported_with_consent",
  "other",
]);

export const contactBody = z.object({
  name: z.string().trim().min(1).max(80),
  number: phone,
  consentSource: consent,
  consentNote: z.string().trim().max(200).optional(),
  consentAt: z.string().datetime().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const contactGroupBody = z.object({
  name: z.string().trim().min(1).max(80),
  contactIds: z.array(z.string().uuid()).max(500).optional(),
});

export const templateBody = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().min(1).max(2000),
  kind: z.enum(["template", "quick_reply"]),
});

export const policyBody = z.object({
  name: z.string().trim().min(1).max(80),
  gapBaseSeconds: z.number().int().min(5).max(3600),
  gapJitterSeconds: z.number().int().min(0).max(600),
  perMinute: z.number().int().min(1).max(100),
  perHour: z.number().int().min(1).max(1000),
  perDay: z.number().int().min(1).max(10000),
  segmentsPerDay: z.number().int().min(1).max(20000),
  maxGroupRecipients: z.number().int().min(1).max(500),
  windowStart: z.string().regex(/^\d{2}:\d{2}:\d{2}$/u),
  windowEnd: z.string().regex(/^\d{2}:\d{2}:\d{2}$/u),
  windowDays: z.array(z.number().int().min(1).max(7)).min(1),
  windowTimezoneMode: z.enum(["user", "fixed"]),
  windowTimezone: z.string().min(1).max(80).nullable().optional(),
  overLimitAction: z.enum(["hold", "reject"]),
});

export type SendBody = z.infer<typeof sendBody>;
export type GroupSendBody = z.infer<typeof groupSendBody>;
export type ContactBody = z.infer<typeof contactBody>;
export type TemplateBody = z.infer<typeof templateBody>;
export type PolicyBody = z.infer<typeof policyBody>;
