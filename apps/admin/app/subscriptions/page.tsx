import { listSubscriptions } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { BulkExtend } from "./bulk-extend";

export const dynamic = "force-dynamic";

const tabs = [
  { href: "/subscriptions?status=active", label: "Active", status: "active" },
  { href: "/subscriptions?expiring=1", label: "Expiring", status: "expiring" },
  { href: "/subscriptions?status=expired", label: "Expired", status: "expired" },
  { href: "/subscriptions?status=disabled", label: "Disabled", status: "disabled" },
] as const;

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; expiring?: string }>;
}) {
  const session = await requireDesk();
  const query = await searchParams;
  const rows = await listSubscriptions({
    status: query.expiring === "1" ? undefined : query.status,
    expiringWithinDays: query.expiring === "1" ? 3 : undefined,
  });
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">Subscriptions</h1>
        <nav className="mt-4 flex gap-4 font-body text-sm">
          {tabs.map((tab) => (
            <a key={tab.label} href={tab.href}>
              {tab.label}
            </a>
          ))}
        </nav>
        <table className="mt-6 w-full border-collapse font-body text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
              <th className="py-2">User</th>
              <th>Status</th>
              <th>Ends</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-ink/10">
                <td className="py-3">
                  <a href={`/users/${row.userId}`}>{row.userId}</a>
                </td>
                <td>{row.status}</td>
                <td>{row.endsAt.slice(0, 16)}</td>
                <td>
                  {row.planQuantity} {row.planUnit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="mt-4 font-body">Nothing in this tab.</p> : null}
        <BulkExtend ids={rows.map((row) => row.id)} />
      </section>
    </main>
  );
}
