import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep, type SessionRecord } from "@gchopro/db";
import { Mark } from "@/app/mark";
import { screenText } from "@/lib/copy";
import { RailLinks } from "@/lib/rail";

export async function requirePortal(): Promise<SessionRecord> {
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "password") redirect("/password");
  if (step === "aup") redirect("/aup");
  if (session.blocked) redirect("/inactive");
  return session;
}

export async function PortalNav({
  unread,
  username,
  userId,
}: {
  unread: number;
  username: string;
  userId: string;
}) {
  const items = [
    { href: "/", label: await screenText("nav_inbox") },
    { href: "/contacts", label: await screenText("nav_contacts") },
    { href: "/groups", label: await screenText("nav_groups") },
    { href: "/scheduled", label: await screenText("nav_scheduled") },
    {
      href: "/settings",
      label: await screenText("nav_settings"),
      match: ["/settings", "/templates", "/usage", "/notices"],
    },
  ];
  return (
    <aside className="rail py-6">
      <p className="flex items-center gap-2 px-3 font-mono text-sm">
        <Mark />
        GChoPro
      </p>
      <RailLinks items={items} unread={unread} />
      <div className="rail-account">
        <p data-testid="signed-in" className="px-3 font-body text-sm">
          {username}
        </p>
        <p
          data-testid="user-id"
          className="truncate px-3 font-mono text-xs text-ink/60"
          title={userId}
        >
          {userId}
        </p>
      </div>
    </aside>
  );
}
