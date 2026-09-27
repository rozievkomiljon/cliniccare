import "server-only";

import { db } from "@/lib/db";

export type StaffRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

/** Lists staff (non-patient memberships) for one clinic. Scope is enforced by the caller. */
export async function listStaff(clinicId: string): Promise<StaffRow[]> {
  const memberships = await db.membership.findMany({
    where: { clinicId, role: { not: "PATIENT" } },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    isActive: m.user.isActive,
  }));
}
