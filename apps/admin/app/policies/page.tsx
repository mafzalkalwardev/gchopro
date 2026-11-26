import { BenchNav, requireDesk } from "@/lib/desk";
import { listPolicyRows } from "@gchopro/db";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";

const PURPOSE =
  "Pacing and limits keep each SIM within carrier fair-use policies and protect deliverability. They are not a mechanism to disguise traffic or evade carrier controls.";

export default async function PoliciesPage() {
  const session = await requireDesk();
  const rows = await listPolicyRows();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">Policies</h1>
        <p className="mt-4 max-w-xl font-body">{PURPOSE}</p>
        <ul className="mt-8 max-w-xl space-y-3 font-body">
          {rows.map((row) => (
            <li key={row.id} className="border border-ink/15 px-4 py-3">
              <p>
                {row.name}
                {row.isDefault ? " · default" : ""}
              </p>
              <p className="font-mono text-xs">
                gap {row.gapBaseSeconds}±{row.gapJitterSeconds}s · {row.perMinute}/min ·{" "}
                {row.perHour}/hour · {row.perDay}/day · {row.segmentsPerDay} segments
              </p>
            </li>
          ))}
        </ul>
        <PolicyForm />
      </section>
    </main>
  );
}
