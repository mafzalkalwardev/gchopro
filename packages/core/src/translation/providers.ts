import { createSign } from "node:crypto";
import { characterCount, detectLanguage } from "./detect.js";
import type { Lang, TranslationProvider, TranslationRequest, TranslationResult } from "./types.js";

export class TranslationFailure extends Error {
  constructor() {
    super("translation_failed");
    this.name = "TranslationFailure";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 8_000;

export async function translateReliably(
  provider: TranslationProvider,
  input: TranslationRequest,
  delays: readonly number[] = [0, 1_000, 2_000],
): Promise<TranslationResult> {
  let last: unknown;
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await provider.translate(input);
    } catch (error) {
      last = error;
    }
  }
  if (last instanceof Error) throw last;
  throw new TranslationFailure();
}

function deeplCode(lang: Lang, target: boolean): string {
  if (lang === "zh") return target ? "ZH-HANS" : "ZH";
  return target ? "EN-US" : "EN";
}

function fromDeepl(value: string | undefined): Lang | undefined {
  if (value === undefined) return undefined;
  const upper = value.toUpperCase();
  if (upper.startsWith("ZH")) return "zh";
  if (upper.startsWith("EN")) return "en";
  return undefined;
}

function googleCode(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}

async function readOk(response: Response): Promise<unknown> {
  if (!response.ok) throw new TranslationFailure();
  return response.json() as Promise<unknown>;
}

function asMap(value: unknown): Map<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return new Map(Object.entries(value));
}

export function createDeepLProvider(input: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): TranslationProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const origin = input.baseUrl.replace(/\/$/u, "");
  return {
    id: "deepl",
    async translate(request) {
      const body: Record<string, unknown> = {
        text: [request.text],
        target_lang: deeplCode(request.target, true),
      };
      if (request.source !== "auto") body.source_lang = deeplCode(request.source, false);
      const payload = asMap(
        await readOk(
          await fetchImpl(`${origin}/v2/translate`, {
            method: "POST",
            headers: {
              authorization: `DeepL-Auth-Key ${input.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
        ),
      );
      const translations = payload?.get("translations");
      const first = Array.isArray(translations) ? asMap(translations[0]) : null;
      const text = first?.get("text");
      if (typeof text !== "string" || text.length === 0) throw new TranslationFailure();
      const detected = first?.get("detected_source_language");
      return {
        text,
        detectedSource:
          typeof detected === "string" ? fromDeepl(detected) : detectLanguage(request.text),
        characters: characterCount(request.text),
      };
    },
    async health() {
      const response = await fetchImpl(`${origin}/v2/usage`, {
        headers: { authorization: `DeepL-Auth-Key ${input.apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok;
    },
  };
}

function serviceAccount(encoded: string): { email: string; key: string; tokenUrl: string } | null {
  try {
    const parsed = asMap(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
    const email = parsed?.get("client_email");
    const key = parsed?.get("private_key");
    const token = parsed?.get("token_uri");
    if (typeof email !== "string" || typeof key !== "string") return null;
    return {
      email,
      key,
      tokenUrl: typeof token === "string" ? token : "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

function googleJwt(account: { email: string; key: string; tokenUrl: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(
    JSON.stringify({
      iss: account.email,
      scope: "https://www.googleapis.com/auth/cloud-translation",
      aud: account.tokenUrl,
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(account.key)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

export function createGoogleProvider(input: {
  projectId: string;
  credentialsJson: string;
  fetchImpl?: FetchLike;
}): TranslationProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const account = serviceAccount(input.credentialsJson);
  return {
    id: "google",
    async translate(request) {
      if (account === null) throw new TranslationFailure();
      const tokenPayload = asMap(
        await readOk(
          await fetchImpl(account.tokenUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
              assertion: googleJwt(account),
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
        ),
      );
      const access = tokenPayload?.get("access_token");
      if (typeof access !== "string") throw new TranslationFailure();
      const body: Record<string, unknown> = {
        contents: [request.text],
        targetLanguageCode: googleCode(request.target),
        mimeType: "text/plain",
      };
      if (request.source !== "auto") body.sourceLanguageCode = googleCode(request.source);
      const translated = asMap(
        await readOk(
          await fetchImpl(
            `https://translation.googleapis.com/v3/projects/${encodeURIComponent(input.projectId)}/locations/global:translateText`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${access}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            },
          ),
        ),
      );
      const translations = translated?.get("translations");
      const first = Array.isArray(translations) ? asMap(translations[0]) : null;
      const text = first?.get("translatedText");
      if (typeof text !== "string" || text.length === 0) throw new TranslationFailure();
      const detected = first?.get("detectedLanguageCode");
      return {
        text,
        detectedSource:
          typeof detected === "string" ? fromGoogle(detected) : detectLanguage(request.text),
        model: "translateText",
        characters: characterCount(request.text),
      };
    },
    async health() {
      if (account === null) return false;
      try {
        await this.translate({ text: "ok", source: "en", target: "zh" });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function fromGoogle(value: string): Lang | undefined {
  if (value.toLowerCase().startsWith("zh")) return "zh";
  if (value.toLowerCase().startsWith("en")) return "en";
  return undefined;
}

export function createLibreProvider(input: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}): TranslationProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const origin = input.baseUrl.replace(/\/$/u, "");
  return {
    id: "libretranslate",
    async translate(request) {
      const body: Record<string, unknown> = {
        q: request.text,
        source: request.source,
        target: request.target,
        format: "text",
      };
      if (input.apiKey !== undefined && input.apiKey.length > 0) body.api_key = input.apiKey;
      const payload = asMap(
        await readOk(
          await fetchImpl(`${origin}/translate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }),
        ),
      );
      const text = payload?.get("translatedText");
      if (typeof text !== "string" || text.length === 0) throw new TranslationFailure();
      const detected = asMap(payload?.get("detectedLanguage"))?.get("language");
      return {
        text,
        detectedSource:
          detected === "zh" || detected === "en" ? detected : detectLanguage(request.text),
        characters: characterCount(request.text),
      };
    },
    async health() {
      const response = await fetchImpl(`${origin}/languages`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok;
    },
  };
}

export function buildProvider(input: {
  provider: "none" | "deepl" | "google" | "libretranslate";
  deeplPlan?: "free" | "pro";
  deeplKey?: string;
  deeplUrl?: string;
  googleProject?: string;
  googleCredentials?: string;
  libreUrl?: string | null;
  libreKey?: string;
  fetchImpl?: FetchLike;
}): TranslationProvider | null {
  if (input.provider === "deepl") {
    if (input.deeplKey === undefined || input.deeplKey.length === 0) return null;
    const fallback =
      input.deeplPlan === "pro" ? "https://api.deepl.com" : "https://api-free.deepl.com";
    return createDeepLProvider({
      apiKey: input.deeplKey,
      baseUrl: input.deeplUrl && input.deeplUrl.length > 0 ? input.deeplUrl : fallback,
      fetchImpl: input.fetchImpl,
    });
  }
  if (input.provider === "google") {
    if (
      input.googleProject === undefined ||
      input.googleCredentials === undefined ||
      input.googleProject.length === 0 ||
      input.googleCredentials.length === 0
    ) {
      return null;
    }
    return createGoogleProvider({
      projectId: input.googleProject,
      credentialsJson: input.googleCredentials,
      fetchImpl: input.fetchImpl,
    });
  }
  if (input.provider === "libretranslate") {
    if (input.libreUrl === undefined || input.libreUrl === null || input.libreUrl.length === 0) {
      return null;
    }
    return createLibreProvider({
      baseUrl: input.libreUrl,
      apiKey: input.libreKey,
      fetchImpl: input.fetchImpl,
    });
  }
  return null;
}
