import {
  AppError,
  SAFE_TEXT,
  applySignature,
  asLang,
  buildProvider,
  countSegments,
  detectLanguage,
  isTooLong,
  loadEnv,
  settingSchemas,
  translateReliably,
  translationApplies,
  type FetchLike,
  type Lang,
  type TranslationProvider,
} from "@gchopro/core";
import { and, eq, gte, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { noteTranslationResult } from "./alerts-service.js";
import { getDb } from "./client.js";
import { openSeal, seal } from "./device-shared.js";
import { assertSudo, requireReady } from "./login.js";
import { publishUser } from "./redis.js";
import { messageTranslations, messages, settings, users } from "./schema.js";

type Role = "outbound_original" | "inbound_display";

export type ThreadTranslation = {
  original: string | null;
  translated: string | null;
  unavailable: boolean;
};

async function translationSetting() {
  const rows = await getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, "translation"))
    .limit(1);
  const parsed = settingSchemas.translation.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : null;
}

async function signatureSetting() {
  const rows = await getDb()
    .select()
    .from(settings)
    .where(eq(settings.key, "sender_signature"))
    .limit(1);
  const parsed = settingSchemas.sender_signature.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : { enabled: false, text: "" };
}

export async function providerFor(fetchImpl?: FetchLike): Promise<TranslationProvider | null> {
  const setting = await translationSetting();
  if (setting === null || setting.provider === "none") return null;
  const env = loadEnv();
  return buildProvider({
    provider: setting.provider,
    deeplPlan: setting.deepl.plan,
    deeplKey: env.DEEPL_API_KEY,
    deeplUrl: env.DEEPL_API_URL,
    googleProject: env.GOOGLE_CLOUD_PROJECT,
    googleCredentials: env.GOOGLE_TRANSLATE_CREDENTIALS_JSON,
    libreUrl: setting.libretranslate.url ?? env.LIBRETRANSLATE_URL ?? null,
    libreKey: env.LIBRETRANSLATE_API_KEY,
    fetchImpl,
  });
}

export async function translationPending(user: {
  translationEnabled: boolean;
  userLanguage: string;
  recipientLanguage: string;
}): Promise<boolean> {
  const setting = await translationSetting();
  if (setting === null) return false;
  return translationApplies({
    provider: setting.provider,
    enabled: user.translationEnabled,
    userLanguage: user.userLanguage,
    recipientLanguage: user.recipientLanguage,
  });
}

export async function outboundReady(messageId: string): Promise<boolean> {
  const rows = await getDb()
    .select({
      translated: messageTranslations.translatedTextEnc,
      error: messageTranslations.error,
    })
    .from(messageTranslations)
    .where(
      and(
        eq(messageTranslations.messageId, messageId),
        eq(messageTranslations.role, "outbound_original"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row !== undefined && row.translated !== null && row.error === null;
}

async function saveRow(input: {
  id: string;
  messageId: string;
  role: Role;
  sourceLang: Lang;
  targetLang: Lang;
  source: string;
  translated: string | null;
  provider: "deepl" | "google" | "libretranslate" | "none";
  model?: string;
  characters: number;
  latencyMs: number | null;
  error: string | null;
}): Promise<void> {
  const values = {
    id: input.id,
    messageId: input.messageId,
    role: input.role,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    sourceTextEnc: seal(`message_translations.source_text_enc.${input.id}`, input.source),
    translatedTextEnc:
      input.translated === null
        ? null
        : seal(`message_translations.translated_text_enc.${input.id}`, input.translated),
    provider: input.provider,
    providerModel: input.model ?? null,
    characters: input.characters,
    latencyMs: input.latencyMs,
    error: input.error,
  };
  await getDb()
    .insert(messageTranslations)
    .values(values)
    .onConflictDoUpdate({
      target: [messageTranslations.messageId, messageTranslations.role],
      set: {
        sourceLang: values.sourceLang,
        targetLang: values.targetLang,
        sourceTextEnc: values.sourceTextEnc,
        translatedTextEnc: values.translatedTextEnc,
        provider: values.provider,
        providerModel: values.providerModel,
        characters: values.characters,
        latencyMs: values.latencyMs,
        error: values.error,
      },
    });
}

export async function translateQueued(
  messageId: string,
  role: Role,
  options?: { provider?: TranslationProvider; delays?: number[] },
): Promise<"done" | "skipped" | "failed"> {
  const db = getDb();
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const message = rows[0];
  if (message === undefined || message.isRetest || message.isOptOutConfirmation) return "skipped";
  const owners = await db.select().from(users).where(eq(users.id, message.userId)).limit(1);
  const user = owners[0];
  const setting = await translationSetting();
  if (
    user === undefined ||
    setting === null ||
    !translationApplies({
      provider: setting.provider,
      enabled: user.translationEnabled,
      userLanguage: user.userLanguage,
      recipientLanguage: user.recipientLanguage,
    })
  ) {
    return "skipped";
  }
  const existing = await db
    .select()
    .from(messageTranslations)
    .where(and(eq(messageTranslations.messageId, messageId), eq(messageTranslations.role, role)))
    .limit(1);
  const prior = existing[0];
  if (
    prior !== undefined &&
    (prior.translatedTextEnc !== null || prior.error !== null || prior.provider === "none")
  ) {
    return prior.translatedTextEnc !== null && prior.error === null ? "done" : "skipped";
  }
  const source = openSeal(`messages.wire_body_enc.${message.id}`, message.wireBodyEnc) ?? "";
  if (source.length === 0) return "skipped";
  const userLang = asLang(user.userLanguage);
  const recipientLang = asLang(user.recipientLanguage);
  if (role === "inbound_display" && detectLanguage(source) === userLang) {
    await saveRow({
      id: prior?.id ?? uuidv7(),
      messageId,
      role,
      sourceLang: userLang,
      targetLang: userLang,
      source,
      translated: null,
      provider: "none",
      characters: 0,
      latencyMs: null,
      error: null,
    });
    return "skipped";
  }
  const provider = options?.provider ?? (await providerFor());
  if (provider === null || (options?.provider === undefined && provider.id !== setting.provider)) {
    await saveRow({
      id: prior?.id ?? uuidv7(),
      messageId,
      role,
      sourceLang: role === "outbound_original" ? userLang : detectLanguage(source),
      targetLang: role === "outbound_original" ? recipientLang : userLang,
      source,
      translated: null,
      provider: setting.provider,
      characters: 0,
      latencyMs: null,
      error: "provider_unavailable",
    });
    await noteTranslationResult(false);
    return "failed";
  }
  const started = Date.now();
  try {
    const result = await translateReliably(
      provider,
      {
        text: source,
        source: role === "outbound_original" ? userLang : "auto",
        target: role === "outbound_original" ? recipientLang : userLang,
      },
      options?.delays,
    );
    if (
      role === "inbound_display" &&
      (result.detectedSource ?? detectLanguage(source)) === userLang
    ) {
      await saveRow({
        id: prior?.id ?? uuidv7(),
        messageId,
        role,
        sourceLang: userLang,
        targetLang: userLang,
        source,
        translated: null,
        provider: "none",
        characters: 0,
        latencyMs: Date.now() - started,
        error: null,
      });
      return "skipped";
    }
    if (role === "inbound_display") {
      await saveRow({
        id: prior?.id ?? uuidv7(),
        messageId,
        role,
        sourceLang: result.detectedSource ?? detectLanguage(source),
        targetLang: userLang,
        source,
        translated: result.text,
        provider: provider.id,
        model: result.model,
        characters: result.characters,
        latencyMs: Date.now() - started,
        error: null,
      });
      await noteTranslationResult(true);
      return "done";
    }
    const signed = applySignature(result.text, await signatureSetting());
    const counted = countSegments(signed);
    if (isTooLong(counted)) {
      await db
        .update(messages)
        .set({
          status: "failed",
          failedAt: new Date(),
          failureName: "TRANSLATION_TOO_LONG",
          failureClass: "permanent",
          holdReason: null,
        })
        .where(eq(messages.id, message.id));
      await saveRow({
        id: prior?.id ?? uuidv7(),
        messageId,
        role,
        sourceLang: userLang,
        targetLang: recipientLang,
        source,
        translated: null,
        provider: provider.id,
        characters: result.characters,
        latencyMs: Date.now() - started,
        error: "too_long",
      });
      return "failed";
    }
    await db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({
          wireBodyEnc: seal(`messages.wire_body_enc.${message.id}`, signed),
          encoding: counted.encoding,
          segments: counted.segments,
        })
        .where(eq(messages.id, message.id));
    });
    await saveRow({
      id: prior?.id ?? uuidv7(),
      messageId,
      role,
      sourceLang: userLang,
      targetLang: recipientLang,
      source,
      translated: result.text,
      provider: provider.id,
      model: result.model,
      characters: result.characters,
      latencyMs: Date.now() - started,
      error: null,
    });
    await noteTranslationResult(true);
    return "done";
  } catch {
    await saveRow({
      id: prior?.id ?? uuidv7(),
      messageId,
      role,
      sourceLang: role === "outbound_original" ? userLang : detectLanguage(source),
      targetLang: role === "outbound_original" ? recipientLang : userLang,
      source,
      translated: null,
      provider: provider.id,
      characters: 0,
      latencyMs: Date.now() - started,
      error: "provider_failed",
    });
    await noteTranslationResult(false);
    return "failed";
  }
}

export async function claimTranslationJobs(
  limit = 20,
): Promise<{ messageId: string; role: Role }[]> {
  const setting = await translationSetting();
  if (setting === null || setting.provider === "none") return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await getDb()
    .select({
      id: messages.id,
      userId: messages.userId,
      direction: messages.direction,
      status: messages.status,
      isRetest: messages.isRetest,
      isOptOutConfirmation: messages.isOptOutConfirmation,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.status, ["queued", "held", "scheduled", "received"]),
        gte(messages.createdAt, since),
      ),
    )
    .limit(100);
  if (candidates.length === 0) return [];
  const ids = candidates.map((row) => row.id);
  const existing = await getDb()
    .select({ messageId: messageTranslations.messageId })
    .from(messageTranslations)
    .where(inArray(messageTranslations.messageId, ids));
  const seen = new Set(existing.map((row) => row.messageId));
  const userIds = [...new Set(candidates.map((row) => row.userId))];
  const owners = await getDb().select().from(users).where(inArray(users.id, userIds));
  const byUser = new Map(owners.map((row) => [row.id, row]));
  const jobs: { messageId: string; role: Role }[] = [];
  for (const message of candidates) {
    if (seen.has(message.id) || message.isRetest || message.isOptOutConfirmation) continue;
    const user = byUser.get(message.userId);
    if (
      user === undefined ||
      !translationApplies({
        provider: setting.provider,
        enabled: user.translationEnabled,
        userLanguage: user.userLanguage,
        recipientLanguage: user.recipientLanguage,
      })
    ) {
      continue;
    }
    if (message.direction === "out" && message.status !== "received") {
      jobs.push({ messageId: message.id, role: "outbound_original" });
    } else if (message.direction === "in" && message.status === "received") {
      jobs.push({ messageId: message.id, role: "inbound_display" });
    }
    if (jobs.length >= limit) break;
  }
  return jobs;
}

export async function previewTranslation(
  user: { translationEnabled: boolean; userLanguage: string; recipientLanguage: string },
  source: string,
): Promise<{ text: string; translated: boolean } | null> {
  const setting = await translationSetting();
  if (setting === null || !setting.preview_before_send) return null;
  if (
    !translationApplies({
      provider: setting.provider,
      enabled: user.translationEnabled,
      userLanguage: user.userLanguage,
      recipientLanguage: user.recipientLanguage,
    })
  ) {
    return null;
  }
  const provider = await providerFor();
  if (provider === null)
    throw new AppError(503, "translation_unavailable", SAFE_TEXT.translation_unavailable);
  try {
    const result = await provider.translate({
      text: source,
      source: asLang(user.userLanguage),
      target: asLang(user.recipientLanguage),
    });
    const signed = applySignature(result.text, await signatureSetting());
    return { text: signed, translated: true };
  } catch {
    throw new AppError(503, "translation_unavailable", SAFE_TEXT.translation_unavailable);
  }
}

export async function sendUntranslated(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  const db = getDb();
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  const message = rows[0];
  if (message === undefined || message.userId !== session.userId) {
    throw new AppError(404, "not_found", SAFE_TEXT.not_found);
  }
  if (
    message.failureName !== "TRANSLATION_TIMEOUT" &&
    message.failureName !== "TRANSLATION_TOO_LONG"
  ) {
    throw new AppError(409, "conflict", SAFE_TEXT.conflict);
  }
  const source = openSeal(`messages.wire_body_enc.${message.id}`, message.wireBodyEnc) ?? "";
  const signed = applySignature(source, await signatureSetting());
  const counted = countSegments(signed);
  if (isTooLong(counted)) throw new AppError(422, "too_long", SAFE_TEXT.too_long);
  const owners = await db.select().from(users).where(eq(users.id, message.userId)).limit(1);
  const user = owners[0];
  const existing = await db
    .select({ id: messageTranslations.id })
    .from(messageTranslations)
    .where(
      and(eq(messageTranslations.messageId, id), eq(messageTranslations.role, "outbound_original")),
    )
    .limit(1);
  await db
    .update(messages)
    .set({
      wireBodyEnc: seal(`messages.wire_body_enc.${message.id}`, signed),
      encoding: counted.encoding,
      segments: counted.segments,
      status: "queued",
      holdReason: null,
      failureName: null,
      failureClass: null,
      failedAt: null,
      queuedAt: new Date(),
    })
    .where(eq(messages.id, message.id));
  await saveRow({
    id: existing[0]?.id ?? uuidv7(),
    messageId: id,
    role: "outbound_original",
    sourceLang: asLang(user?.userLanguage),
    targetLang: asLang(user?.recipientLanguage),
    source,
    translated: source,
    provider: "none",
    characters: [...source].length,
    latencyMs: null,
    error: null,
  });
  await publishUser(message.userId, {
    type: "message.status",
    messageId: message.id,
    status: "queued",
  });
  return { id: message.id, status: "queued" };
}

export async function testTranslationProvider(token: string | undefined): Promise<{ ok: boolean }> {
  const session = await requireReady(token, "admin");
  if (session.sessionId === undefined) {
    throw new AppError(403, "sudo_required", SAFE_TEXT.sudo_required);
  }
  await assertSudo(session.sessionId);
  const provider = await providerFor();
  if (provider === null) return { ok: false };
  try {
    return { ok: await provider.health() };
  } catch {
    return { ok: false };
  }
}

export async function threadTranslations(ids: string[]): Promise<Map<string, ThreadTranslation>> {
  const result = new Map<string, ThreadTranslation>();
  if (ids.length === 0) return result;
  const rows = await getDb()
    .select()
    .from(messageTranslations)
    .where(inArray(messageTranslations.messageId, ids));
  for (const row of rows) {
    const original = openSeal(`message_translations.source_text_enc.${row.id}`, row.sourceTextEnc);
    const translated =
      row.translatedTextEnc === null
        ? null
        : openSeal(`message_translations.translated_text_enc.${row.id}`, row.translatedTextEnc);
    result.set(row.messageId, {
      original,
      translated,
      unavailable: row.error !== null && translated === null,
    });
  }
  return result;
}
