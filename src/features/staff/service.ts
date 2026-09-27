/**
 * Staff management services. Clinic Admins manage staff within their own
 * clinic; every mutation writes an AuditLog row inside the same transaction
 * as the change. Cross-clinic access throws ForbiddenError before any write.
 */
import type { Prisma, Role } from "@prisma/client";

import { createToken } from "@/lib/auth/tokens";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

const STAFF_ROLES: readonly Role[] = [
  "CLINIC_ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "LAB_TECH",
  "PHARMACIST",
  "ACCOUNTANT",
];

/** Staff creation issues an email-verification token and audits the invite. */
export async function createStaffUser(
  tx: Tx,
  input: { name: string; email: string; role: Role; clinicId: string; actorUserId: string },
): Promise<{ userId: string; verificationToken: string | null }> {
  if (!STAFF_ROLES.includes(input.role)) {
    throw new ForbiddenError("Invalid role for staff membership.");
  }

  const existing = await tx.user.findUnique({ where: { email: input.email } });
  if (existing) {
    const membership = await tx.membership.findUnique({
      where: { userId_clinicId: { userId: existing.id, clinicId: input.clinicId } },
    });
    if (membership) throw new ConflictError("A user with this email already exists in the clinic.");
  }

  const verification = createToken();

  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data: { isActive: true } })
    : await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          // Random disabled password: the user sets one via the invite email.
          passwordHash: "argon2id$disabled$invite-pending",
          isActive: true,
        },
      });

  await tx.membership.upsert({
    where: { userId_clinicId: { userId: user.id, clinicId: input.clinicId } },
    update: { role: input.role },
    create: { userId: user.id, clinicId: input.clinicId, role: input.role },
  });

  await tx.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: verification.tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: existing ? "staff.membership.updated" : "staff.user.created",
      entityType: "User",
      entityId: user.id,
      after: { email: input.email, role: input.role },
    },
  });

  return { userId: user.id, verificationToken: existing ? null : verification.token };
}

export async function updateStaffRole(
  tx: Tx,
  input: { userId: string; role: Role; clinicId: string; actorUserId: string },
): Promise<void> {
  if (!STAFF_ROLES.includes(input.role)) {
    throw new ForbiddenError("Invalid role for staff membership.");
  }
  const membership = await tx.membership.findUnique({
    where: { userId_clinicId: { userId: input.userId, clinicId: input.clinicId } },
  });
  if (!membership) throw new NotFoundError("That user is not staff in this clinic.");
  if (membership.role === input.role) return;

  await tx.membership.update({
    where: { userId_clinicId: { userId: input.userId, clinicId: input.clinicId } },
    data: { role: input.role },
  });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: "staff.role.updated",
      entityType: "Membership",
      entityId: `${input.userId}:${input.clinicId}`,
      before: { role: membership.role },
      after: { role: input.role },
    },
  });
}

export async function deactivateStaff(
  tx: Tx,
  input: { userId: string; clinicId: string; actorUserId: string },
): Promise<void> {
  const membership = await tx.membership.findUnique({
    where: { userId_clinicId: { userId: input.userId, clinicId: input.clinicId } },
  });
  if (!membership) throw new NotFoundError("That user is not staff in this clinic.");
  if (input.userId === input.actorUserId) {
    throw new ForbiddenError("You cannot deactivate your own account.");
  }

  await tx.$queryRaw`DELETE FROM "Session" WHERE "userId" = ${input.userId}`;
  await tx.membership.delete({
    where: { userId_clinicId: { userId: input.userId, clinicId: input.clinicId } },
  });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: "staff.membership.removed",
      entityType: "Membership",
      entityId: `${input.userId}:${input.clinicId}`,
      before: { role: membership.role },
    },
  });
}
