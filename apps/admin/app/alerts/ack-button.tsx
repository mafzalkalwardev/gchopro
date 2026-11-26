"use client";

import { useState } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function AckButton({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void fetch(`/api/admin/alerts/${id}/ack`, {
          method: "POST",
          headers: { "x-csrf-token": csrf() },
        }).then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          setMessage(response.ok ? "Acknowledged." : (payload.message ?? "Not acknowledged."));
          if (response.ok) window.location.reload();
        });
      }}
    >
      <button className="border border-ink px-3 py-2" type="submit">
        Acknowledge
      </button>
      {message ? <p className="font-body text-sm">{message}</p> : null}
    </form>
  );
}
