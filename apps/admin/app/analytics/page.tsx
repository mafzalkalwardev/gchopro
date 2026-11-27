import { analyticsLeaderboard, analyticsSeries } from "@gchopro/db";
import { BenchNav, requireDesk } from "@/lib/desk";
import { screenText } from "@/lib/copy";
import { TrafficChart } from "./traffic-chart";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    granularity?: string;
    userId?: string;
    simId?: string;
    metric?: string;
  }>;
}) {
  const session = await requireDesk();
  const query = await searchParams;
  const report = await analyticsSeries({
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    userId: query.userId,
    simId: query.simId,
  });
  const board = await analyticsLeaderboard({
    from: report.from,
    to: report.to,
    metric: query.metric,
  });
  const usersExport = `/api/admin/analytics/export.csv?from=${report.from}&to=${report.to}&scope=users`;
  const simsExport = `/api/admin/analytics/export.csv?from=${report.from}&to=${report.to}&scope=sims`;
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <h1 className="font-display text-4xl">{await screenText("analytics")}</h1>
        <form className="mt-6 flex flex-wrap items-end gap-3 font-body text-sm">
          <input
            className="border border-ink bg-paper px-3 py-2"
            type="date"
            name="from"
            defaultValue={report.from}
          />
          <input
            className="border border-ink bg-paper px-3 py-2"
            type="date"
            name="to"
            defaultValue={report.to}
          />
          <select
            className="border border-ink bg-paper px-3 py-2"
            name="granularity"
            defaultValue={report.granularity}
          >
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
          </select>
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="userId"
            defaultValue={query.userId ?? ""}
            placeholder="user"
          />
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="simId"
            defaultValue={query.simId ?? ""}
            placeholder="sim"
          />
          <select
            className="border border-ink bg-paper px-3 py-2"
            name="metric"
            defaultValue={query.metric ?? "sent"}
          >
            <option value="sent">sent</option>
            <option value="deliveryRatio">deliveryRatio</option>
            <option value="failed">failed</option>
          </select>
          <button className="bg-ink px-3 py-2 text-paper" type="submit">
            {await screenText("show")}
          </button>
        </form>
        <p className="mt-4 font-body text-sm">
          {await screenText("delivery_ratio")}. {await screenText("avg_delivery")}{" "}
          {report.totals.avgDeliverySec ?? "—"}.
        </p>
        {report.series.length === 0 ? (
          <p className="mt-6 font-body">{await screenText("no_stats")}</p>
        ) : (
          <TrafficChart points={report.series} />
        )}
        <table className="mt-6 w-full max-w-4xl border-collapse font-mono text-sm">
          <thead>
            <tr className="border-b border-ink/20 text-left">
              <th className="py-2 pr-3">day</th>
              <th className="py-2 pr-3">{await screenText("sent")}</th>
              <th className="py-2 pr-3">{await screenText("delivered")}</th>
              <th className="py-2 pr-3">{await screenText("failed")}</th>
              <th className="py-2 pr-3">{await screenText("received")}</th>
              <th className="py-2 pr-3">ratio</th>
              <th className="py-2">sec</th>
            </tr>
          </thead>
          <tbody>
            {report.series.map((point) => (
              <tr key={point.bucket} className="border-b border-ink/10">
                <td className="py-2 pr-3">{point.bucket}</td>
                <td className="py-2 pr-3">{point.sent}</td>
                <td className="py-2 pr-3">{point.delivered}</td>
                <td className="py-2 pr-3">{point.failed}</td>
                <td className="py-2 pr-3">{point.received}</td>
                <td className="py-2 pr-3">{point.deliveryRatio ?? "—"}</td>
                <td className="py-2">{point.avgDeliverySec ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="mt-8 font-display text-2xl">{await screenText("leaderboard")}</h2>
        <ul className="mt-3 max-w-lg font-body text-sm">
          {board.map((row) => (
            <li key={row.userId}>
              <a
                className="inline-flex min-h-11 items-center"
                href={`/analytics?userId=${row.userId}&from=${report.from}&to=${report.to}`}
              >
                {row.username}
              </a>{" "}
              {row.value}
            </li>
          ))}
        </ul>
        {report.topFailureReasons.length > 0 ? (
          <ul className="mt-6 font-mono text-sm">
            {report.topFailureReasons.map((reason) => (
              <li key={reason.name}>
                {reason.name} {reason.count}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-6 flex gap-4 font-body text-sm">
          <a className="inline-flex min-h-11 items-center" href={usersExport}>
            {await screenText("export_users")}
          </a>
          <a className="inline-flex min-h-11 items-center" href={simsExport}>
            {await screenText("export_sims")}
          </a>
        </p>
      </section>
    </main>
  );
}
