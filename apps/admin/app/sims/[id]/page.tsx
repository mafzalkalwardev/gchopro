import { getSim } from "@gchopro/db";
import { notFound } from "next/navigation";
import { BenchNav, HealthMark, requireDesk } from "@/lib/desk";
import { SimActions } from "../sim-actions";

export const dynamic = "force-dynamic";

export default async function SimPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDesk();
  const { id } = await params;
  const sim = await getSim(id).catch(() => null);
  if (sim === null) notFound();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">{sim.phoneNumber ?? sim.carrierName ?? "SIM"}</h1>
        <p className="mt-2 font-mono text-sm">
          {sim.deviceName} · slot {sim.slotIndex} · <HealthMark health={sim.health} />
        </p>
        <p className="mt-4 max-w-xl font-body">
          Contact the carrier to resolve the restriction (for example account status, balance,
          fair-use limits). GChoPro does not attempt to bypass carrier restrictions.
        </p>
        <h2 className="mt-8 font-display text-2xl">Health history</h2>
        <ul className="mt-3 font-mono text-sm">
          {sim.events.map((event) => (
            <li key={event.id}>
              {event.at} · {event.kind} · {event.toHealth ?? ""}
            </li>
          ))}
        </ul>
        <p className="mt-4 font-body text-sm">Sent in 7 days: {sim.stats7d.sent}</p>
        <SimActions id={sim.id} health={sim.health} />
      </section>
    </main>
  );
}
