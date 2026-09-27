/**
 * Password policy — pure functions only (no node/native imports) so client
 * components can validate before submit. The argon2id hashing lives in
 * src/lib/auth/password.ts (server-only).
 */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push("at least 10 characters");
  if (!/[a-z]/.test(password)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("an uppercase letter");
  if (!/[0-9]/.test(password)) issues.push("a digit");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("a symbol");
  return issues.map((issue) => `Password must contain ${issue}.`);
}

export function isPasswordValid(password: string): boolean {
  return passwordIssues(password).length === 0;
}
