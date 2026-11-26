import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { analyticsSeries, listPortalNotices, portalProfile } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { PortalNav, requirePortal } from "@/lib/gate";
import { TrafficChart } from "../traffic-chart";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const profile = await portalProfile(token);
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const subscription = profile.subscription;
  const reminder =
    subscription?.status === "active" && subscription.daysLeft > 0 && subscription.daysLeft <= 3;
  const report = await analyticsSeries({ userId: session.userId, granularity: "day" });
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("usage")}</h1>
      <PortalNav unread={unread} />
      {session.readOnly ? (
        <p className="mt-6 max-w-lg border border-ink/20 px-4 py-3 font-body">
          This subscription is read-only. Sending is turned off. Contact your administrator.
        </p>
      ) : null}
      {reminder ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          This subscription ends in {subscription?.daysLeft} days.
        </p>
      ) : null}
      <dl className="mt-8 grid max-w-lg gap-3 font-body">
        <div>
          <dt className="font-mono text-xs uppercase">Status</dt>
          <dd>{subscription?.status ?? "none"}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">Ends</dt>
          <dd>{subscription?.endsAt.slice(0, 16) ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">Days left</dt>
          <dd>{subscription?.daysLeft ?? 0}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">This minute</dt>
          <dd>
            {profile.usage.minute}
            {profile.limits ? ` / ${profile.limits.perMinute}` : ""}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">This hour</dt>
          <dd>
            {profile.usage.hour}
            {profile.limits ? ` / ${profile.limits.perHour}` : ""}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">Today</dt>
          <dd>
            {profile.usage.day}
            {profile.limits ? ` / ${profile.limits.perDay}` : ""}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase">Segments today</dt>
          <dd>
            {profile.usage.segmentsDay}
            {profile.limits ? ` / ${profile.limits.segmentsPerDay}` : ""}
          </dd>
        </div>
      </dl>
      <p className="mt-6 font-body text-sm">
        {await screenText("delivery_ratio")}. {await screenText("avg_delivery")}{" "}
        {report.totals.avgDeliverySec ?? "—"}.
      </p>
      {report.series.length === 0 ? (
        <p className="mt-4 font-body">{await screenText("no_stats")}</p>
      ) : (
        <TrafficChart points={report.series} />
      )}
    </main>
  );
}
