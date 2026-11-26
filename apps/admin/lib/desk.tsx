import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";
import { screenText } from "@/lib/copy";

export async function requireDesk() {
  const token = (await cookies()).get(COOKIE.admin)?.value;
  const session = await readSession(token);
  if (!isSessionRecord(session)) redirect("/login");
  const step = sessionStep(session);
  if (step === "mfa") redirect("/totp");
  if (step === "password") redirect("/password");
  return session;
}

export async function BenchNav({ username }: { username: string }) {
  return (
    <header className="border-b border-ink/15 px-6 py-4">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <div className="mt-3 flex items-end justify-between gap-6">
        <nav className="flex flex-wrap gap-4 font-body text-sm">
          <a href="/">{await screenText("nav_bench")}</a>
          <a href="/devices">{await screenText("nav_devices")}</a>
          <a href="/sims">{await screenText("nav_sims")}</a>
          <a href="/capacity">{await screenText("nav_capacity")}</a>
          <a href="/users">{await screenText("nav_users")}</a>
          <a href="/subscriptions">{await screenText("nav_subscriptions")}</a>
          <a href="/payments">{await screenText("nav_payments")}</a>
          <a href="/notices">{await screenText("nav_notices")}</a>
          <a href="/policies">{await screenText("nav_policies")}</a>
          <a href="/templates">{await screenText("nav_templates")}</a>
          <a href="/opt-outs">{await screenText("nav_opt_outs")}</a>
          <a href="/alerts">{await screenText("nav_alerts")}</a>
          <a href="/analytics">{await screenText("nav_analytics")}</a>
          <a href="/system">{await screenText("nav_system")}</a>
          <a href="/settings">{await screenText("nav_settings")}</a>
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
