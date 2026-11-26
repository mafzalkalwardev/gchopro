import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep, type SessionRecord } from "@gchopro/db";

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

export function PortalNav({ unread }: { unread: number }) {
  return (
    <nav className="mt-6 flex gap-5 font-body text-sm">
      <a href="/">Bench</a>
      <a href="/usage">Usage</a>
      <a href="/notices">
        Notices
        {unread > 0 ? (
          <span className="ml-2 inline-block h-2 w-2 bg-signal align-middle" aria-label="unread" />
        ) : null}
      </a>
    </nav>
  );
}
