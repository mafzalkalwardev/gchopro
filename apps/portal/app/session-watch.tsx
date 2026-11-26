"use client";

import { useEffect, useState } from "react";

export function SessionWatch() {
  const [state, setState] = useState("connecting");

  useEffect(() => {
    const source = new EventSource("/api/portal/events");
    source.onopen = () => setState("open");
    source.addEventListener("session.revoked", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { reason?: string };
      void fetch("/api/portal/me").then((response) => {
        if (!response.ok) {
          window.location.assign(
            `/login?reason=${encodeURIComponent(payload.reason ?? "session_revoked")}`,
          );
        }
      });
    });
    return () => source.close();
  }, []);

  return (
    <p data-testid="sse" className="mt-4 font-mono text-sm">
      {state}
    </p>
  );
}
