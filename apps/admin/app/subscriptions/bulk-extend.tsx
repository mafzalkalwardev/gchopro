"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function BulkExtend({ ids }: { ids: string[] }) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = form.getAll("id").map(String);
    if (selected.length === 0) {
      setMessage("Select at least one subscription.");
      return;
    }
    if (!window.confirm(`Extend ${String(selected.length)} subscriptions by one month?`)) return;
    for (const id of selected) {
      const response = await fetch(`/api/admin/subscriptions/${id}/extend`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ planUnit: "month", planQuantity: 1 }),
      });
      if (!response.ok) {
        setMessage("One extension was not saved.");
        return;
      }
    }
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <ul className="grid gap-2 font-body text-sm">
        {ids.map((id) => (
          <li key={id}>
            <label className="flex items-center gap-2">
              <input name="id" type="checkbox" value={id} />
              <span className="font-mono">{id}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="mt-4 bg-ink px-3 py-2 font-body text-paper" type="submit">
        Extend selected
      </button>
      {message.length > 0 ? <p className="mt-2 font-body text-sm text-signal">{message}</p> : null}
    </form>
  );
}
