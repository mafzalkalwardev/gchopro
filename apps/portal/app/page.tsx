import { cookies } from "next/headers";
import { COOKIE } from "@gchopro/core";
import { listPortalNotices, portalProfile } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { SessionWatch } from "./session-watch";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const profile = await portalProfile(token);
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const reminder =
    profile.subscription?.status === "active" &&
    profile.subscription.daysLeft > 0 &&
    profile.subscription.daysLeft <= 3;
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-3xl">Handset bench</h1>
      <PortalNav unread={unread} />
      {session.readOnly ? (
        <p className="mt-6 max-w-lg border border-ink/20 px-4 py-3 font-body">
          This subscription is read-only. Sending is turned off.
        </p>
      ) : null}
      {session.scheduled ? (
        <p className="mt-6 max-w-lg border border-ink/20 px-4 py-3 font-body">
          Sending starts when the subscription becomes active.
        </p>
      ) : null}
      {reminder ? (
        <p className="mt-6 max-w-lg border border-signal px-4 py-3 font-body">
          This subscription ends in {profile.subscription?.daysLeft} days.
        </p>
      ) : null}
      <p data-testid="signed-in" className="mt-4 font-body">
        {session.username}
      </p>
      <p data-testid="user-id" className="font-mono text-sm">
        {session.userId}
      </p>
      <SessionWatch />
    </main>
  );
}
