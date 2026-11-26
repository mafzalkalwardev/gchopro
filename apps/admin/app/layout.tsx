import type { ReactNode } from "react";
import { POLICY_TEXT } from "@gchopro/core";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
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
  title: "GChoPro admin",
  robots: { index: false, follow: false },
};

// The CSP nonce is per request, so the document cannot be cached from the build.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} bg-paper font-body text-ink antialiased`}
      >
        {children}
        <footer className="px-6 py-8 font-body text-sm text-ink/70">{POLICY_TEXT}</footer>
      </body>
    </html>
  );
}
