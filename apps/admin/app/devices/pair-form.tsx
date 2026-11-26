"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

type Pairing = { deviceId: string; code: string; expiresAt: string; gatewayUrl: string };

export function PairForm() {
  const [name, setName] = useState("Handset");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/devices/pairings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ name }),
    });
    const payload = (await response.json()) as { data?: Pairing; message?: string };
    if (!response.ok || payload.data === undefined) {
      setError(payload.message ?? "The pairing code was not created.");
      return;
    }
    setPairing(payload.data);
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-md border border-ink/15 p-4">
      <h2 className="font-display text-2xl">Pair a handset</h2>
      <label className="mt-4 block font-body text-sm" htmlFor="device-name">
        Name
      </label>
      <input
        id="device-name"
        className="mt-1 w-full border border-ink/20 bg-paper px-3 py-2"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="mt-4 bg-ink px-4 py-2 font-body text-paper" type="submit">
        Create pairing code
      </button>
      {error ? <p className="mt-3 text-signal">{error}</p> : null}
      {pairing ? (
        <div className="mt-4 font-mono text-sm">
          <p className="text-2xl tracking-[0.3em]">{pairing.code}</p>
          <p className="mt-2">Expires {pairing.expiresAt}</p>
          <p className="mt-1 break-all">{pairing.gatewayUrl}</p>
        </div>
      ) : null}
    </form>
  );
}
