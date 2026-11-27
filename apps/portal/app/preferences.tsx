"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { screenCopy, type Locale } from "@gchopro/core/i18n";
import { useDark, useLocale, useSetLocale } from "@/lib/locale";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

function isLocale(value: string): value is Locale {
  return value === "en" || value === "zh-CN";
}

function choice(active: boolean): string {
  return `w-full border px-3 font-body text-sm ${active ? "border-ink bg-ink text-paper" : "border-ink/30 bg-paper"}`;
}

export function LanguageSwitch({ action, next }: { action: string; next: string }) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();

  function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = String(new FormData(event.currentTarget).get("locale"));
    if (!isLocale(chosen) || chosen === locale) return;
    const previous = locale;
    setLocale(chosen);
    void fetch(action, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ locale: chosen }),
    }).then((response) => {
      if (!response.ok) {
        setLocale(previous);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-6 grid gap-2">
      <p className="font-body text-sm">{screenCopy(locale, "language")}</p>
      <div
        className="grid grid-cols-2 gap-2"
        role="group"
        aria-label={screenCopy(locale, "language")}
      >
        <form method="post" action={action} className="min-w-0" onSubmit={choose}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="locale" value="en" />
          <button className={choice(locale === "en")} type="submit" aria-pressed={locale === "en"}>
            {screenCopy(locale, "english")}
          </button>
        </form>
        <form method="post" action={action} className="min-w-0" onSubmit={choose}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="locale" value="zh-CN" />
          <button
            className={choice(locale === "zh-CN")}
            type="submit"
            aria-pressed={locale === "zh-CN"}
          >
            {screenCopy(locale, "chinese")}
          </button>
        </form>
      </div>
    </div>
  );
}

function paintTheme(theme: "light" | "dark"): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeSwitch({ action, next }: { action: string; next: string }) {
  const locale = useLocale();
  const [dark, setDark] = useState(useDark());
  function choose(theme: "light" | "dark"): void {
    setDark(theme === "dark");
    paintTheme(theme);
  }
  return (
    <div className="mt-4 grid gap-2">
      <p className="font-body text-sm">{screenCopy(locale, "theme")}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={screenCopy(locale, "theme")}>
        <form method="post" action={action} className="min-w-0">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="theme" value="light" />
          <button
            className={choice(!dark)}
            type="submit"
            aria-pressed={!dark}
            onClick={() => choose("light")}
          >
            {screenCopy(locale, "light")}
          </button>
        </form>
        <form method="post" action={action} className="min-w-0">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="theme" value="dark" />
          <button
            className={choice(dark)}
            type="submit"
            aria-pressed={dark}
            onClick={() => choose("dark")}
          >
            {screenCopy(locale, "dark")}
          </button>
        </form>
      </div>
    </div>
  );
}

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
