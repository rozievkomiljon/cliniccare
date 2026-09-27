import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

const ACTIVE = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;

export type CalendarRow = {
  id: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  reason: string | null;
};

const includeForCalendar = {
  doctor: { include: { user: { select: { name: true } } } },
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
} satisfies Prisma.AppointmentInclude;

type CalendarInclude = typeof includeForCalendar;

function toCalendarRow(a: Prisma.AppointmentGetPayload<{ include: CalendarInclude }>): CalendarRow {
  return {
    id: a.id,
    doctorId: a.doctor.id,
    doctorName: a.doctor.user.name,
    patientId: a.patient.id,
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    patientMrn: a.patient.mrn,
    scheduledAt: a.scheduledAt.toISOString(),
    durationMinutes: a.durationMinutes,
    status: a.status,
    reason: a.reason,
  };
}

/**
 * Clinic calendar for a [from, to) UTC window. Optionally narrowed to one
 * doctor (per-doctor view). Scope is enforced by the caller's guard.
 */
export async function listAppointmentsForRange(
  clinicId: string,
  opts: { from: Date; to: Date; doctorId?: string; includeInactive?: boolean },
): Promise<CalendarRow[]> {
  const rows = await db.appointment.findMany({
    where: {
      clinicId,
      scheduledAt: { gte: opts.from, lt: opts.to },
      ...(opts.doctorId ? { doctorId: opts.doctorId } : {}),
      ...(opts.includeInactive ? {} : { status: { in: [...ACTIVE] } }),
    },
    include: includeForCalendar,
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map(toCalendarRow);
}

/** One clinic-scoped appointment with its append-only event history. */
export async function getAppointmentForClinic(clinicId: string, appointmentId: string) {
  const a = await db.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    include: {
      ...includeForCalendar,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) return null;
  return { ...toCalendarRow(a), events: a.events, notes: a.notes, cancellationReason: a.cancellationReason };
}

/** The portal user's own appointments (upcoming actives first, then history). */
export async function listAppointmentsForPatient(patientId: string, limit = 50): Promise<CalendarRow[]> {
  const rows = await db.appointment.findMany({
    where: { patientId },
    include: includeForCalendar,
    orderBy: { scheduledAt: "desc" },
    take: limit,
  });
  return rows.map(toCalendarRow);
}
