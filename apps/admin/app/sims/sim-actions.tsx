"use client";

import { useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function SimActions({ id, health }: { id: string; health: string }) {
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [message, setMessage] = useState("");

  async function send(path: string, method: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? "Saved." : (payload.message ?? "The SIM was not updated."));
    if (response.ok) window.location.reload();
  }

  return (
    <div className="mt-8 grid gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(`/api/admin/sims/${id}`, "PATCH", { phoneNumber: phone });
        }}
      >
        <label className="block font-body text-sm" htmlFor="phone-number">
          Phone number
        </label>
        <input
          id="phone-number"
          className="mt-1 border border-ink/20 bg-paper px-3 py-2"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <button className="ml-3 bg-ink px-4 py-2 text-paper" type="submit">
          Save number
        </button>
      </form>
      {health === "paused_admin" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/admin/sims/${id}/resume`, "POST");
          }}
        >
          <button className="border border-ink px-4 py-2" type="submit">
            Resume
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/admin/sims/${id}/pause`, "POST", { reason });
          }}
        >
          <label className="block font-body text-sm" htmlFor="pause-reason">
            Pause reason
          </label>
          <input
            id="pause-reason"
            className="mt-1 border border-ink/20 bg-paper px-3 py-2"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button className="ml-3 border border-ink px-4 py-2" type="submit">
            Pause
          </button>
        </form>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(`/api/admin/sims/${id}/retest`, "POST", { testNumber });
        }}
      >
        <p className="max-w-xl font-body text-sm">
          Contact the carrier to resolve the restriction (for example account status, balance,
          fair-use limits). GChoPro does not attempt to bypass carrier restrictions.
        </p>
        <label className="mt-3 block font-body text-sm" htmlFor="test-number">
          Re-test number
        </label>
        <input
          id="test-number"
          className="mt-1 border border-ink/20 bg-paper px-3 py-2"
          value={testNumber}
          onChange={(event) => setTestNumber(event.target.value)}
        />
        <button className="ml-3 bg-signal px-4 py-2 text-paper" type="submit">
          Re-test
        </button>
      </form>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </div>
  );
}
