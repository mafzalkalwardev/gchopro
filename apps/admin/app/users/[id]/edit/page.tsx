import { notFound } from "next/navigation";
import { AppError } from "@gchopro/core";
import { freeSims, getUser, listPolicies } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { UserForm } from "../../user-form";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDesk();
  const { id } = await params;
  const user = await getUser(id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  if (user === null) notFound();
  const policies = await listPolicies();
  const sims = await freeSims();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">Edit {user.username}</h1>
        <UserForm
          mode="edit"
          userId={user.id}
          sims={sims.map((sim) => ({ id: sim.id, label: sim.phoneNumber ?? sim.id }))}
          policies={policies.map((policy) => ({ id: policy.id, label: policy.name }))}
          initial={user}
        />
      </section>
    </main>
  );
}
