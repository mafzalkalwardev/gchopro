import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { groupProgress, listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { CancelRemaining } from "../cancel-remaining";

export const dynamic = "force-dynamic";

export default async function GroupSendPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePortal();
  const { id } = await params;
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const progress = await groupProgress(token, id);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <h1 className="mt-3 font-display text-4xl">
        <span className="sr-only">{await screenText("group_send")}</span>
        {progress.name ?? "Group send"}
      </h1>
      <dl className="mt-8 grid max-w-lg grid-cols-2 gap-3 font-mono text-sm">
        {Object.entries(progress.counts).map(([status, count]) => (
          <div key={status}>
            <dt className="uppercase">{status}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-8 w-full max-w-3xl font-body text-sm">
        <tbody>
          {progress.messages.map((message) => (
            <tr key={message.id} className="border-b border-ink/10">
              <td className="py-2 font-mono">{message.status}</td>
              <td>{message.blockReason ?? message.holdReason ?? ""}</td>
              <td>{message.body}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CancelRemaining id={id} />
    </main>
  );
}
