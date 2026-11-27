import { capacity } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { BenchNav, requireDesk } from "@/lib/desk";

export const dynamic = "force-dynamic";

export default async function CapacityPage() {
  const session = await requireDesk();
  const snapshot = await capacity();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">{await screenText("capacity")}</h1>
        <p className="mt-3 font-mono text-sm">
          {snapshot.totals.free} free of {snapshot.totals.slots} slots ·{" "}
          {snapshot.totals.usersWithoutSim} users without a SIM
        </p>
        <ul className="tape mt-6">
          {snapshot.devices.map((device) => {
            const width =
              device.slotsOnDevice === 0 ? 0 : (device.activeSims / device.slotsOnDevice) * 100;
            return (
              <li key={device.deviceId}>
                <p className="font-body">{device.name}</p>
                <div className="mt-3 h-2 bg-ink/10">
                  <div className="h-2 bg-signal" style={{ width: `${Math.min(width, 100)}%` }} />
                </div>
                <p className="mt-2 font-mono text-xs">
                  {device.activeSims} active · {device.assignedSims} assigned · {device.freeSims}{" "}
                  free
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
