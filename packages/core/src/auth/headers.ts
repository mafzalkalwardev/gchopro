export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function securityHeaders(nonce: string): ReadonlyArray<readonly [string, string]> {
  return [
    ["Content-Security-Policy", contentSecurityPolicy(nonce)],
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
    ["X-Frame-Options", "DENY"],
  ];
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
