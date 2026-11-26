"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function KillSwitch({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("confirm") !== "on") {
      setError("Confirm before changing the switch.");
      return;
    }
    const response = await fetch("/api/admin/kill-switch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ enabled: !enabled, reason: String(form.get("reason") ?? "") }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "The switch was not changed.");
      return;
    }
    window.location.reload();
  }

  return (
    <form className="mt-6 grid max-w-lg gap-3" onSubmit={(event) => void save(event)}>
      <p className="font-body">Messages already handed to a device cannot be recalled.</p>
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="reason"
        placeholder="Reason"
        required
      />
      <label className="flex items-center gap-2 font-body text-sm">
        <input name="confirm" type="checkbox" />I understand this {enabled ? "resumes" : "stops"}{" "}
        new dispatches.
      </label>
      <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
        {enabled ? "Resume sending" : "Pause sending"}
      </button>
      {error.length > 0 ? <p className="text-signal">{error}</p> : null}
    </form>
  );
}
