/**
 * Append-only audit trail writes. Phase 0 policy: an audit failure must never
 * block the underlying business action — it is logged at error level for
 * alerting. Phase 1 moves critical flows (auth, clinical writes) to
 * in-transaction audit writes.
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditInput = {
  clinicId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        clinicId: input.clinicId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before,
        after: input.after,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action, entityType: input.entityType }, "audit write failed");
  }
}
