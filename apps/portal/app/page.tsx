import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";
import { SessionWatch } from "./session-watch";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "password") redirect("/password");
  if (step === "aup") redirect("/aup");
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-3xl">Handset bench</h1>
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
