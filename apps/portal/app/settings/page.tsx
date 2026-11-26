import { listPortalNotices } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { PortalNav, requirePortal } from "@/lib/gate";
import { LanguageSwitch, NotifyToggles, ThemeSwitch } from "../preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePortal();
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("settings")}</h1>
      <PortalNav unread={unread} />
      <div className="mt-8 grid max-w-lg gap-4 font-body">
        {session.allowSelfPasswordChange ? (
          <a className="underline" href="/password">
            {await screenText("change_password")}
          </a>
        ) : (
          <p>{await screenText("password_managed")}</p>
        )}
        <a className="underline" href="/api/portal/export.csv">
          {await screenText("download_messages")}
        </a>
        <LanguageSwitch path="/api/portal/locale" />
        <ThemeSwitch path="/api/portal/theme" />
        <NotifyToggles />
      </div>
    </main>
  );
}
