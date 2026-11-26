import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, listScheduled } from "@gchopro/db";
import { CancelButton } from "../composer";
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
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("scheduled")}</h1>
      <PortalNav unread={unread} />
      <ul className="mt-8 max-w-xl space-y-3">
        {rows.messages.map((message) => (
          <li key={message.id} className="border border-ink/15 px-4 py-3">
            <p className="font-mono text-xs">{message.scheduledFor}</p>
            <p className="mt-2 font-body">{message.body}</p>
            <CancelButton id={message.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
