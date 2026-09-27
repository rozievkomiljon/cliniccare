/**
 * Single-use tokens for password reset and email verification: 32 bytes of
 * CSPRNG entropy, stored as a SHA-256 hash (a DB leak does not leak usable
 * tokens), consumed on first use inside the same transaction as the change.
 */
import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_RESET_TTL_MINUTES = 60;
export const EMAIL_TOKEN_TTL_MINUTES = 24 * 60;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** Returns the plaintext token (shown once, e.g. in an email link) and its hash for storage. */
export function createToken(): { token: string; tokenHash: string } {
  const bytes = randomBytes(32);
  const token = bytes.toString("hex");
  return { token, tokenHash: sha256(token) };
}
