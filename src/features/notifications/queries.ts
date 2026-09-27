import "server-only";

import type { NotificationType } from "@prisma/client";

import { db } from "@/lib/db";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
};

/** Portal user's own notifications (via their PatientAccount), newest first. */
export async function listNotificationsForPatientUser(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const account = await db.patientAccount.findUnique({ where: { userId } });
  if (!account) return [];
  return db.notification.findMany({
    where: { patientId: account.patientId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Staff user's own notifications, newest first. */
export async function listNotificationsForUser(userId: string, limit = 20): Promise<NotificationRow[]> {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Marks every unread notification of the caller as read (patient or staff). */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const account = await db.patientAccount.findUnique({ where: { userId } });
  const result = await db.notification.updateMany({
    where: {
      OR: [{ userId }, ...(account ? [{ patientId: account.patientId }] : [])],
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
