export function endedBecause(reason: string): string {
  if (reason === "password_reset")
    return "Your session ended because an administrator reset the password.";
  if (reason === "subscription_inactive")
    return "Your session ended because the subscription is not active.";
  if (reason === "user_disabled") return "Your session ended because the account was disabled.";
  if (reason === "sim_unassigned") return "Your session ended because the line was unassigned.";
  if (reason === "expired") return "Your session ended because the subscription expired.";
  if (reason === "admin_revoke")
    return "Your session ended because an administrator signed you out.";
  return "";
}
