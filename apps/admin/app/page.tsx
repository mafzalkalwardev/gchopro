import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "mfa") redirect("/totp");
  if (step === "password") redirect("/password");
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-3xl">Dispatch bench</h1>
      <p data-testid="signed-in" className="mt-4 font-body">
        {session.username}
      </p>
    </main>
  );
}
