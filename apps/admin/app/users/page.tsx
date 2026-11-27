import { listUsers } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { BenchNav, requireDesk } from "@/lib/desk";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; subscription?: string }>;
}) {
  const session = await requireDesk();
  const query = await searchParams;
  const rows = await listUsers({
    q: query.q,
    status: query.status,
    subscription: query.subscription,
  });
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-4xl">{await screenText("users")}</h1>
          <a
            className="inline-flex min-h-11 items-center border border-ink px-3 font-body text-sm"
            href="/users/new"
          >
            Create user
          </a>
        </div>
        <form className="mt-6 flex flex-wrap gap-3 font-body text-sm" method="get">
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="q"
            placeholder="Search"
            defaultValue={query.q}
          />
          <select
            className="border border-ink bg-paper px-3 py-2"
            name="status"
            defaultValue={query.status ?? ""}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <select
            className="border border-ink bg-paper px-3 py-2"
            name="subscription"
            defaultValue={query.subscription ?? ""}
          >
            <option value="">Any subscription</option>
            <option value="active">Active</option>
            <option value="expiring">Expiring</option>
            <option value="expired">Expired</option>
          </select>
          <button className="bg-ink px-3 py-2 text-paper" type="submit">
            Filter
          </button>
        </form>
        <table className="mt-6 w-full border-collapse font-body text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
              <th className="py-2">Username</th>
              <th>Name</th>
              <th>SIM</th>
              <th>Subscription</th>
              <th>Languages</th>
              <th>Last login</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-b border-ink/10">
                <td className="py-3">
                  <a href={`/users/${user.id}`}>{user.username}</a>
                </td>
                <td>{user.displayName}</td>
                <td>{user.sim?.phoneNumber ?? user.sim?.carrierName ?? "—"}</td>
                <td>
                  {user.subscription
                    ? `${user.subscription.status} ${user.subscription.endsAt.slice(0, 10)}`
                    : "—"}
                </td>
                <td>
                  {user.userLanguage}/{user.recipientLanguage}
                </td>
                <td>{user.lastLoginAt?.slice(0, 16) ?? "—"}</td>
                <td>{user.activeSessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="mt-4 font-body">No users match.</p> : null}
      </section>
    </main>
  );
}
