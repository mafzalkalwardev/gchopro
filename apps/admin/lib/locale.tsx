"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Locale } from "@gchopro/core/i18n";

const LocaleContext = createContext<Locale>("en");
const SetLocaleContext = createContext<(locale: Locale) => void>(() => undefined);
const ThemeContext = createContext(false);

export function LocaleProvider({
  locale: initial,
  dark,
  children,
}: {
  locale: Locale;
  dark: boolean;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setLocale(initial);
  }
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.toggle("dark", dark);
  }, [locale, dark]);
  return (
    <LocaleContext.Provider value={locale}>
      <SetLocaleContext.Provider value={setLocale}>
        <ThemeContext.Provider value={dark}>{children}</ThemeContext.Provider>
      </SetLocaleContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useSetLocale(): (locale: Locale) => void {
  return useContext(SetLocaleContext);
}

export function useDark(): boolean {
  return useContext(ThemeContext);
}
