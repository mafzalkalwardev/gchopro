import { systemHealth } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { screenText } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const session = await requireDesk();
  const health = await systemHealth();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">{await screenText("system")}</h1>
        <dl className="mt-8 grid max-w-lg gap-3 font-body">
          <div>
            <dt className="font-mono text-xs uppercase">Database</dt>
            <dd>{health.db ? "up" : "down"}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Redis</dt>
            <dd>{health.redis ? "up" : "down"}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Worker</dt>
            <dd>{health.worker.lastBeatAt ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Backup</dt>
            <dd>
              {health.backup.lastAt === null
                ? "No backup has been recorded."
                : `Last backup ${health.backup.lastAt}. Restore test ${health.backup.restoreTestAt ?? "not recorded"}.`}
            </dd>
          </div>
        </dl>
        <ul className="mt-8 max-w-lg font-mono text-sm">
          {health.queues.length === 0 ? <li>No queued work.</li> : null}
          {health.queues.map((queue) => (
            <li key={queue.simId}>
              {queue.simId} {queue.queued} queued · {queue.held} held
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
