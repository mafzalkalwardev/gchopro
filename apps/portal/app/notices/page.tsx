import { listPortalNotices } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { PortalNav, requirePortal } from "@/lib/gate";
import { NoticeList } from "./notice-list";

export const dynamic = "force-dynamic";

export default async function NoticesPage() {
  const session = await requirePortal();
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <p className="font-body text-sm">
        <a href="/settings">Settings</a>
      </p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("notices")}</h1>
      <NoticeList
        notices={notices.map((notice) => ({
          id: notice.id,
          title: notice.title,
          body: notice.body,
          read: notice.read === true,
        }))}
      />
      {notices.length === 0 ? <p className="mt-6 font-body">No notices.</p> : null}
    </main>
  );
}
