"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";
import { Mark } from "../mark";
import { LanguageSwitch, ThemeSwitch } from "../preferences";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export default function LoginPage() {
  const locale = useLocale();
  const [message, setMessage] = useState("");
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setMessage(body.message ?? "Sign-in failed.");
      return;
    }
    window.location.assign("/totp");
  }

  return (
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-sm border border-ink/15 px-5 py-8 sm:px-8">
        <p className="flex items-center gap-2 font-mono text-sm">
          <Mark />
          GChoPro
        </p>
        <h1 className="mt-2 font-display text-4xl">{screenCopy(locale, "admin_login")}</h1>
        <LanguageSwitch action="/api/admin/locale" next="/login" />
        <ThemeSwitch action="/api/admin/theme" next="/login" />
        <form
          className="mt-6 grid gap-3"
          method="post"
          action="/api/admin/auth/login"
          data-hydrated={hydrated ? "true" : "false"}
          onSubmit={onSubmit}
        >
          <label className="grid gap-1 font-body text-sm">
            Username
            <input
              className="w-full border border-ink bg-paper px-3"
              name="username"
              autoComplete="username"
              required
            />
          </label>
          <label className="grid gap-1 font-body text-sm">
            Password
            <input
              className="w-full border border-ink bg-paper px-3"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="mt-1 w-full bg-ink font-body text-paper" type="submit">
            Sign in
          </button>
          {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
        </form>
      </section>
    </main>
  );
}
