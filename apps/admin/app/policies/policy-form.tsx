"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function PolicyForm() {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const days = form
      .getAll("day")
      .map((value) => Number(value))
      .filter((value) => value >= 1 && value <= 7);
    const response = await fetch("/api/admin/policies", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        gapBaseSeconds: Number(form.get("gapBaseSeconds")),
        gapJitterSeconds: Number(form.get("gapJitterSeconds")),
        perMinute: Number(form.get("perMinute")),
        perHour: Number(form.get("perHour")),
        perDay: Number(form.get("perDay")),
        segmentsPerDay: Number(form.get("segmentsPerDay")),
        maxGroupRecipients: Number(form.get("maxGroupRecipients")),
        windowStart: String(form.get("windowStart") ?? "09:00:00"),
        windowEnd: String(form.get("windowEnd") ?? "20:00:00"),
        windowDays: days.length > 0 ? days : [1, 2, 3, 4, 5, 6, 7],
        windowTimezoneMode: "user",
        overLimitAction: String(form.get("overLimitAction") ?? "hold"),
      }),
    });
    if (!response.ok) {
      setError("The policy was not saved.");
      return;
    }
    window.location.reload();
  }

  return (
    <form className="mt-8 grid max-w-lg gap-3" onSubmit={(event) => void save(event)}>
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="name"
        placeholder="Name"
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="gapBaseSeconds"
        type="number"
        min={5}
        defaultValue={15}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="gapJitterSeconds"
        type="number"
        min={0}
        defaultValue={5}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="perMinute"
        type="number"
        min={1}
        defaultValue={3}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="perHour"
        type="number"
        min={1}
        defaultValue={50}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="perDay"
        type="number"
        min={1}
        defaultValue={300}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="segmentsPerDay"
        type="number"
        min={1}
        defaultValue={400}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="maxGroupRecipients"
        type="number"
        min={1}
        defaultValue={50}
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2 font-mono"
        name="windowStart"
        defaultValue="09:00:00"
        required
      />
      <input
        className="border border-ink/20 bg-paper px-3 py-2 font-mono"
        name="windowEnd"
        defaultValue="20:00:00"
        required
      />
      <select className="border border-ink/20 bg-paper px-3 py-2" name="overLimitAction">
        <option value="hold">Hold</option>
        <option value="reject">Reject</option>
      </select>
      <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
        Save policy
      </button>
      {error.length > 0 ? <p className="text-signal">{error}</p> : null}
    </form>
  );
}
