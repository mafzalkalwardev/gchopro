import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";

export async function requireDesk() {
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "mfa") redirect("/totp");
  if (step === "password") redirect("/password");
  return session;
}

export function BenchNav({ username }: { username: string }) {
  return (
    <header className="border-b border-ink/15 px-6 py-4">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <div className="mt-3 flex items-end justify-between gap-6">
        <nav className="flex gap-5 font-body text-sm">
          <a href="/">Bench</a>
          <a href="/devices">Devices</a>
          <a href="/sims">SIMs</a>
          <a href="/capacity">Capacity</a>
          <a href="/users">Users</a>
          <a href="/subscriptions">Subscriptions</a>
          <a href="/payments">Payments</a>
          <a href="/notices">Notices</a>
        </nav>
        <p className="font-mono text-sm">{username}</p>
      </div>
    </header>
  );
}

export function HealthMark({ health }: { health: string }) {
  const attention =
    health === "suspected_suspended" || health === "error" || health === "no_service";
  return (
    <span className={`font-mono text-xs uppercase ${attention ? "text-signal" : "text-ink/70"}`}>
      {health.split("_").join(" ")}
    </span>
  );
}
