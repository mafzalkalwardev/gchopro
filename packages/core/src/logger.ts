import { pino } from "pino";
import type { Logger } from "pino";

const sensitiveKey = /password|token|secret|_enc$|authorization|cookie|^address$|^body$/iu;

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        sensitiveKey.test(key) ? "[Redacted]" : redactForLog(inner),
      ]),
    );
  }
  return value;
}

export function createLogger(level: string, bindings: { requestId?: string } = {}): Logger {
  return pino({
    level,
    base: bindings.requestId === undefined ? undefined : { requestId: bindings.requestId },
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "authorization",
        "cookie",
        "address",
        "body",
        "*.password",
        "*.token",
        "*.secret",
        "*.authorization",
        "*.cookie",
        "*.address",
        "*.body",
      ],
      censor: "[Redacted]",
    },
  });
}
