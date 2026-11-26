"use client";

import { useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function DeviceActions({ id, paused }: { id: string; paused: boolean }) {
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");

  async function send(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setMessage(response.ok ? "Saved." : "The device was not updated.");
    if (response.ok) window.location.reload();
  }

  return (
    <div className="mt-8 flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(`/api/admin/devices/${id}/rotate-token`);
        }}
      >
        <button className="border border-ink px-4 py-2" type="submit">
          Rotate token
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void fetch(`/api/admin/devices/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json", "x-csrf-token": csrf() },
            body: JSON.stringify({ paused: !paused }),
          }).then(() => window.location.reload());
        }}
      >
        <button className="border border-ink px-4 py-2" type="submit">
          {paused ? "Resume device" : "Pause device"}
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(`/api/admin/devices/${id}/retire`, { confirm });
        }}
      >
        <label className="block font-body text-sm" htmlFor="retire-confirm">
          Type RETIRE to retire this handset
        </label>
        <input
          id="retire-confirm"
          className="mt-1 border border-ink/20 bg-paper px-3 py-2"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <button className="ml-3 bg-signal px-4 py-2 text-paper" type="submit">
          Retire
        </button>
      </form>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </div>
  );
}
