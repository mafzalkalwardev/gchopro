import { listNotices } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { BenchNav, requireDesk } from "@/lib/desk";
import { DeleteNotice, NoticeForm } from "./notice-form";

export const dynamic = "force-dynamic";

export default async function NoticesPage() {
  const session = await requireDesk();
  const rows = await listNotices();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">{await screenText("notices")}</h1>
        <ul className="mt-6 grid gap-4">
          {rows.map((notice) => (
            <li key={notice.id} className="border border-ink/15 p-4">
              <h2 className="font-display text-2xl">{notice.title}</h2>
              <p className="mt-2 font-body">{notice.body}</p>
              <p className="mt-2 font-mono text-xs">
                {notice.audience} · {notice.startsAt.slice(0, 16)} – {notice.endsAt.slice(0, 16)}
              </p>
              <div className="mt-3">
                <DeleteNotice id={notice.id} />
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 ? <p className="mt-4 font-body">No notices.</p> : null}
        <NoticeForm />
      </section>
    </main>
  );
}
