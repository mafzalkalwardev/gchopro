import { constantTimeEqual } from "./session.js";

export function newCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function csrfRejected(input: {
  method: string;
  origin: string | null;
  headerToken: string | null;
  cookieToken: string | null;
  expectedHost: string;
}): boolean {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (input.origin === null || input.headerToken === null || input.cookieToken === null)
    return true;
  if (input.headerToken.length === 0 || input.cookieToken.length === 0) return true;
  let originHost = "";
  try {
    originHost = new URL(input.origin).hostname;
  } catch {
    return true;
  }
  if (originHost !== input.expectedHost) return true;
  return !constantTimeEqual(input.headerToken, input.cookieToken);
}
