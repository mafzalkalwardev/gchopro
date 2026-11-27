import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@gchopro/core";
import { isSessionRecord, readSession, sessionStep } from "@gchopro/db";
import { Mark } from "@/app/mark";
import { screenText } from "@/lib/copy";
import { RailLinks } from "@/lib/rail";

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
  const groups = [
    { items: [{ href: "/", label: await screenText("nav_bench") }] },
    {
      label: await screenText("nav_directory"),
      items: [
        { href: "/users", label: await screenText("nav_users") },
        { href: "/subscriptions", label: await screenText("nav_subscriptions") },
      ],
    },
    {
      label: await screenText("nav_devices"),
      items: [
        { href: "/devices", label: await screenText("nav_devices") },
        { href: "/sims", label: await screenText("nav_sims") },
        { href: "/capacity", label: await screenText("nav_capacity") },
      ],
    },
    {
      label: await screenText("nav_billing"),
      items: [{ href: "/payments", label: await screenText("nav_payments") }],
    },
    {
      label: await screenText("nav_account"),
      items: [
        { href: "/policies", label: await screenText("nav_policies") },
        { href: "/templates", label: await screenText("nav_templates") },
        { href: "/opt-outs", label: await screenText("nav_opt_outs") },
        { href: "/notices", label: await screenText("nav_notices") },
        { href: "/alerts", label: await screenText("nav_alerts") },
        { href: "/settings", label: await screenText("nav_settings") },
      ],
    },
    {
      label: await screenText("nav_reporting"),
      items: [
        { href: "/analytics", label: await screenText("nav_analytics") },
        { href: "/system", label: await screenText("nav_system") },
      ],
    },
  ];
  const initial = username.slice(0, 1).toUpperCase();
  return (
    <>
      <header className="console-top">
        <a href="/" className="console-brand">
          <Mark size={32} />
          <span>Admin console</span>
        </a>
        <p data-testid="signed-in" className="console-account">
          <span className="console-avatar" aria-hidden="true">
            {initial}
          </span>
          {username}
        </p>
      </header>
      <aside className="rail">
        <RailLinks groups={groups} />
      </aside>
    </>
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
