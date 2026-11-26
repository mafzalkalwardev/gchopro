import { decryptField, loadEnv } from "@gchopro/core";
import { eq } from "drizzle-orm";
import { getDb } from "./client.js";
import { requireReady } from "./login.js";
import { rateLimitPolicies, sims, subscriptions, users } from "./schema.js";

export async function portalProfile(token: string | undefined) {
  const session = await requireReady(token, "portal");
  const db = getDb();
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (user === undefined) throw new Error("user missing");
  const simRows =
    user.simId === null ? [] : await db.select().from(sims).where(eq(sims.id, user.simId)).limit(1);
  const sim = simRows[0] ?? null;
  const subscriptionRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id));
  const subscription =
    subscriptionRows.find((row) => row.status === "active" || row.status === "scheduled") ??
    subscriptionRows[0] ??
    null;
  const policyId = user.rateLimitPolicyId;
  const policyRows =
    policyId === null
      ? await db
          .select()
          .from(rateLimitPolicies)
          .where(eq(rateLimitPolicies.isDefault, true))
          .limit(1)
      : await db
          .select()
          .from(rateLimitPolicies)
          .where(eq(rateLimitPolicies.id, policyId))
          .limit(1);
  const policy = policyRows[0] ?? null;
  const env = loadEnv();
  let phoneNumber: string | null = null;
  if (sim?.phoneNumberEnc) {
    try {
      phoneNumber = decryptField(
        env.FIELD_ENCRYPTION_KEYS,
        `sims.phone_number_enc.${sim.id}`,
        sim.phoneNumberEnc,
      );
    } catch {
      phoneNumber = null;
    }
  }
  const endsAt = subscription?.endsAt ?? null;
  const daysLeft =
    endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    line: {
      phoneNumber,
      health: sim?.health ?? null,
      available: sim !== null && sim.health === "active" && sim.activeOnDevice,
    },
    subscription:
      subscription === null
        ? null
        : { status: subscription.status, endsAt: subscription.endsAt.toISOString(), daysLeft },
    languages: {
      user: user.userLanguage,
      recipient: user.recipientLanguage,
      translationEnabled: user.translationEnabled,
    },
    limits:
      policy === null
        ? null
        : {
            gapBaseSeconds: policy.gapBaseSeconds,
            gapJitterSeconds: policy.gapJitterSeconds,
            perMinute: policy.perMinute,
            perHour: policy.perHour,
            perDay: policy.perDay,
            segmentsPerDay: policy.segmentsPerDay,
            maxGroupRecipients: policy.maxGroupRecipients,
          },
    usage: { minute: 0, hour: 0, day: 0, segmentsDay: 0 },
  };
}
