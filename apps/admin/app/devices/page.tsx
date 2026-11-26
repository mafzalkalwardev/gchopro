import { listDevices } from "@gchopro/db";
import { BenchNav, HealthMark, requireDesk } from "@/lib/desk";
import { PairForm } from "./pair-form";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const session = await requireDesk();
  const devices = await listDevices();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">Devices</h1>
        <table className="mt-6 w-full border-collapse font-body text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
              <th className="py-2">Name</th>
              <th>Status</th>
              <th>Online</th>
              <th>Battery</th>
              <th>Slots</th>
              <th>SIMs</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-b border-ink/10">
                <td className="py-3">
                  <a href={`/devices/${device.id}`}>{device.name}</a>
                </td>
                <td>{device.status}</td>
                <td>{device.online ? "online" : "offline"}</td>
                <td>{device.battery ?? "—"}</td>
                <td>{device.slotsOnDevice}</td>
                <td>
                  {device.sims.map((sim) => (
                    <span key={sim.id} className="mr-3">
                      {sim.carrierName ?? "SIM"} <HealthMark health={sim.health} />
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {devices.length === 0 ? <p className="mt-4 font-body">No handsets yet.</p> : null}
        <PairForm />
      </section>
    </main>
  );
}
