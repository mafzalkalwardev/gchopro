import { listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { NoticeList } from "./notice-list";

export const dynamic = "force-dynamic";

export default async function NoticesPage() {
  const session = await requirePortal();
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">Notices</h1>
      <PortalNav unread={unread} />
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
