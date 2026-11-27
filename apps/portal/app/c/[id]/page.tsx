import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listPortalTemplates, listThread } from "@gchopro/db";
import { requirePortal } from "@/lib/gate";
import { screenText } from "@/lib/copy";
import { Composer, CancelButton, SendOriginal, TranslationToggle } from "../../composer";
import { SavePeerContact } from "../../contacts/contact-form";
import { ConversationTools } from "../../conversation-tools";
import { Messages } from "../../messages";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; filter?: string; tag?: string; send?: string }>;
}) {
  const session = await requirePortal();
  const { id } = await params;
  const query = await searchParams;
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const thread = await listThread(token, id);
  const templates = await listPortalTemplates(token);
  const pending = thread.messages.some(
    (message) =>
      message.status === "queued" ||
      message.status === "dispatched" ||
      message.status === "held" ||
      message.status === "scheduled",
  );
  return (
    <Messages
      query={query}
      activeId={id}
      pane={
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]">
          {pending ? <meta httpEquiv="refresh" content="2" /> : null}
          <header className="flex items-center gap-3 border-b border-ink/15 pb-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/10 font-mono text-sm">
              {thread.peer.replace(/\D/gu, "").slice(-2)}
            </span>
            <h1 className="min-w-0 truncate font-mono text-xl">
              <span className="sr-only">{await screenText("thread")}</span>
              {thread.peer}
            </h1>
          </header>
          <details className="border-b border-ink/15 font-body text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center">Save contact</summary>
            <ConversationTools id={thread.id} archived={thread.archived} tags={thread.tags} />
            <SavePeerContact number={thread.peer} heading={false} returnTo={`/c/${id}`} />
          </details>
          <div className="min-h-0 overflow-auto">
            {thread.optedOut ? (
              <p className="mt-4 max-w-lg border border-signal px-4 py-3 font-body">
                This number has opted out. Compose is turned off.
              </p>
            ) : null}
            <ol className="grid content-start gap-3 py-4" data-pending={pending ? "true" : "false"}>
              {thread.messages.map((message) => {
                const mine = message.direction === "out";
                return (
                  <li
                    key={message.id}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[80%] px-4 py-2 ${mine ? "rounded-2xl rounded-br-md bg-ink text-paper" : "rounded-2xl rounded-bl-md bg-ink/10"}`}
                    >
                      <TranslationToggle
                        original={message.original}
                        translated={message.translated}
                        preferred={message.preferred}
                        unavailable={message.translationUnavailable}
                      />
                    </div>
                    <p className="mt-1 font-mono text-xs uppercase text-ink/60">
                      {message.direction} · {message.status}
                      {message.holdReason ? ` · ${message.holdReason}` : ""}
                      {message.blockReason ? ` · ${message.blockReason}` : ""}
                    </p>
                    {message.failureName === "TRANSLATION_TIMEOUT" ||
                    message.failureName === "TRANSLATION_TOO_LONG" ? (
                      <SendOriginal id={message.id} />
                    ) : null}
                    {message.status === "queued" ||
                    message.status === "held" ||
                    message.status === "scheduled" ? (
                      <CancelButton id={message.id} returnTo={`/c/${id}`} />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
          {session.readOnly || session.scheduled || thread.optedOut ? null : (
            <Composer to={thread.peer} templates={templates.templates} returnTo={`/c/${id}`} />
          )}
        </div>
      }
    />
  );
}
