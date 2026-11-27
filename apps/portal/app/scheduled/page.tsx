import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, listScheduled } from "@gchopro/db";
import { CancelButton } from "../composer";
import { SessionWatch } from "../session-watch";
import { PortalNav, requirePortal } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default async function ScheduledPage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const rows = await listScheduled(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <h1 className="mt-3 font-display text-4xl">{await screenText("scheduled")}</h1>
      <SessionWatch />
      <ul className="tape mt-8">
        {rows.messages.map((message) => (
          <li key={message.id}>
            <p className="font-mono text-xs">{message.scheduledFor}</p>
            <p className="mt-2 font-body">{message.body}</p>
            <CancelButton id={message.id} returnTo="/scheduled" />
          </li>
        ))}
      </ul>
    </main>
  );
}
