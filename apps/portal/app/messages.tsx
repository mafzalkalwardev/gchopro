import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listConversations, listPortalNotices, portalProfile } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { PortalNav, requirePortal } from "@/lib/gate";
import { SessionWatch } from "./session-watch";

type Query = { q?: string; filter?: string; tag?: string };

function mark(peer: string): string {
  const digits = peer.replace(/\D/gu, "");
  return digits.length >= 2 ? digits.slice(-2) : peer.slice(0, 1);
}

function listHref(path: string, query: Query, filter?: string): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (filter) params.set("filter", filter);
  const text = params.toString();
  return text.length > 0 ? `${path}?${text}` : path;
}

export async function Messages({
  pane,
  activeId,
  query,
}: {
  pane: ReactNode;
  activeId?: string;
  query: Query;
}) {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const profile = await portalProfile(token);
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const inbox = await listConversations(token, query);
  const here = activeId ? `/c/${activeId}` : "/";
  const reminder =
    profile.subscription?.status === "active" &&
    profile.subscription.daysLeft > 0 &&
    profile.subscription.daysLeft <= 3;
  const inboxLabel = await screenText("inbox");
  const searchLabel = await screenText("search");
  const tagLabel = await screenText("tag");
  function filterClass(active: boolean): string {
    return `inline-flex min-h-11 items-center rounded-full px-3 ${active ? "bg-ink text-paper" : "text-ink/70"}`;
  }
  return (
    <main className="desk flex min-h-0 flex-col bg-paper px-4 text-ink lg:px-6">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />
      <div className="flex shrink-0 items-center justify-between gap-3">
        {activeId ? (
          <a href="/" className="inline-flex min-h-11 items-center font-body text-sm lg:hidden">
            {inboxLabel}
          </a>
        ) : (
          <h1 className="font-display text-2xl leading-none">{inboxLabel}</h1>
        )}
        <a
          href="/#compose"
          className="ml-auto inline-flex min-h-11 items-center rounded-full bg-ink px-4 font-body text-sm text-paper"
        >
          {await screenText("nav_new")}
        </a>
      </div>
      {session.readOnly ? (
        <p className="mb-4 max-w-lg border border-ink/20 px-4 py-3 font-body">
          This subscription is read-only. Sending is turned off.
        </p>
      ) : null}
      {session.scheduled ? (
        <p className="mb-4 max-w-lg border border-ink/20 px-4 py-3 font-body">
          Sending starts when the subscription becomes active.
        </p>
      ) : null}
      {profile.line.health === "suspected_suspended" ? (
        <p className="mb-4 max-w-lg border border-signal px-4 py-3 font-body">
          Line temporarily unavailable.
        </p>
      ) : !profile.line.available ? (
        <p className="mb-4 max-w-lg border border-signal px-4 py-3 font-body">
          The assigned line is not available.
        </p>
      ) : null}
      {reminder ? (
        <p className="mb-4 max-w-lg border border-signal px-4 py-3 font-body">
          This subscription ends in {profile.subscription?.daysLeft} days.
        </p>
      ) : null}
      <SessionWatch />
      <div className="messages mt-2">
        <section className={`messages-list ${activeId ? "max-lg:hidden" : ""}`}>
          {activeId ? <h2 className="font-display text-2xl">{inboxLabel}</h2> : null}
          <form className="inbox-find mt-3 font-body text-sm" action={here}>
            <input
              className="min-w-0 flex-1 rounded-full border border-ink/20 bg-paper px-4"
              name="q"
              aria-label={searchLabel}
              placeholder={searchLabel}
              defaultValue={query.q ?? ""}
            />
            <input
              className="w-28 rounded-full border border-ink/20 bg-paper px-4"
              name="tag"
              aria-label={tagLabel}
              placeholder={tagLabel}
              defaultValue={query.tag ?? ""}
            />
            {query.filter ? <input type="hidden" name="filter" value={query.filter} /> : null}
            <button className="min-h-11 rounded-full border border-ink/20 px-3" type="submit">
              {searchLabel}
            </button>
          </form>
          <nav className="mt-2 flex flex-wrap gap-1 font-body text-sm">
            <a className={filterClass(query.filter === undefined)} href={listHref(here, query)}>
              {await screenText("open")}
            </a>
            <a
              className={filterClass(query.filter === "unread")}
              href={listHref(here, query, "unread")}
            >
              {await screenText("unread")}
            </a>
            <a
              className={filterClass(query.filter === "failed")}
              href={listHref(here, query, "failed")}
            >
              {await screenText("failed")}
            </a>
            <a
              className={filterClass(query.filter === "archived")}
              href={listHref(here, query, "archived")}
            >
              {await screenText("archived")}
            </a>
          </nav>
          <ul className="mt-2">
            {inbox.conversations.length === 0 ? (
              <li className="px-2 py-6 font-body text-sm text-ink/70">
                {await screenText("no_conversations")}
              </li>
            ) : (
              inbox.conversations.map((row) => (
                <li key={row.id}>
                  <a
                    href={`/c/${row.id}`}
                    aria-current={row.id === activeId ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-2xl px-2 py-2 font-body ${row.id === activeId ? "bg-ink/10" : ""}`}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/10 font-mono text-sm">
                      {mark(row.peer)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate font-mono ${row.unread > 0 ? "font-medium" : ""}`}
                      >
                        {row.peer}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-ink/70">
                        {row.preview}
                      </span>
                    </span>
                    {row.unread > 0 ? <span className="sr-only">{row.unread} unread</span> : null}
                    {row.unread > 0 ? (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-signal"
                        aria-hidden="true"
                      />
                    ) : null}
                  </a>
                </li>
              ))
            )}
          </ul>
        </section>
        <section id={activeId ? undefined : "compose"} className="messages-pane">
          {pane}
        </section>
      </div>
    </main>
  );
}
