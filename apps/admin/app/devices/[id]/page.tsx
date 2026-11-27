import { getDevice } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { notFound } from "next/navigation";
import { BenchNav, HealthMark, requireDesk } from "@/lib/desk";
import { DeviceActions } from "../device-actions";

export const dynamic = "force-dynamic";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDesk();
  const { id } = await params;
  const device = await getDevice(id).catch(() => null);
  if (device === null) notFound();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">
          <span className="sr-only">{await screenText("device")}</span>
          {device.name}
        </h1>
        <p className="mt-2 font-mono text-sm">
          {device.status} · {device.online ? "online" : "offline"} ·{" "}
          {device.model ?? "unknown model"}
        </p>
        <div className="tape mt-6">
          {device.sims.map((sim) => (
            <a
              key={sim.id}
              href={`/sims/${sim.id}`}
              className="flex flex-wrap items-center gap-x-3"
            >
              <span className="font-mono text-xs">Slot {sim.slotIndex}</span>
              <span className="ml-3">{sim.carrierName ?? "Unnamed SIM"}</span>
              <span className="ml-3">{sim.phoneNumber ?? "No number"}</span>
              <span className="ml-3">
                <HealthMark health={sim.health} />
              </span>
            </a>
          ))}
        </div>
        <h2 className="mt-8 font-display text-2xl">Events</h2>
        <ul className="mt-3 font-mono text-sm">
          {device.events.map((event) => (
            <li key={event.id}>
              {event.at} · {event.title}
            </li>
          ))}
        </ul>
        <DeviceActions id={device.id} paused={device.paused} />
      </section>
    </main>
  );
}
