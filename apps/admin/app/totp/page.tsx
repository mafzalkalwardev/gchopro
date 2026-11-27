"use client";

import { FormEvent, useEffect, useState } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function TotpPage() {
  const locale = useLocale();
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
      <main className="gate bg-paper text-ink">
        <section className="w-full max-w-sm border border-ink/15 px-5 py-8 sm:px-8">
          <h1 className="font-display text-3xl">{screenCopy(locale, "recovery_codes")}</h1>
          <ul data-testid="recovery-codes" className="mt-4 grid gap-1 font-mono text-sm">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <button
            className="mt-6 w-full bg-ink font-body text-paper"
            type="button"
            onClick={() => window.location.assign("/")}
          >
            Continue
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-sm border border-ink/15 px-5 py-8 sm:px-8">
        <h1 className="font-display text-3xl">{screenCopy(locale, "authenticator")}</h1>
        <p data-testid="totp-secret" className="mt-4 break-all font-mono text-sm">
          {secret}
        </p>
        <form className="mt-6 grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-1 font-body text-sm">
            Authenticator code
            <input
              className="w-full border border-ink bg-paper px-3"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button className="mt-1 w-full bg-ink font-body text-paper" type="submit">
            Verify
          </button>
          {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
        </form>
      </section>
    </main>
  );
}
