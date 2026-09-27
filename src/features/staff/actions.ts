"use server";

/**
 * Staff Server Actions — the first real consumers of requirePermission.
 * Each action: zod parse → RBAC guard → transactional service (which writes
 * the audit row) → ActionResult envelope. All clinic scoping comes from the
 * guard's session, never from client input.
 */
import { revalidatePath } from "next/cache";

import { sendEmailVerificationEmail } from "@/features/auth/email";
import {
  createStaffSchema,
  deactivateStaffSchema,
  updateStaffRoleSchema,
} from "@/features/staff/schemas";
import { createStaffUser, deactivateStaff, updateStaffRole } from "@/features/staff/service";
import { withAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";

export const createStaffAction = withAction(createStaffSchema, async (input) => {
  const session = await requirePermission("staff:manage");

  const { verificationToken } = await db.$transaction(async (tx) =>
    createStaffUser(tx, {
      name: input.name,
      email: input.email,
      role: input.role,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
    }),
  );

  // Invitation link (dev: MailHog). Token is single-use; send failures are logged.
  if (verificationToken) {
    await sendEmailVerificationEmail(input.email, verificationToken);
  }
  revalidatePath("/settings/staff");
  return { invited: true as const };
});

export const updateStaffRoleAction = withAction(updateStaffRoleSchema, async (input) => {
  const session = await requirePermission("staff:manage");
  await db.$transaction(async (tx) =>
    updateStaffRole(tx, {
      userId: input.userId,
      role: input.role,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
    }),
  );
  revalidatePath("/settings/staff");
  return { updated: true as const };
});

export const deactivateStaffAction = withAction(deactivateStaffSchema, async (input) => {
  const session = await requirePermission("staff:manage");
  await db.$transaction(async (tx) =>
    deactivateStaff(tx, {
      userId: input.userId,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
    }),
  );
  revalidatePath("/settings/staff");
  return { removed: true as const };
});
