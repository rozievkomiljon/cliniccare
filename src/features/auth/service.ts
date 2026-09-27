/**
 * Auth feature services. Multi-step auth flows (reset, verify email) run as
 * explicit services so they can be integration-tested without HTTP.
 */
import { verifyPassword } from "@/lib/auth/password";
import { PASSWORD_RESET_TTL_MINUTES, createToken, sha256 } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { recordAudit } from "@/features/audit/service";
import { AppError } from "@/lib/errors";

export type VerifiedUser = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

/**
 * Credential verification core (used by the Auth.js authorize callback).
 * Audits every attempt; returns null on any failure — never a reason.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<VerifiedUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      isActive: true,
      isSuperAdmin: true,
    },
  });

  const ok = user?.isActive === true && (await verifyPassword(user.passwordHash, password));
  await recordAudit({
    actorUserId: user?.id ?? null,
    action: ok ? "auth.login.success" : "auth.login.failed",
    entityType: "User",
    entityId: user?.id ?? null,
  });

  if (!ok || !user) return null;
  return { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin };
}

export type RequestPasswordResetResult = { ok: true };

/**
 * Always succeeds from the caller's perspective (no account enumeration);
 * creates a single-use token when the account exists and queues an email.
 */
export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) return { ok: true };

  const { token, tokenHash } = createToken();
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });
  });

  const { sendPasswordResetEmail } = await import("./email");
  await sendPasswordResetEmail(email, token);
  await recordAudit({
    actorUserId: user.id,
    action: "auth.password.reset_requested",
    entityType: "User",
    entityId: user.id,
  });
  return { ok: true };
}

/**
 * Consumes the reset token and swaps the password hash in one transaction.
 * Revokes every existing session and invalidates outstanding reset tokens.
 */
export async function resetPassword(token: string, passwordHash: string): Promise<void> {
  const tokenHash = sha256(token);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("This password reset link is invalid or has expired.", { code: "TOKEN_INVALID" });
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { tokenHash }, data: { usedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: record.userId } });
  });

  await recordAudit({
    actorUserId: record.userId,
    action: "auth.password.reset",
    entityType: "User",
    entityId: record.userId,
  });
}

/** Marks the user's email verified; throws on unknown/used/expired tokens. */
export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = sha256(token);
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("This verification link is invalid or has expired.", { code: "TOKEN_INVALID" });
  }
  await db.$transaction([
    db.emailVerificationToken.update({ where: { tokenHash }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

/** Audits an explicit sign-out. The Auth.js cookie clearing happens in the action. */
export async function logout(userId: string): Promise<void> {
  await recordAudit({
    actorUserId: userId,
    action: "auth.logout",
    entityType: "User",
    entityId: userId,
  });
}
