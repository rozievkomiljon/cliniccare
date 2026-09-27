/**
 * The authorization gate. Every protected Server Component, Server Action,
 * and Route Handler authorizes through requirePermission — it loads the full
 * session (user + memberships + active clinic) from the DB and enforces
 * role-permission and clinic scoping. Never trust client claims.
 */
import "server-only";

import type { Role } from "@prisma/client";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { hasPermission, type Permission } from "@/lib/rbac/permissions";

export type AppSession = {
  user: { id: string; email: string; name: string; isSuperAdmin: boolean };
  memberships: Array<{ clinicId: string; clinicName: string; clinicSlug: string; role: Role }>;
  activeRole: Role;
  activeClinicId: string | null;
  activeClinicName: string | null;
};

/** Loads user + memberships + active clinic from the database. */
export async function getSession(): Promise<AppSession | null> {
  const authSession = await auth();
  const userId = authSession?.user?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      isSuperAdmin: true,
      isActive: true,
      sessionsRevokedAt: true,
    },
  });
  if (!user || !user.isActive) return null;

  // JWT revocation: tokens issued before the watermark are invalid.
  const stamp = authSession.user.stamp;
  if (user.sessionsRevokedAt && (!stamp || stamp * 1000 < user.sessionsRevokedAt.getTime())) {
    return null;
  }

  const memberships = await db.membership.findMany({
    where: { userId },
    include: { clinic: { select: { id: true, name: true, slug: true } } },
    orderBy: { clinic: { name: "asc" } },
  });

  const first = memberships[0];
  if (!first) return null;

  const mapped = memberships.map((m) => ({
    clinicId: m.clinic.id,
    clinicName: m.clinic.name,
    clinicSlug: m.clinic.slug,
    role: m.role,
  }));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
    },
    memberships: mapped,
    activeRole: first.role,
    activeClinicId: first.clinic.id,
    activeClinicName: first.clinic.name,
  };
}

/**
 * Authorizes the current session for `permission`. With `clinicId`, checks
 * the caller's membership in that clinic (the tenancy boundary); without it,
 * uses the first membership. Returns the session with the active context
 * adjusted; throws typed UnauthorizedError/ForbiddenError otherwise.
 */
export async function requirePermission(
  permission: Permission,
  options: { clinicId?: string } = {},
): Promise<AppSession> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();

  const target = options.clinicId
    ? (session.memberships.find((m) => m.clinicId === options.clinicId) ?? null)
    : (session.memberships[0] ?? null);

  if (!target) throw new ForbiddenError("No clinic context for this action.");
  if (!hasPermission(target.role, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }

  return {
    ...session,
    activeRole: target.role,
    activeClinicId: target.clinicId,
    activeClinicName: target.clinicName,
  };
}
