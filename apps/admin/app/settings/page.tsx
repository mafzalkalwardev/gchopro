import { COOKIE, POLICY_TEXT, loadEnv, settingSchemas } from "@gchopro/core";
import { screenText } from "@/lib/copy";
import { listSettings } from "@gchopro/db";
import { cookies } from "next/headers";
import { BenchNav, requireDesk } from "@/lib/desk";
import { LanguageSwitch, ThemeSwitch } from "../preferences";
import { SettingsForms } from "./settings-form";

export const dynamic = "force-dynamic";

function asMap(value: unknown): Map<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return new Map(Object.entries(value));
}

function stringList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string").join("\n");
}

export default async function SettingsPage() {
  const session = await requireDesk();
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const values = new Map(Object.entries(await listSettings(token)));
  const health = settingSchemas.health.parse(
    values.get("health") ?? {
      consecutive_failure_threshold: 3,
      suspension_signal_threshold: 2,
      offline_after_seconds: 90,
      battery_low_percent: 20,
    },
  );
  const confirmation = settingSchemas.opt_out_confirmation.parse(
    values.get("opt_out_confirmation") ?? {
      enabled: true,
      text_en: "You have been unsubscribed and will not receive further messages.",
      text_zh: "您已退订，将不会再收到消息。",
    },
  );
  const signature = settingSchemas.sender_signature.parse(
    values.get("sender_signature") ?? { enabled: false, text: "" },
  );
  const content = settingSchemas.content_rules.parse(
    values.get("content_rules") ?? { blocked_keywords: [], block_urls: false },
  );
  const alertRecord = asMap(values.get("alerts"));
  const email = asMap(alertRecord?.get("email"));
  const telegram = asMap(alertRecord?.get("telegram"));
  const chatId = telegram?.get("chat_id");
  const keywords = settingSchemas.opt_out_keywords.safeParse(values.get("opt_out_keywords"));
  const optIn = settingSchemas.opt_in_keywords.safeParse(values.get("opt_in_keywords"));
  const tests = settingSchemas.test_numbers.safeParse(values.get("test_numbers"));
  const translation = settingSchemas.translation.parse(
    values.get("translation") ?? {
      provider: "none",
      deepl: { plan: "free" },
      google: {},
      libretranslate: { url: null },
      preview_before_send: true,
    },
  );
  const env = loadEnv();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">{await screenText("settings")}</h1>
        <LanguageSwitch action="/api/admin/locale" next="/settings" />
        <ThemeSwitch action="/api/admin/theme" next="/settings" />
        <p className="mt-4 max-w-xl font-body">{POLICY_TEXT}</p>
        <SettingsForms
          health={health}
          optOutKeywords={keywords.success ? keywords.data.join("\n") : ""}
          optInKeywords={optIn.success ? optIn.data.join("\n") : ""}
          confirmation={confirmation}
          signature={signature}
          content={{
            blocked_keywords: content.blocked_keywords.join("\n"),
            block_urls: content.block_urls,
          }}
          testNumbers={tests.success ? tests.data.join("\n") : ""}
          alerts={{
            emailEnabled: email?.get("enabled") === true,
            emailTo: stringList(email?.get("to")),
            telegramEnabled: telegram?.get("enabled") === true,
            chatId: typeof chatId === "string" ? chatId : "",
          }}
          translation={{
            provider: translation.provider,
            preview: translation.preview_before_send,
            deeplPlan: translation.deepl.plan ?? "free",
            libreUrl: translation.libretranslate.url ?? "",
            deeplConfigured: env.DEEPL_API_KEY !== undefined,
            googleConfigured:
              env.GOOGLE_CLOUD_PROJECT !== undefined &&
              env.GOOGLE_TRANSLATE_CREDENTIALS_JSON !== undefined,
            libreConfigured:
              (translation.libretranslate.url !== null &&
                translation.libretranslate.url.length > 0) ||
              env.LIBRETRANSLATE_URL !== undefined,
          }}
        />
      </section>
    </main>
  );
}
