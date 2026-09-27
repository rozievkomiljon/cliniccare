/**
 * Password hashing (argon2id via @node-rs/argon2) — server-side only; the
 * native module must never reach a client bundle. The pure policy helpers
 * live in password-policy.ts and are re-exported here for server callers.
 */
import { hash, verify } from "@node-rs/argon2";

export { isPasswordValid, passwordIssues } from "@/lib/auth/password-policy";

const ARGON2_OPTS = {
  memoryCost: 19456, // 19 MiB, OWASP 2024 baseline
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashValue, plain);
  } catch {
    // Malformed/unknown hash format — treat as verification failure.
    return false;
  }
}
