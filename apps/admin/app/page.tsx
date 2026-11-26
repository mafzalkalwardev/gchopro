import { BenchNav, requireDesk } from "@/lib/desk";
import { dashboard } from "@gchopro/db";
import { KillSwitch } from "./kill-switch";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireDesk();
  const board = await dashboard();
  const peak = board.traffic.reduce((highest, point) => Math.max(highest, point.count), 0);
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-10">
        <h1 className="font-display text-3xl">Dispatch bench</h1>
        <p data-testid="signed-in" className="mt-4 font-body">
          {session.username}
        </p>
        <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-4 font-body md:grid-cols-4">
          <div>
            <dt className="font-mono text-xs uppercase">Devices online</dt>
            <dd>{board.devicesOnline}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Devices offline</dt>
            <dd>{board.devicesOffline}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Users active</dt>
            <dd>{board.usersActive}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Queue</dt>
            <dd>
              {board.queue.queued} queued · {board.queue.held} held
            </dd>
          </div>
        </dl>
        <ul className="mt-6 flex flex-wrap gap-3 font-mono text-sm">
          {board.sims.map((row) => (
            <li key={row.health}>
              {row.health} {row.count}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex h-16 items-end gap-1" aria-label="traffic">
          {board.traffic.map((point) => (
            <span
              key={point.hour}
              className="w-2 bg-signal"
              style={{
                height: peak === 0 ? 2 : Math.max(2, Math.round((point.count / peak) * 64)),
              }}
            />
          ))}
        </div>
        <h2 className="mt-10 font-display text-2xl">Kill switch</h2>
        <p className="mt-2 font-body">
          {board.killSwitch ? "Sending is paused." : "Sending is open."}
        </p>
        <KillSwitch enabled={board.killSwitch} />
        <h2 className="mt-10 font-display text-2xl">Open alerts</h2>
        <ul className="mt-4 max-w-xl space-y-2 font-body">
          {board.alerts.length === 0 ? <li>None.</li> : null}
          {board.alerts.map((alert) => (
            <li key={alert.id}>
              {alert.severity} · {alert.title}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
