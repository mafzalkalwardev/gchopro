"use client";

import { FormEvent, useState } from "react";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function LoginPage() {
  const [message, setMessage] = useState("");

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
      <h1 className="mt-3 font-display text-3xl">Portal sign-in</h1>
      <form className="mt-6 grid max-w-sm gap-3" onSubmit={onSubmit}>
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
