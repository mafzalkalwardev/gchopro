import { listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePortal();
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">Settings</h1>
      <PortalNav unread={unread} />
      <div className="mt-8 grid max-w-lg gap-4 font-body">
        {session.allowSelfPasswordChange ? (
          <a className="underline" href="/password">
            Change password
          </a>
        ) : (
          <p>Password changes are managed by an administrator.</p>
        )}
        <a className="underline" href="/api/portal/export.csv">
          Download messages.csv
        </a>
        <p className="text-ink/70">
          Sound, theme, and language catalogs arrive with the analytics milestone.
        </p>
      </div>
    </main>
  );
}
