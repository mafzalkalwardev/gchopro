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
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <h1 className="mt-3 font-display text-4xl">{await screenText("settings")}</h1>
      <nav className="mt-8 grid max-w-lg border border-ink/15 font-body">
        <a className="flex min-h-11 items-center border-b border-ink/15 px-4" href="/templates">
          {await screenText("nav_templates")}
        </a>
        <a className="flex min-h-11 items-center border-b border-ink/15 px-4" href="/usage">
          {await screenText("nav_usage")}
        </a>
        <a className="flex min-h-11 items-center px-4" href="/notices">
          {await screenText("nav_notices")}
          {unread > 0 ? (
            <span className="ml-2 inline-block h-2 w-2 bg-signal" aria-label="unread" />
          ) : null}
        </a>
      </nav>
      <div className="mt-8 grid max-w-lg gap-4 font-body">
        {session.allowSelfPasswordChange ? (
          <a className="inline-flex min-h-11 items-center" href="/password">
            {await screenText("change_password")}
          </a>
        ) : (
          <p>{await screenText("password_managed")}</p>
        )}
        <LanguageSwitch action="/api/portal/locale" next="/settings" />
        <ThemeSwitch action="/api/portal/theme" next="/settings" />
        <NotifyToggles />
      </div>
    </main>
  );
}
