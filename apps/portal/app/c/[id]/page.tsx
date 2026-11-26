import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, listPortalTemplates, listThread } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { screenText } from "@/lib/copy";
import { Composer, CancelButton, SendOriginal, TranslationToggle } from "../../composer";
import { ConversationTools } from "../../conversation-tools";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePortal();
  const { id } = await params;
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const thread = await listThread(token, id);
  const templates = await listPortalTemplates(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">
        <span className="sr-only">{await screenText("thread")}</span>
        {thread.peer}
      </h1>
      <ConversationTools id={thread.id} archived={thread.archived} tags={thread.tags} />
      <PortalNav unread={unread} />
      {thread.optedOut ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          This number has opted out. Compose is turned off.
        </p>
      ) : null}
      <ol className="mt-8 max-w-xl space-y-3">
        {thread.messages.map((message) => (
          <li key={message.id} className="border border-ink/15 px-4 py-3">
            <p className="font-mono text-xs uppercase">
              {message.direction} · {message.status}
              {message.holdReason ? ` · ${message.holdReason}` : ""}
              {message.blockReason ? ` · ${message.blockReason}` : ""}
            </p>
            <TranslationToggle
              original={message.original}
              translated={message.translated}
              preferred={message.preferred}
              unavailable={message.translationUnavailable}
            />
            {message.failureName === "TRANSLATION_TIMEOUT" ||
            message.failureName === "TRANSLATION_TOO_LONG" ? (
              <SendOriginal id={message.id} />
            ) : null}
            {message.status === "queued" ||
            message.status === "held" ||
            message.status === "scheduled" ? (
              <CancelButton id={message.id} />
            ) : null}
          </li>
        ))}
      </ol>
      {session.readOnly || session.scheduled || thread.optedOut ? null : (
        <Composer to={thread.peer} templates={templates.templates} />
      )}
    </main>
  );
}
