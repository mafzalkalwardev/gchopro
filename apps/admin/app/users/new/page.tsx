import { freeSims, listPolicies } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { UserForm } from "../user-form";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await requireDesk();
  const sims = await freeSims();
  const policies = await listPolicies();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">Create user</h1>
        <p className="mt-2 max-w-lg font-body text-sm">
          Leave the password blank. A generated password is shown once.
        </p>
        <UserForm
          mode="create"
          sims={sims.map((sim) => ({
            id: sim.id,
            label: sim.phoneNumber ?? sim.carrierName ?? sim.id,
          }))}
          policies={policies.map((policy) => ({ id: policy.id, label: policy.name }))}
        />
      </section>
    </main>
  );
}
