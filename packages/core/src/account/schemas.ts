import { z } from "zod";
import { ipInCidr } from "../auth/allowlist.js";
import { timezoneValid } from "../subscription/period.js";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/u);
const language = z.enum(["zh", "en"]);
const planUnit = z.enum(["day", "week", "month", "year"]);

function cidrShape(value: string): boolean {
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return false;
  return ipInCidr(value.slice(0, slash), value);
}

const cidrList = z.array(z.string().refine(cidrShape)).max(20);

export const subscriptionInput = z.object({
  planUnit,
  planQuantity: z.number().int().min(1).max(36),
  startsAt: z.string().datetime().optional(),
  expiryBehavior: z.enum(["block", "read_only"]).optional(),
});

export const userCreate = z.object({
  username,
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128).optional(),
  simId: z.string().uuid().nullable().optional(),
  policyId: z.string().uuid().nullable().optional(),
  userLanguage: language,
  recipientLanguage: language,
  translationEnabled: z.boolean(),
  timezone: z.string().refine(timezoneValid),
  allowExport: z.boolean(),
  allowSelfPasswordChange: z.boolean(),
  ipAllowlist: cidrList.nullable().optional(),
  subscription: subscriptionInput.optional(),
});

export const userPatch = z
  .object({
    username,
    displayName: z.string().trim().min(1).max(80),
    policyId: z.string().uuid().nullable(),
    userLanguage: language,
    recipientLanguage: language,
    translationEnabled: z.boolean(),
    timezone: z.string().refine(timezoneValid),
    allowExport: z.boolean(),
    allowSelfPasswordChange: z.boolean(),
    ipAllowlist: cidrList.nullable(),
  })
  .partial();

export const passwordReset = z.object({
  newPassword: z.string().min(12).max(128).optional(),
});

export const disableUser = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const assignSim = z.object({
  simId: z.string().uuid().nullable(),
});

export const extendSubscriptionBody = z.union([
  z.object({
    planUnit,
    planQuantity: z.number().int().min(1).max(36),
  }),
  z.object({
    endsAt: z.string().datetime(),
  }),
]);

export const disableSubscription = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const paymentCreate = z.object({
  userId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullable().optional(),
  amountMinor: z.number().int().min(0),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/u),
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(80).nullable().optional(),
  paidAt: z.string().datetime(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const voidPayment = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const noticeCreate = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  audience: z.enum(["all", "selected"]),
  userIds: z.array(z.string().uuid()).max(200).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type UserCreate = z.infer<typeof userCreate>;
export type UserPatch = z.infer<typeof userPatch>;
export type SubscriptionInput = z.infer<typeof subscriptionInput>;
export type ExtendSubscriptionBody = z.infer<typeof extendSubscriptionBody>;
export type PaymentCreate = z.infer<typeof paymentCreate>;
export type NoticeCreate = z.infer<typeof noticeCreate>;
