/**
 * Structured logger (pino). PHI-safe by policy: never log request bodies,
 * patient identifiers, or clinical data — only IDs, routes, and durations.
 */
import pino from "pino";

const level =
  process.env.LOG_LEVEL === "debug" ||
  process.env.LOG_LEVEL === "info" ||
  process.env.LOG_LEVEL === "warn" ||
  process.env.LOG_LEVEL === "error"
    ? process.env.LOG_LEVEL
    : "info";

export const logger = pino({
  level,
  base: undefined,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});
