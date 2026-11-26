import { listSims } from "@gchopro/db";
import { BenchNav, HealthMark, requireDesk } from "@/lib/desk";

export const dynamic = "force-dynamic";

export default async function SimsPage({
  searchParams,
}: {
  searchParams: Promise<{ health?: string; deviceId?: string; assigned?: string }>;
}) {
  const session = await requireDesk();
  const query = await searchParams;
  const sims = await listSims({
    health: query.health,
    deviceId: query.deviceId,
    assigned: query.assigned === "true" ? true : query.assigned === "false" ? false : undefined,
  });
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">SIMs</h1>
        <form className="mt-4 flex gap-3 font-body text-sm" method="get">
          <input
            className="border border-ink/20 bg-paper px-3 py-2"
            name="health"
            placeholder="Health"
            defaultValue={query.health ?? ""}
          />
          <input
            className="border border-ink/20 bg-paper px-3 py-2"
            name="deviceId"
            placeholder="Device"
            defaultValue={query.deviceId ?? ""}
          />
          <button className="border border-ink px-4 py-2" type="submit">
            Filter
          </button>
        </form>
        <table className="mt-6 w-full font-body text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
              <th className="py-2">Line</th>
              <th>Device</th>
              <th>Health</th>
              <th>User</th>
              <th>Today</th>
            </tr>
          </thead>
          <tbody>
            {sims.map((sim) => (
              <tr key={sim.id} className="border-b border-ink/10">
                <td className="py-3">
                  <a href={`/sims/${sim.id}`}>{sim.phoneNumber ?? sim.carrierName ?? "SIM"}</a>
                </td>
                <td>{sim.deviceName}</td>
                <td>
                  <HealthMark health={sim.health} />
                </td>
                <td>{sim.assignedUser?.username ?? "Unassigned"}</td>
                <td>
                  {sim.usageToday.sent} / {sim.usageToday.segments}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
