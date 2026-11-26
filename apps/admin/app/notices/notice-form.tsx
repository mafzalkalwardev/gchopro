"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function NoticeForm() {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const audience = String(form.get("audience") ?? "all");
    const userIds = String(form.get("userIds") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const response = await fetch("/api/admin/notices", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        title: String(form.get("title") ?? ""),
        body: String(form.get("body") ?? ""),
        audience,
        userIds: audience === "selected" ? userIds : undefined,
        startsAt: new Date(String(form.get("startsAt") ?? "")).toISOString(),
        endsAt: new Date(String(form.get("endsAt") ?? "")).toISOString(),
      }),
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setMessage(payload.message ?? "The notice was not saved.");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="mt-8 grid max-w-lg gap-3">
      <h2 className="font-display text-2xl">New notice</h2>
      <label className="grid gap-1 font-body text-sm">
        Title
        <input className="border border-ink bg-paper px-3 py-2" name="title" required />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Body
        <textarea className="border border-ink bg-paper px-3 py-2" name="body" required />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Audience
        <select className="border border-ink bg-paper px-3 py-2" name="audience" defaultValue="all">
          <option value="all">Everyone</option>
          <option value="selected">Selected users</option>
        </select>
      </label>
      <label className="grid gap-1 font-body text-sm">
        User ids, comma separated
        <input className="border border-ink bg-paper px-3 py-2 font-mono" name="userIds" />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Starts
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="startsAt"
          type="datetime-local"
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Ends
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="endsAt"
          type="datetime-local"
          required
        />
      </label>
      <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
        Publish notice
      </button>
      {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
    </form>
  );
}

export function DeleteNotice({ id }: { id: string }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.confirm("Delete this notice?")) return;
        void fetch(`/api/admin/notices/${id}`, {
          method: "DELETE",
          headers: { "x-csrf-token": csrf() },
        }).then(() => window.location.reload());
      }}
    >
      <button className="border border-ink px-3 py-2" type="submit">
        Delete
      </button>
    </form>
  );
}
