import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
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
    <main className="gate bg-paper text-ink">
      <section className="w-full max-w-sm border border-ink/15 px-5 py-8 sm:px-8">
        <p className="font-mono text-sm">GChoPro</p>
        <h1 className="mt-2 font-display text-4xl">{await screenText("inactive")}</h1>
        <p className="mt-4 font-body">This account cannot send. Contact your administrator.</p>
      </section>
    </main>
  );
}
