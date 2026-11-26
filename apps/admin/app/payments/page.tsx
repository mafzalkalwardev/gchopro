import { listPayments } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { PaymentForm, VoidPayment } from "./payment-form";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const session = await requireDesk();
  const rows = await listPayments({});
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-4xl">Payments</h1>
          <a
            className="border border-ink px-3 py-2 font-body text-sm"
            href="/api/admin/payments?format=csv"
          >
            Export CSV
          </a>
        </div>
        <table className="mt-6 w-full border-collapse font-body text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
              <th className="py-2">User</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Paid</th>
              <th>Void</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-ink/10 align-top">
                <td className="py-3">
                  <a href={`/users/${row.userId}`}>{row.userId}</a>
                </td>
                <td>
                  {row.amountMinor} {row.currency}
                </td>
                <td>{row.method}</td>
                <td>{row.paidAt.slice(0, 16)}</td>
                <td>{row.voidedAt ? row.voidReason : <VoidPayment id={row.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="mt-4 font-body">No payments yet.</p> : null}
        <PaymentForm />
      </section>
    </main>
  );
}
