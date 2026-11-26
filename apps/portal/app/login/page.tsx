"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";
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

function endedBecause(reason: string): string {
  if (reason === "password_reset")
    return "Your session ended because an administrator reset the password.";
  if (reason === "subscription_inactive")
    return "Your session ended because the subscription is not active.";
  if (reason === "user_disabled") return "Your session ended because the account was disabled.";
  if (reason === "sim_unassigned") return "Your session ended because the line was unassigned.";
  if (reason === "expired") return "Your session ended because the subscription expired.";
  if (reason === "admin_revoke")
    return "Your session ended because an administrator signed you out.";
  return "";
}

function useReason(): string {
  return useSyncExternalStore(
    () => () => undefined,
    () => endedBecause(new URLSearchParams(window.location.search).get("reason") ?? ""),
    () => "",
  );
}

export default function LoginPage() {
  const locale = useLocale();
  const [message, setMessage] = useState("");
  const hydrated = useHydrated();
  const reason = useReason();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portal/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    const body = (await response.json()) as {
      message?: string;
      data?: { mustChangePassword: boolean };
    };
    if (!response.ok) {
      setMessage(body.message ?? "Sign-in failed.");
      return;
    }
    window.location.assign(body.data?.mustChangePassword ? "/password" : "/");
  }

  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-3xl">{screenCopy(locale, "portal_login")}</h1>
      <LanguageSwitch path="/api/portal/locale" />
      <ThemeSwitch path="/api/portal/theme" />
      {reason.length > 0 ? <p className="mt-4 max-w-sm font-body text-sm">{reason}</p> : null}
      <form
        className="mt-6 grid max-w-sm gap-3"
        data-hydrated={hydrated ? "true" : "false"}
        onSubmit={onSubmit}
      >
        <label className="grid gap-1 font-body text-sm">
          Username
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="username"
            autoComplete="username"
            required
          />
        </label>
        <label className="grid gap-1 font-body text-sm">
          Password
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
          Sign in
        </button>
        {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
      </form>
    </main>
  );
}
