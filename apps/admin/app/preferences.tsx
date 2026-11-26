"use client";

import { screenCopy } from "@gchopro/core/i18n";
import { useLocale } from "@/lib/locale";

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
