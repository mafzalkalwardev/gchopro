import { COOKIE } from "@gchopro/core";
import { screenText } from "@/lib/copy";
import { listOptOuts } from "@gchopro/db";
import { cookies } from "next/headers";
import { BenchNav, requireDesk } from "@/lib/desk";
import { OptOutForm, ReverseOptOut } from "./opt-out-form";

export const dynamic = "force-dynamic";

export default async function OptOutsPage() {
  const session = await requireDesk();
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const rows = await listOptOuts(token);
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">{await screenText("opt_outs")}</h1>
        <ul className="tape mt-8">
          {rows.length === 0 ? <li className="font-body">No active opt-outs.</li> : null}
          {rows.map((row) => (
            <li key={row.id}>
              <p className="font-mono">{row.number}</p>
              <p className="font-body text-sm">
                {row.scope} · {row.source}
                {row.keyword ? ` · ${row.keyword}` : ""} · {row.createdAt}
              </p>
              <ReverseOptOut id={row.id} />
            </li>
          ))}
        </ul>
        <OptOutForm />
      </section>
    </main>
  );
}
