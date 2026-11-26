import { BenchNav, requireDesk } from "@/lib/desk";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireDesk();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">Dispatch bench</h1>
        <p data-testid="signed-in" className="mt-4 font-body">
          {session.username}
        </p>
      </section>
    </main>
  );
}
