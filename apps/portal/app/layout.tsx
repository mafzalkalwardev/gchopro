import type { ReactNode } from "react";
import { POLICY_TEXT } from "@gchopro/core";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { currentLocale, themeClass } from "@/lib/copy";
import { LocaleProvider } from "@/lib/locale";
import { InstallPortal } from "./install";
import "./globals.css";

const display = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "GChoPro",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  themeColor: "#1C1915",
};

// The CSP nonce is per request, so the document cannot be cached from the build.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  const theme = await themeClass();
  return (
    <html
      lang={locale}
      className={`${theme} ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="bg-paper font-body text-ink antialiased">
        <LocaleProvider locale={locale} dark={theme === "dark"}>
          {children}
          <InstallPortal />
        </LocaleProvider>
        <footer className="max-w-3xl px-6 py-6 font-body text-sm leading-6 text-ink/60">
          {POLICY_TEXT}
        </footer>
      </body>
    </html>
  );
}
