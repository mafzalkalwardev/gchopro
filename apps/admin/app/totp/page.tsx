"use client";

import { FormEvent, useEffect, useState } from "react";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function TotpPage() {
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/admin/auth/totp/enroll", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken() },
    }).then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { data: { otpauthUrl: string } };
      setSecret(new URL(body.data.otpauthUrl).searchParams.get("secret") ?? "");
    });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/auth/totp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
      body: JSON.stringify({ code: form.get("code") }),
    });
    const body = (await response.json()) as {
      message?: string;
      data?: { recoveryCodes?: string[] };
    };
    if (!response.ok) {
      setMessage(body.message ?? "The code was not accepted.");
      return;
    }
    const recovery = body.data?.recoveryCodes ?? [];
    if (recovery.length > 0) {
      setCodes(recovery);
      return;
    }
    window.location.assign("/");
  }

  if (codes.length > 0) {
    return (
      <main className="min-h-screen bg-paper px-6 py-10 text-ink">
        <h1 className="font-display text-3xl">Recovery codes</h1>
        <ul data-testid="recovery-codes" className="mt-4 grid gap-1 font-mono text-sm">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button
          className="mt-6 bg-ink px-3 py-2 font-body text-paper"
          type="button"
          onClick={() => window.location.assign("/")}
        >
          Continue
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <h1 className="font-display text-3xl">Authenticator</h1>
      <p data-testid="totp-secret" className="mt-4 font-mono text-sm">
        {secret}
      </p>
      <form className="mt-6 grid max-w-sm gap-3" onSubmit={onSubmit}>
        <label className="grid gap-1 font-body text-sm">
          Authenticator code
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </label>
        <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
          Verify
        </button>
        {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
      </form>
    </main>
  );
}
