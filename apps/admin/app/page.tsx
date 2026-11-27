import { BenchNav, requireDesk } from "@/lib/desk";
import { screenText } from "@/lib/copy";
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
        <h1 className="font-display text-3xl">{await screenText("bench")}</h1>
        <dl className="console-stats mt-6">
          <div>
            <dt className="font-mono text-xs uppercase">Devices online</dt>
            <dd className="font-mono text-2xl">{board.devicesOnline}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Devices offline</dt>
            <dd className="font-mono text-2xl">{board.devicesOffline}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Users active</dt>
            <dd className="font-mono text-2xl">{board.usersActive}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase">Queue</dt>
            <dd className="font-mono text-2xl">{board.queue.queued}</dd>
            <p className="font-body text-sm text-ink/70">{board.queue.held} held</p>
          </div>
        </dl>
        <ul className="tape mt-6 font-mono text-sm">
          {board.sims.map((row) => (
            <li key={row.health} className="flex items-center justify-between gap-4">
              <span className="uppercase">{row.health.split("_").join(" ")}</span>
              <span>{row.count}</span>
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
