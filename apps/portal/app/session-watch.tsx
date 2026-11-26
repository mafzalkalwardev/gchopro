"use client";

import { useEffect, useState } from "react";

export function SessionWatch() {
  const [state, setState] = useState("connecting");

  useEffect(() => {
    const source = new EventSource("/api/portal/events");
    source.onopen = () => setState("open");
    source.addEventListener("message.received", () => {
      if (localStorage.getItem("gcho_sound") !== "0") {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.frequency.value = 880;
        gain.gain.value = 0.04;
        tone.connect(gain);
        gain.connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.12);
        window.setTimeout(() => void audio.close(), 200);
      }
      if (
        localStorage.getItem("gcho_browser") === "1" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("GChoPro");
      }
    });
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
