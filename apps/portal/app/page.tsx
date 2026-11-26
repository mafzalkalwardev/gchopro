import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listConversations, listPortalNotices, portalProfile } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { PortalNav, requirePortal } from "@/lib/gate";
import { SessionWatch } from "./session-watch";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; tag?: string }>;
}) {
  const session = await requirePortal();
  const query = await searchParams;
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const profile = await portalProfile(token);
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const inbox = await listConversations(token, {
    q: query.q,
    filter: query.filter,
    tag: query.tag,
  });
  const reminder =
    profile.subscription?.status === "active" &&
    profile.subscription.daysLeft > 0 &&
    profile.subscription.daysLeft <= 3;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("inbox")}</h1>
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
      {profile.line.health === "suspected_suspended" ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          Line temporarily unavailable.
        </p>
      ) : !profile.line.available ? (
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
      <form className="mt-8 flex max-w-xl flex-wrap gap-2 font-body text-sm">
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="q"
          defaultValue={query.q ?? ""}
        />
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="tag"
          defaultValue={query.tag ?? ""}
        />
        {query.filter ? <input type="hidden" name="filter" value={query.filter} /> : null}
        <button className="border border-ink px-3 py-2" type="submit">
          {await screenText("search")}
        </button>
      </form>
      <nav className="mt-3 flex gap-4 font-body text-sm">
        <a href="/">{await screenText("open")}</a>
        <a href="/?filter=unread">{await screenText("unread")}</a>
        <a href="/?filter=failed">{await screenText("failed")}</a>
        <a href="/?filter=archived">{await screenText("archived")}</a>
      </nav>
      <ul className="mt-4 max-w-xl divide-y divide-ink/15 border-y border-ink/15">
        {inbox.conversations.length === 0 ? (
          <li className="py-4 font-body">{await screenText("no_conversations")}</li>
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
