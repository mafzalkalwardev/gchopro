"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function PaymentForm() {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/payments", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        userId: String(form.get("userId") ?? ""),
        amountMinor: Number(form.get("amountMinor")),
        currency: String(form.get("currency") ?? "PKR"),
        method: String(form.get("method") ?? ""),
        reference: String(form.get("reference") ?? "") || null,
        paidAt: new Date(String(form.get("paidAt") ?? "")).toISOString(),
        notes: String(form.get("notes") ?? "") || null,
      }),
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setMessage(payload.message ?? "The payment was not recorded.");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="mt-8 grid max-w-lg gap-3">
      <h2 className="font-display text-2xl">Record payment</h2>
      <label className="grid gap-1 font-body text-sm">
        User id
        <input className="border border-ink bg-paper px-3 py-2 font-mono" name="userId" required />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Amount in minor units
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="amountMinor"
          type="number"
          min={0}
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Currency
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="currency"
          defaultValue="PKR"
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Method
        <input className="border border-ink bg-paper px-3 py-2" name="method" required />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Reference
        <input className="border border-ink bg-paper px-3 py-2" name="reference" />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Paid at
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="paidAt"
          type="datetime-local"
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Notes
        <input className="border border-ink bg-paper px-3 py-2" name="notes" />
      </label>
      <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
        Record payment
      </button>
      {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
    </form>
  );
}

export function VoidPayment({ id }: { id: string }) {
  const [reason, setReason] = useState("");

  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.confirm("Void this payment?")) return;
        void fetch(`/api/admin/payments/${id}/void`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf() },
          body: JSON.stringify({ reason }),
        }).then(() => window.location.reload());
      }}
    >
      <input
        className="border border-ink bg-paper px-3 py-2"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Void reason"
        required
      />
      <button className="border border-ink px-3 py-2" type="submit">
        Void
      </button>
    </form>
  );
}
