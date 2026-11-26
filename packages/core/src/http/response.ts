export const SAFE_TEXT = {
  invalid_credentials: "Those credentials were not accepted.",
  locked: "Those credentials were not accepted.",
  user_disabled: "This account cannot sign in.",
  no_sim: "No line is assigned to this account.",
  subscription_inactive: "This subscription cannot sign in.",
  ip_not_allowed: "Sign-in is not allowed from this network.",
  csrf_failed: "The request was rejected.",
  rate_limited: "Too many requests.",
  mfa_required: "A second factor is required.",
  sudo_required: "Confirm your password and authenticator code.",
  session_revoked: "This session is no longer valid.",
  not_found: "Not found.",
  invalid_body: "The request could not be read.",
  forbidden: "That action is not allowed.",
  invalid_code_format: "The pairing code must be 6 digits.",
  pairing_not_found: "That pairing code was not accepted.",
  upgrade_required: "This app version is no longer accepted.",
  device_revoked: "This device is no longer paired.",
  conflict: "That record is already in use.",
  too_long: "This message is longer than 10 segments.",
  opted_out: "This number has opted out.",
  outside_window: "Sending is closed for this line right now.",
  limit_reached: "This line has reached its send limit.",
  line_unavailable: "The assigned line is not available.",
  kill_switch: "Sending is paused.",
  missing_variables: "This template is missing values.",
  translation_unavailable: "Translation is unavailable right now.",
} as const;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function apiData(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function apiError(code: string, message: string, status: number): Response {
  return Response.json({ error: code, message }, { status });
}

export function apiFromError(error: unknown): Response {
  if (error instanceof AppError) return apiError(error.code, error.message, error.status);
  return apiError("internal", "The request failed.", 500);
}
