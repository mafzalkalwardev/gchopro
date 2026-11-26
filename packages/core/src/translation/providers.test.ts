import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TranslationFailure,
  buildProvider,
  createDeepLProvider,
  createGoogleProvider,
  createLibreProvider,
  translateReliably,
  type FetchLike,
} from "./providers.js";
import type { TranslationProvider } from "./types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("translation providers", () => {
  it("calls DeepL with the auth header and the language codes", async () => {
    const calls: { url: string; authorization: string; body: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        body: String(init?.body ?? ""),
      });
      return jsonResponse({
        translations: [{ text: "Hello", detected_source_language: "ZH" }],
      });
    };
    const provider = createDeepLProvider({
      apiKey: "test-key",
      baseUrl: "https://api-free.deepl.com",
      fetchImpl,
    });
    const result = await provider.translate({ text: "你好", source: "zh", target: "en" });
    expect(result.text).toBe("Hello");
    expect(result.detectedSource).toBe("zh");
    expect(calls[0]?.url).toBe("https://api-free.deepl.com/v2/translate");
    expect(calls[0]?.authorization).toBe("DeepL-Auth-Key test-key");
    expect(calls[0]?.body).toContain('"target_lang":"EN-US"');
    expect(calls[0]?.body).toContain('"source_lang":"ZH"');
  });

  it("does not put the source text in a provider error", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ message: "secret source 你好 was rejected" }, 403);
    const provider = createLibreProvider({
      baseUrl: "http://libre.invalid",
      fetchImpl,
    });
    await expect(provider.translate({ text: "你好", source: "zh", target: "en" })).rejects.toThrow(
      "translation_failed",
    );
  });

  it("posts LibreTranslate text without logging it on failure", async () => {
    let body = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      body = String(init?.body ?? "");
      return jsonResponse({ translatedText: "Hello" });
    };
    const provider = createLibreProvider({
      baseUrl: "http://libre.invalid/",
      apiKey: "libre-key",
      fetchImpl,
    });
    const result = await provider.translate({ text: "你好", source: "zh", target: "en" });
    expect(result.text).toBe("Hello");
    expect(body).toContain('"q":"你好"');
    expect(body).toContain("libre-key");
  });

  it("calls Google translateText with a bearer token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const credentials = Buffer.from(
      JSON.stringify({
        client_email: "translate@example.iam.gserviceaccount.com",
        private_key: pem,
        token_uri: "https://oauth.example/token",
      }),
    ).toString("base64");
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      urls.push(url);
      if (url.includes("oauth.example")) return jsonResponse({ access_token: "token-1" });
      expect(String(init?.body)).toContain("zh-CN");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-1");
      return jsonResponse({
        translations: [{ translatedText: "你好", detectedLanguageCode: "en" }],
      });
    };
    const provider = createGoogleProvider({
      projectId: "gcho-project",
      credentialsJson: credentials,
      fetchImpl,
    });
    const result = await provider.translate({ text: "Hello", source: "en", target: "zh" });
    expect(result.text).toBe("你好");
    expect(urls.some((url) => url.includes("projects/gcho-project/"))).toBe(true);
  });

  it("tries the provider three times", async () => {
    let calls = 0;
    const provider: TranslationProvider = {
      id: "libretranslate",
      async translate() {
        calls += 1;
        if (calls < 3) throw new TranslationFailure();
        return { text: "Hello", characters: 2 };
      },
      async health() {
        return true;
      },
    };
    const result = await translateReliably(
      provider,
      { text: "你好", source: "zh", target: "en" },
      [0, 0, 0],
    );
    expect(result.text).toBe("Hello");
    expect(calls).toBe(3);
  });

  it("selects the configured adapter and refuses a missing key", () => {
    expect(buildProvider({ provider: "deepl", deeplPlan: "free", deeplKey: "key" })?.id).toBe(
      "deepl",
    );
    expect(buildProvider({ provider: "deepl", deeplPlan: "pro" })).toBeNull();
    expect(buildProvider({ provider: "none" })).toBeNull();
    expect(
      buildProvider({ provider: "libretranslate", libreUrl: "http://libre.invalid" })?.id,
    ).toBe("libretranslate");
  });
});
