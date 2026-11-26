"use client";

import { FormEvent, useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function OptOutForm() {
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/opt-outs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ number, scope: "global", note }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? "Saved." : (payload.message ?? "The opt-out was not saved."));
    if (response.ok) window.location.reload();
  }

  return (
    <form className="mt-8 grid max-w-md gap-3" onSubmit={onSubmit}>
      <label className="font-body text-sm" htmlFor="opt-out-number">
        Number
      </label>
      <input
        id="opt-out-number"
        className="border border-ink/20 bg-paper px-3 py-2"
        value={number}
        onChange={(event) => setNumber(event.target.value)}
        required
      />
      <label className="font-body text-sm" htmlFor="opt-out-note">
        Note
      </label>
      <input
        id="opt-out-note"
        className="border border-ink/20 bg-paper px-3 py-2"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button className="w-fit bg-ink px-4 py-2 text-paper" type="submit">
        Add opt-out
      </button>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </form>
  );
}

export function ReverseOptOut({ id }: { id: string }) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sudo = await fetch("/api/admin/auth/sudo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ password, code }),
    });
    if (!sudo.ok) {
      setMessage("Sudo was not granted.");
      return;
    }
    const response = await fetch(`/api/admin/opt-outs/${id}/reverse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ reason, evidence }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    setMessage(response.ok ? "Reversed." : (payload.message ?? "The opt-out was not reversed."));
    if (response.ok) window.location.reload();
  }

  return (
    <form className="mt-3 grid gap-2" onSubmit={onSubmit}>
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        placeholder="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        placeholder="Evidence"
        value={evidence}
        onChange={(event) => setEvidence(event.target.value)}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        type="password"
        placeholder="Your password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        placeholder="Authenticator code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
      />
      <button className="w-fit border border-ink px-4 py-2" type="submit">
        Reverse
      </button>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </form>
  );
}
