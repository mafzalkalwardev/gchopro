import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppError } from "@gchopro/core";
import { openSupportView } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { screenText } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function SupportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDesk();
  const { id } = await params;
  const headerList = await headers();
  const view = await openSupportView(
    {
      userId: session.userId,
      role: session.role,
      ip: headerList.get("x-forwarded-for"),
      requestId: headerList.get("x-request-id") ?? crypto.randomUUID(),
    },
    id,
  ).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  if (view === null) notFound();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <p className="border border-signal px-4 py-3 font-body">
          {await screenText("support_banner")}
        </p>
        <h1 className="mt-6 font-display text-4xl">{await screenText("support")}</h1>
        <p className="mt-2 font-mono text-sm">{view.username}</p>
        <ul className="mt-8 max-w-xl divide-y divide-ink/15 border-y border-ink/15">
          {view.messages.length === 0 ? (
            <li className="py-4 font-body">{await screenText("no_conversations")}</li>
          ) : (
            view.messages.map((message) => (
              <li key={message.id} className="py-4">
                <p className="font-mono text-xs uppercase">
                  {message.direction} · {message.status}
                </p>
                <p className="mt-1 font-body">{message.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
