import { cookies } from "next/headers";
import { asLocale, screenCopy, type Locale, type ScreenId } from "@gchopro/core/i18n";

export async function currentLocale(): Promise<Locale> {
  return asLocale((await cookies()).get("gcho_locale")?.value);
}

export async function screenText(id: ScreenId): Promise<string> {
  return screenCopy(await currentLocale(), id);
}

export async function themeClass(): Promise<string> {
  return (await cookies()).get("gcho_theme")?.value === "dark" ? "dark" : "";
}
