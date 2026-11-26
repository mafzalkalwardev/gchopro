import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep, type SessionRecord } from "@gchopro/db";
import { screenText } from "@/lib/copy";

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

export async function PortalNav({ unread }: { unread: number }) {
  return (
    <nav className="mt-6 flex flex-wrap gap-4 font-body text-sm">
      <a href="/">{await screenText("nav_inbox")}</a>
      <a href="/new">{await screenText("nav_new")}</a>
      <a href="/contacts">{await screenText("nav_contacts")}</a>
      <a href="/groups">{await screenText("nav_groups")}</a>
      <a href="/templates">{await screenText("nav_templates")}</a>
      <a href="/scheduled">{await screenText("nav_scheduled")}</a>
      <a href="/usage">{await screenText("nav_usage")}</a>
      <a href="/settings">{await screenText("nav_settings")}</a>
      <a href="/notices">
        {await screenText("nav_notices")}
        {unread > 0 ? (
          <span className="ml-2 inline-block h-2 w-2 bg-signal align-middle" aria-label="unread" />
        ) : null}
      </a>
    </nav>
  );
}
