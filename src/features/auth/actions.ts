"use server";

/**
 * Auth Server Actions. Every entry point: zod-validated, rate-limited,
 * returns an ActionResult envelope (no thrown raw errors to the client).
 * Auth failures are generic — no account enumeration.
 */
import { AuthError } from "next-auth";
import { headers } from "next/headers";

import { AUTH_ERRORS, forgotPasswordSchema, loginSchema, resetPasswordSchema, verifyEmailSchema } from "@/features/auth/schemas";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { signIn, signOut } from "@/lib/auth";
import { requestPasswordReset, resetPassword, verifyEmail, logout } from "@/features/auth/service";
import type { ActionResult } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

async function clientKey(scope: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${scope}:${ip}`;
}

export async function loginAction(rawInput: unknown): Promise<ActionResult<{ url: string }>> {
  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email and password.", code: "VALIDATION" };
  }
  const { email, password } = parsed.data;

  const limited = rateLimit(await clientKey("login"), 5, 60_000);
  const perAccount = rateLimit(`login-account:${email.toLowerCase()}`, 10, 60 * 60_000);
  if (!limited.ok || !perAccount.ok) {
    return { ok: false, error: "Too many attempts. Try again later.", code: "RATE_LIMITED" };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true, data: { url: "/dashboard" } };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: AUTH_ERRORS.invalid, code: "UNAUTHORIZED" };
    }
    console.error("[auth] login failed unexpectedly", err);
    return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
  }
}

export async function logoutAction(): Promise<ActionResult<{ url: string }>> {
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (session?.user?.id) {
    await logout(session.user.id);
  }
  await signOut({ redirect: false });
  return { ok: true, data: { url: "/login" } };
}

export async function forgotPasswordAction(rawInput: unknown): Promise<ActionResult<{ sent: boolean }>> {
  const parsed = forgotPasswordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email.", code: "VALIDATION" };
  }
  const limited = rateLimit(`forgot:${await clientKey("forgot")}`, 5, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, error: "Too many requests. Try again later.", code: "RATE_LIMITED" };
  }
  await requestPasswordReset(parsed.data.email);
  // Identical response whether or not the account exists (no enumeration).
  return { ok: true, data: { sent: true } };
}

export async function resetPasswordAction(rawInput: unknown): Promise<ActionResult<{ done: boolean }>> {
  const parsed = resetPasswordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid reset link or password.", code: "VALIDATION" };
  }
  const issues = passwordIssues(parsed.data.password);
  if (issues.length > 0) {
    return { ok: false, error: issues[0] ?? "Password does not meet the policy.", code: "VALIDATION" };
  }
  const limited = rateLimit(await clientKey("reset"), 5, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, error: "Too many requests. Try again later.", code: "RATE_LIMITED" };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  await resetPassword(parsed.data.token, passwordHash);
  return { ok: true, data: { done: true } };
}

export async function verifyEmailAction(rawInput: unknown): Promise<ActionResult<{ verified: boolean }>> {
  const parsed = verifyEmailSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Invalid verification link.", code: "VALIDATION" };
  }
  await verifyEmail(parsed.data.token);
  return { ok: true, data: { verified: true } };
}
