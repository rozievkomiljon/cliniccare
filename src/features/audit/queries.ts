import "server-only";

import { db } from "@/lib/db";

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

/** Audit log for one clinic, newest first. Scope is enforced by the caller. */
export async function listAuditLog(
  clinicId: string,
  limit = 100,
): Promise<AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { clinicId },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorName: r.actor?.name ?? null,
    actorEmail: r.actor?.email ?? null,
    createdAt: r.createdAt,
  }));
}
