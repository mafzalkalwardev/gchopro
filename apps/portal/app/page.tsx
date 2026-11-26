import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listConversations, listPortalNotices, portalProfile } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { SessionWatch } from "./session-watch";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const profile = await portalProfile(token);
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const inbox = await listConversations(token, {});
  const reminder =
    profile.subscription?.status === "active" &&
    profile.subscription.daysLeft > 0 &&
    profile.subscription.daysLeft <= 3;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">Inbox</h1>
      <PortalNav unread={unread} />
      {session.readOnly ? (
        <p className="mt-6 max-w-lg border border-ink/20 px-4 py-3 font-body">
          This subscription is read-only. Sending is turned off.
        </p>
      ) : null}
      {session.scheduled ? (
        <p className="mt-6 max-w-lg border border-ink/20 px-4 py-3 font-body">
          Sending starts when the subscription becomes active.
        </p>
      ) : null}
      {!profile.line.available ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          The assigned line is not available.
        </p>
      ) : null}
      {reminder ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          This subscription ends in {profile.subscription?.daysLeft} days.
        </p>
      ) : null}
      <p data-testid="signed-in" className="mt-4 font-body">
        {session.username}
      </p>
      <p data-testid="user-id" className="font-mono text-sm">
        {session.userId}
      </p>
      <SessionWatch />
      <ul className="mt-8 max-w-xl divide-y divide-ink/15 border-y border-ink/15">
        {inbox.conversations.length === 0 ? (
          <li className="py-4 font-body">No conversations yet.</li>
        ) : (
          inbox.conversations.map((row) => (
            <li key={row.id} className="py-4">
              <a href={`/c/${row.id}`} className="font-body">
                <span className="font-mono">{row.peer}</span>
                <span className="mt-1 block text-ink/70">{row.preview}</span>
              </a>
              {row.unread > 0 ? (
                <span className="font-mono text-xs text-signal">{row.unread} unread</span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
