import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, listPortalTemplates } from "@gchopro/db";
import { Composer, GroupForm } from "../composer";
import { PortalNav, requirePortal } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default async function NewPage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const templates = await listPortalTemplates(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">New message</h1>
      <PortalNav unread={unread} />
      <Composer templates={templates.templates} />
      <h2 className="mt-12 font-display text-2xl">Group</h2>
      <GroupForm />
    </main>
  );
}
