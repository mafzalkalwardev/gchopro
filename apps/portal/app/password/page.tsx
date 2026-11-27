import { SAFE_TEXT } from "@gchopro/core";
import PasswordForm from "./password-form";

export const dynamic = "force-dynamic";

function notice(reason: string | undefined): string {
  if (reason === undefined || !(reason in SAFE_TEXT)) return "";
  return SAFE_TEXT[reason as keyof typeof SAFE_TEXT];
}

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const query = await searchParams;
  return <PasswordForm notice={notice(query.reason)} />;
}
