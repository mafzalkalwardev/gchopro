"use client";

import { FormEvent, useState } from "react";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function PasswordPage() {
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portal/auth/password", {
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
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <h1 className="font-display text-3xl">Change password</h1>
      <form className="mt-6 grid max-w-sm gap-3" onSubmit={onSubmit}>
        <label className="grid gap-1 font-body text-sm">
          Current password
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="grid gap-1 font-body text-sm">
          New password
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="next"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
          Change password
        </button>
        {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
      </form>
    </main>
  );
}
