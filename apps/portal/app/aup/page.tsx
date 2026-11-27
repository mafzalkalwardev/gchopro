"use client";

import { useState } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

const TERMS =
  "Messages may only be sent to recipients who have consented or have an existing relationship with the sender. Purchased or scraped lists are prohibited. Recipients can reply STOP or 退订 to opt out at any time. Operation must comply with local telecommunications regulations (for example the Pakistan Telecommunication Authority where applicable) and the terms of service of each carrier.";

function csrfToken(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row === undefined ? "" : decodeURIComponent(row.slice("__Host-gcho_csrf=".length));
}

export default function AupPage() {
  const locale = useLocale();
  const [message, setMessage] = useState("");

  async function accept() {
    const response = await fetch("/api/portal/aup", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken() },
    });
    if (!response.ok) {
      setMessage("The terms could not be recorded.");
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-lg border border-ink/15 px-5 py-8 sm:px-8">
        <h1 className="font-display text-3xl">{screenCopy(locale, "aup")}</h1>
        <p className="mt-4 font-body">{TERMS}</p>
        <button
          className="mt-6 w-full bg-ink font-body text-paper"
          type="button"
          onClick={() => void accept()}
        >
          Accept
        </button>
        {message.length > 0 ? (
          <p className="mt-3 font-body text-sm text-signal">{message}</p>
        ) : null}
      </section>
    </main>
  );
}
