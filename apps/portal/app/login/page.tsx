import { redirect } from "next/navigation";
import { SAFE_TEXT } from "@gchopro/core";
import { endedBecause } from "@/lib/ended-because";
import LoginScreen from "./login-screen";

function notice(reason: string): string {
  if (reason === "invalid_credentials" || reason === "locked") return SAFE_TEXT.invalid_credentials;
  if (reason === "user_disabled") return SAFE_TEXT.user_disabled;
  if (reason === "no_sim") return SAFE_TEXT.no_sim;
  if (reason === "subscription_inactive") return SAFE_TEXT.subscription_inactive;
  if (reason === "ip_not_allowed") return SAFE_TEXT.ip_not_allowed;
  return endedBecause(reason);
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    reason?: string;
    username?: string | string[];
    password?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const username = first(query.username);
  const password = first(query.password);
  if (username.length > 0 && password.length > 0) {
    const link = new URLSearchParams({ username, password });
    redirect(`/api/portal/auth/login?${link.toString()}`);
  }
  return <LoginScreen notice={notice(first(query.reason))} />;
}
