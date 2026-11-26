import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";

export const dynamic = "force-dynamic";

export default async function InactivePage() {
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "password") redirect("/password");
  if (step === "aup") redirect("/aup");
  if (!session.blocked) redirect("/");
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">Subscription inactive</h1>
      <p className="mt-4 max-w-lg font-body">
        This account cannot send. Contact your administrator.
      </p>
    </main>
  );
}
