"use client";

import { FormEvent, useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

async function save(key: string, value: unknown): Promise<string> {
  const response = await fetch(`/api/admin/settings/${key}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrf() },
    body: JSON.stringify({ value }),
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  return response.ok ? "Saved." : (payload.message ?? "The setting was not saved.");
}

function lines(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function SettingsForms(props: {
  health: {
    consecutive_failure_threshold: number;
    suspension_signal_threshold: number;
    offline_after_seconds: number;
    battery_low_percent: number;
  };
  optOutKeywords: string;
  optInKeywords: string;
  confirmation: { enabled: boolean; text_en: string; text_zh: string };
  signature: { enabled: boolean; text: string };
  content: { blocked_keywords: string; block_urls: boolean };
  testNumbers: string;
  alerts: { emailEnabled: boolean; emailTo: string; telegramEnabled: boolean; chatId: string };
  translation: {
    provider: "none" | "deepl" | "google" | "libretranslate";
    preview: boolean;
    deeplPlan: "free" | "pro";
    libreUrl: string;
    deeplConfigured: boolean;
    googleConfigured: boolean;
    libreConfigured: boolean;
  };
}) {
  const [message, setMessage] = useState("");

  function onHealth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save("health", {
      consecutive_failure_threshold: Number(form.get("failures")),
      suspension_signal_threshold: Number(form.get("signals")),
      offline_after_seconds: Number(form.get("offline")),
      battery_low_percent: Number(form.get("battery")),
    }).then(setMessage);
  }

  return (
    <div className="mt-8 grid max-w-xl gap-10">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const libre = String(form.get("libreUrl") ?? "").trim();
          void (async () => {
            const sudo = await fetch("/api/admin/auth/sudo", {
              method: "POST",
              headers: { "content-type": "application/json", "x-csrf-token": csrf() },
              body: JSON.stringify({
                password: String(form.get("password") ?? ""),
                code: String(form.get("code") ?? ""),
              }),
            });
            if (!sudo.ok) {
              setMessage("Sudo was not granted.");
              return;
            }
            setMessage(
              await save("translation", {
                provider: String(form.get("provider") ?? "none"),
                deepl: { plan: String(form.get("deeplPlan") ?? "free") },
                google: {},
                libretranslate: { url: libre.length > 0 ? libre : null },
                preview_before_send: form.get("preview") === "on",
              }),
            );
          })();
        }}
      >
        <h2 className="font-display text-2xl">Translation</h2>
        <p className="font-body text-sm">
          Keys stay in the environment. DeepL {props.translation.deeplConfigured ? "is" : "is not"}{" "}
          configured. Google {props.translation.googleConfigured ? "is" : "is not"} configured.
          LibreTranslate {props.translation.libreConfigured ? "is" : "is not"} configured.
        </p>
        <label className="font-body text-sm">
          Provider
          <select
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="provider"
            defaultValue={props.translation.provider}
          >
            <option value="none">None</option>
            <option value="deepl">DeepL</option>
            <option value="google">Google</option>
            <option value="libretranslate">LibreTranslate</option>
          </select>
        </label>
        <label className="font-body text-sm">
          DeepL plan
          <select
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="deeplPlan"
            defaultValue={props.translation.deeplPlan}
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
        </label>
        <label className="font-body text-sm">
          LibreTranslate URL
          <input
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="libreUrl"
            defaultValue={props.translation.libreUrl}
          />
        </label>
        <label className="font-body text-sm">
          <input name="preview" type="checkbox" defaultChecked={props.translation.preview} />{" "}
          Preview before send
        </label>
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="password"
          type="password"
          placeholder="Your password"
          required
        />
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="code"
          placeholder="Authenticator code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
        />
        <div className="flex gap-3">
          <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
            Save translation
          </button>
          <button
            className="w-fit border border-ink px-4 py-2"
            type="button"
            onClick={(event) => {
              const formElement = event.currentTarget.form;
              if (formElement === null) return;
              const form = new FormData(formElement);
              void (async () => {
                const sudo = await fetch("/api/admin/auth/sudo", {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-csrf-token": csrf() },
                  body: JSON.stringify({
                    password: String(form.get("password") ?? ""),
                    code: String(form.get("code") ?? ""),
                  }),
                });
                if (!sudo.ok) {
                  setMessage("Sudo was not granted.");
                  return;
                }
                const response = await fetch("/api/admin/settings/translation/test", {
                  method: "POST",
                  headers: { "x-csrf-token": csrf() },
                });
                const payload = (await response.json().catch(() => ({}))) as {
                  data?: { ok?: boolean };
                };
                setMessage(
                  payload.data?.ok === true ? "Provider test passed." : "Provider test failed.",
                );
              })();
            }}
          >
            Test provider
          </button>
        </div>
      </form>
      <form className="grid gap-3" onSubmit={onHealth}>
        <h2 className="font-display text-2xl">Health</h2>
        <label className="font-body text-sm">
          Consecutive failures
          <input
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="failures"
            type="number"
            min={1}
            defaultValue={props.health.consecutive_failure_threshold}
          />
        </label>
        <label className="font-body text-sm">
          Suspension signals in 24 hours
          <input
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="signals"
            type="number"
            min={1}
            defaultValue={props.health.suspension_signal_threshold}
          />
        </label>
        <label className="font-body text-sm">
          Offline after seconds
          <input
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="offline"
            type="number"
            min={1}
            defaultValue={props.health.offline_after_seconds}
          />
        </label>
        <label className="font-body text-sm">
          Low battery percent
          <input
            className="mt-1 block w-full border border-ink/20 bg-paper px-3 py-2"
            name="battery"
            type="number"
            min={1}
            max={100}
            defaultValue={props.health.battery_low_percent}
          />
        </label>
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save health
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("opt_out_keywords", lines(String(form.get("keywords") ?? ""))).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Opt-out keywords</h2>
        <textarea
          className="min-h-24 border border-ink/20 bg-paper px-3 py-2"
          name="keywords"
          defaultValue={props.optOutKeywords}
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save keywords
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("opt_in_keywords", lines(String(form.get("keywords") ?? ""))).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Opt-in keywords</h2>
        <textarea
          className="min-h-20 border border-ink/20 bg-paper px-3 py-2"
          name="keywords"
          defaultValue={props.optInKeywords}
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save opt-in
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("opt_out_confirmation", {
            enabled: form.get("enabled") === "on",
            text_en: String(form.get("text_en") ?? ""),
            text_zh: String(form.get("text_zh") ?? ""),
          }).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Opt-out confirmation</h2>
        <label className="font-body text-sm">
          <input name="enabled" type="checkbox" defaultChecked={props.confirmation.enabled} /> Send
          one confirmation
        </label>
        <textarea
          className="min-h-20 border border-ink/20 bg-paper px-3 py-2"
          name="text_en"
          defaultValue={props.confirmation.text_en}
        />
        <textarea
          className="min-h-20 border border-ink/20 bg-paper px-3 py-2"
          name="text_zh"
          defaultValue={props.confirmation.text_zh}
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save confirmation
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("sender_signature", {
            enabled: form.get("enabled") === "on",
            text: String(form.get("text") ?? ""),
          }).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Sender signature</h2>
        <label className="font-body text-sm">
          <input name="enabled" type="checkbox" defaultChecked={props.signature.enabled} /> Append
          the signature
        </label>
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="text"
          defaultValue={props.signature.text}
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save signature
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("content_rules", {
            blocked_keywords: lines(String(form.get("keywords") ?? "")),
            block_urls: form.get("urls") === "on",
          }).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Content rules</h2>
        <textarea
          className="min-h-20 border border-ink/20 bg-paper px-3 py-2"
          name="keywords"
          defaultValue={props.content.blocked_keywords}
        />
        <label className="font-body text-sm">
          <input name="urls" type="checkbox" defaultChecked={props.content.block_urls} /> Block URLs
        </label>
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save content rules
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("test_numbers", lines(String(form.get("numbers") ?? ""))).then(setMessage);
        }}
      >
        <h2 className="font-display text-2xl">Re-test numbers</h2>
        <textarea
          className="min-h-20 border border-ink/20 bg-paper px-3 py-2"
          name="numbers"
          defaultValue={props.testNumbers}
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save test numbers
        </button>
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void (async () => {
            const sudo = await fetch("/api/admin/auth/sudo", {
              method: "POST",
              headers: { "content-type": "application/json", "x-csrf-token": csrf() },
              body: JSON.stringify({
                password: String(form.get("password") ?? ""),
                code: String(form.get("code") ?? ""),
              }),
            });
            if (!sudo.ok) {
              setMessage("Sudo was not granted.");
              return;
            }
            setMessage(
              await save("alerts", {
                email: {
                  enabled: form.get("emailEnabled") === "on",
                  to: lines(String(form.get("emailTo") ?? "")),
                },
                telegram: {
                  enabled: form.get("telegramEnabled") === "on",
                  chat_id: String(form.get("chatId") ?? "") || null,
                },
              }),
            );
          })();
        }}
      >
        <h2 className="font-display text-2xl">Alert channels</h2>
        <p className="font-body text-sm">
          The bot token stays in the environment. This section needs a recent sudo check.
        </p>
        <label className="font-body text-sm">
          <input name="emailEnabled" type="checkbox" defaultChecked={props.alerts.emailEnabled} />{" "}
          Email
        </label>
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="emailTo"
          defaultValue={props.alerts.emailTo}
        />
        <label className="font-body text-sm">
          <input
            name="telegramEnabled"
            type="checkbox"
            defaultChecked={props.alerts.telegramEnabled}
          />{" "}
          Telegram
        </label>
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="chatId"
          defaultValue={props.alerts.chatId}
        />
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="password"
          type="password"
          placeholder="Your password"
          required
        />
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="code"
          placeholder="Authenticator code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
        />
        <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
          Save alert channels
        </button>
      </form>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </div>
  );
}
