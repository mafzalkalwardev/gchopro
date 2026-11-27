"use client";

import { FormEvent, useState } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function PasswordPage() {
  const locale = useLocale();
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
      body: JSON.stringify({ currentPassword: form.get("current"), newPassword: form.get("next") }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setMessage(body.message ?? "The password was not changed.");
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-sm border border-ink/15 px-5 py-8 sm:px-8">
        <h1 className="font-display text-3xl">{screenCopy(locale, "admin_password")}</h1>
        <form
          className="mt-6 grid gap-3"
          method="post"
          action="/api/admin/auth/password"
          onSubmit={onSubmit}
        >
          <label className="grid gap-1 font-body text-sm">
            Current password
            <input
              className="w-full border border-ink bg-paper px-3"
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="grid gap-1 font-body text-sm">
            New password
            <input
              className="w-full border border-ink bg-paper px-3"
              name="next"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <button className="mt-1 w-full bg-ink font-body text-paper" type="submit">
            Change password
          </button>
          {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
        </form>
      </section>
    </main>
  );
}
