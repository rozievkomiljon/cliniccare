/**
 * In-app notifications. Created inside the same transaction as the appointment
 * change they describe, so a notification never references a state that was
 * rolled back. Patients are notified through their PatientAccount; the owning
 * doctor through their User id.
 */
import type { NotificationType, Prisma } from "@prisma/client";

import { formatZoned } from "@/lib/timezone";

export type AppointmentNotificationInput = {
  clinicId: string;
  patientId: string;
  doctorUserId: string;
  type: NotificationType;
  patientName: string;
  doctorName: string;
  /** Instant of the (new) appointment time, if applicable. */
  whenIso?: string;
  /** Clinic timezone used to render `whenIso` for humans. */
  timeZone: string;
};

function fmtWhen(whenIso: string | undefined, timeZone: string): string {
  if (!whenIso) return "";
  return ` at ${formatZoned(new Date(whenIso), timeZone)} (${timeZone})`;
}

export function buildAppointmentNotification(
  input: AppointmentNotificationInput,
): Array<Pick<Prisma.NotificationUncheckedCreateInput, "clinicId" | "userId" | "patientId" | "type" | "title" | "body">> {
  const when = fmtWhen(input.whenIso, input.timeZone);
  const common = { clinicId: input.clinicId, type: input.type };

  const patientCopy: Record<NotificationType, { title: string; body: string }> = {
    APPOINTMENT_BOOKED: {
      title: "Appointment booked",
      body: `An appointment with ${input.doctorName} was scheduled for you${when}.`,
    },
    APPOINTMENT_RESCHEDULED: {
      title: "Appointment rescheduled",
      body: `Your appointment with ${input.doctorName} was moved${when}.`,
    },
    APPOINTMENT_CANCELLED: {
      title: "Appointment cancelled",
      body: `Your appointment with ${input.doctorName} was cancelled${when ? ` (was${when})` : ""}.`,
    },
  };

  const staffCopy: Record<NotificationType, { title: string; body: string }> = {
    APPOINTMENT_BOOKED: {
      title: "New appointment",
      body: `${input.patientName} was booked in your schedule${when}.`,
    },
    APPOINTMENT_RESCHEDULED: {
      title: "Appointment rescheduled",
      body: `${input.patientName}'s appointment was moved${when}.`,
    },
    APPOINTMENT_CANCELLED: {
      title: "Appointment cancelled",
      body: `${input.patientName}'s appointment was cancelled${when ? ` (was${when})` : ""}.`,
    },
  };

  return [
    { ...common, patientId: input.patientId, userId: null, ...patientCopy[input.type] },
    { ...common, patientId: null, userId: input.doctorUserId, ...staffCopy[input.type] },
  ];
}

/** Writes the notification rows inside the caller's transaction. */
export async function createAppointmentNotifications(
  tx: Prisma.TransactionClient,
  input: AppointmentNotificationInput,
): Promise<void> {
  const rows = buildAppointmentNotification(input);
  await tx.notification.createMany({ data: rows });
}
