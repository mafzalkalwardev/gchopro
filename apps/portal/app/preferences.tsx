"use client";

import { useSyncExternalStore } from "react";
import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

const flagListeners = new Set<() => void>();

function subscribeFlags(listener: () => void): () => void {
  flagListeners.add(listener);
  return () => {
    flagListeners.delete(listener);
  };
}

function emitFlags(): void {
  for (const listener of flagListeners) listener();
}

function readFlag(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "1";
}

function useFlag(key: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    subscribeFlags,
    () => readFlag(key, fallback),
    () => fallback,
  );
}

function writeFlag(key: string, next: boolean): void {
  localStorage.setItem(key, next ? "1" : "0");
  emitFlags();
}

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

async function choose(path: string, body: { locale?: string; theme?: string }) {
  await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf() },
    body: JSON.stringify(body),
  });
  window.location.reload();
}

export function LanguageSwitch({ path }: { path: string }) {
  const locale = useLocale();
  return (
    <p className="mt-4 flex flex-wrap gap-3 font-body text-sm">
      <span>{screenCopy(locale, "language")}</span>
      <button
        className="underline"
        type="button"
        onClick={() => void choose(path, { locale: "en" })}
      >
        {screenCopy(locale, "english")}
      </button>
      <button
        className="underline"
        type="button"
        onClick={() => void choose(path, { locale: "zh-CN" })}
      >
        {screenCopy(locale, "chinese")}
      </button>
    </p>
  );
}

export function ThemeSwitch({ path }: { path: string }) {
  const locale = useLocale();
  return (
    <p className="mt-4 flex flex-wrap gap-3 font-body text-sm">
      <span>{screenCopy(locale, "theme")}</span>
      <button
        className="underline"
        type="button"
        onClick={() => void choose(path, { theme: "light" })}
      >
        {screenCopy(locale, "light")}
      </button>
      <button
        className="underline"
        type="button"
        onClick={() => void choose(path, { theme: "dark" })}
      >
        {screenCopy(locale, "dark")}
      </button>
    </p>
  );
}

export function NotifyToggles() {
  const locale = useLocale();
  const sound = useFlag("gcho_sound", true);
  const browser = useFlag("gcho_browser", false);
  return (
    <div className="mt-4 grid gap-3 font-body text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={sound}
          onChange={(event) => writeFlag("gcho_sound", event.target.checked)}
        />
        {screenCopy(locale, "sound")}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={browser}
          onChange={(event) => {
            writeFlag("gcho_browser", event.target.checked);
            if (event.target.checked && "Notification" in window)
              void Notification.requestPermission();
          }}
        />
        {screenCopy(locale, "browser_notifications")}
      </label>
      <p className="text-ink/70">{screenCopy(locale, "web_push_off")}</p>
    </div>
  );
}
