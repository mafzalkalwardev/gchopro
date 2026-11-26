import { COOKIE } from "@gchopro/core";
import { screenText } from "@/lib/copy";
import { listAlerts } from "@gchopro/db";
import { cookies } from "next/headers";
import { BenchNav, requireDesk } from "@/lib/desk";
import { AckButton } from "./ack-button";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireDesk();
  const query = await searchParams;
  const status =
    query.status === "acknowledged" || query.status === "resolved" ? query.status : "open";
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const rows = await listAlerts(token, status);
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">{await screenText("alerts")}</h1>
        <nav className="mt-4 flex gap-4 font-body text-sm">
          <a href="/alerts">Open</a>
          <a href="/alerts?status=acknowledged">Acknowledged</a>
          <a href="/alerts?status=resolved">Resolved</a>
        </nav>
        <ul className="mt-8 max-w-xl space-y-3">
          {rows.length === 0 ? <li className="font-body">None.</li> : null}
          {rows.map((row) => (
            <li key={row.id} className="border border-ink/15 px-4 py-3">
              <p className="font-body">{row.title}</p>
              <p className="font-mono text-xs">
                {row.severity} · {row.type} · {row.createdAt}
              </p>
              {status === "open" ? <AckButton id={row.id} /> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
