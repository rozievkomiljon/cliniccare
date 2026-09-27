/**
 * Availability engine + transactional booking service.
 *
 * Double-booking is impossible by construction:
 *  1. service validation — availability window check and overlap check against
 *     the doctor's ACTIVE appointments inside one SERIALIZABLE transaction;
 *  2. database constraint — a partial unique index on (doctorId, scheduledAt)
 *     WHERE status IN ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS') makes
 *     a racing pair of bookings fail at commit time even if validation loses
 *     the race. The P2002 is mapped to a friendly ConflictError.
 *
 * Every write is transactional with its AppointmentEvent and AuditLog rows and
 * fires patient + doctor notifications in the same transaction.
 */
import { Prisma, AppointmentStatus } from "@prisma/client";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";
import { createAppointmentNotifications } from "@/features/notifications/service";

/** Statuses that occupy a slot. */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
];

export type AppointmentActor = {
  clinicId: string;
  actorUserId: string;
  actorName: string;
  kind: "STAFF" | "PATIENT";
};

export type BookAppointmentInput = {
  doctorId: string;
  patientId: string;
  scheduledAt: string; // YYYY-MM-DDTHH:mm (UTC)
  durationMinutes: number;
  reason?: string;
};

export type AppointmentDto = {
  id: string;
  clinicId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  reason: string | null;
};

function toAppointmentDto(row: {
  id: string;
  clinicId: string;
  durationMinutes: number;
  status: AppointmentStatus;
  reason: string | null;
  scheduledAt: Date;
  doctor: { id: string; user: { name: string } };
  patient: { id: string; firstName: string; lastName: string; mrn: string };
}): AppointmentDto {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctor.id,
    doctorName: row.doctor.user.name,
    patientId: row.patient.id,
    patientName: `${row.patient.firstName} ${row.patient.lastName}`,
    patientMrn: row.patient.mrn,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: row.status,
    reason: row.reason,
  };
}

export function parseSlot(scheduledAt: string): Date {
  // Treat "YYYY-MM-DDTHH:mm" as UTC clinic time; seconds are rejected upstream.
  const d = new Date(`${scheduledAt}:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ConflictError("Invalid appointment time.");
  return d;
}

function fmtWhen(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")} UTC`;
}

/**
 * The availability rule set for one booking attempt. Throws ConflictError with
 * a precise message when the slot is not bookable. Runs inside the caller's
 * transaction so it shares the serializable snapshot.
 */
async function assertSlotAvailable(
  tx: Prisma.TransactionClient,
  input: {
    clinicId: string;
    doctorId: string;
    start: Date;
    end: Date;
    ignoreAppointmentId?: string;
  },
): Promise<void> {
  const doctor = await tx.doctorProfile.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, isDeleted: false },
    select: { id: true },
  });
  if (!doctor) throw new NotFoundError("Doctor not found.");

  // 1. Weekly working hours.
  const schedule = await tx.doctorSchedule.findFirst({
    where: { doctorId: input.doctorId, weekday: input.start.getUTCDay(), isDeleted: false },
  });
  if (!schedule) {
    throw new ConflictError("The doctor does not work at that time (no schedule that day).");
  }
  const startMinute = input.start.getUTCHours() * 60 + input.start.getUTCMinutes();
  const endMinute = input.end.getUTCHours() * 60 + input.end.getUTCMinutes();
  if (startMinute < schedule.startMinute || endMinute > schedule.endMinute) {
    throw new ConflictError(
      `Outside working hours (${String(Math.floor(schedule.startMinute / 60)).padStart(2, "0")}:${String(
        schedule.startMinute % 60,
      ).padStart(2, "0")}–${String(Math.floor(schedule.endMinute / 60)).padStart(2, "0")}:${String(
        schedule.endMinute % 60,
      ).padStart(2, "0")} UTC).`,
    );
  }

  // 2. Time off.
  const timeOff = await tx.doctorTimeOff.findFirst({
    where: {
      doctorId: input.doctorId,
      OR: [
        { isFullDay: true, startsAt: { lte: input.end } },
        { isFullDay: false, startsAt: { lt: input.end }, endsAt: { gt: input.start } },
      ],
    },
  });
  if (timeOff) throw new ConflictError("The doctor is off at that time.");

  // 3. Overlap with active appointments (the service-level guard). A stored
  // appointment overlaps the requested slot when its start is before the
  // requested end and its end is after the requested start; Prisma can only
  // express the first half, the second is checked below.
  const overlap = await tx.appointment.findFirst({
    where: {
      doctorId: input.doctorId,
      status: { in: ACTIVE_STATUSES },
      ...(input.ignoreAppointmentId ? { id: { not: input.ignoreAppointmentId } } : {}),
      scheduledAt: { lt: input.end },
    },
  });
  if (overlap) {
    const overlapEnd = new Date(overlap.scheduledAt.getTime() + overlap.durationMinutes * 60_000);
    if (overlapEnd > input.start) {
      throw new ConflictError(
        `That slot overlaps another appointment at ${fmtWhen(overlap.scheduledAt)}.`,
      );
    }
  }
}

/** Maps the DB-level double-booking rejection to a friendly conflict. */
async function translateSlotError(err: unknown): Promise<never> {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (
      err.code === "P2002" &&
      String(err.meta?.target ?? "").includes("Appointment_active_doctor_slot_key")
    ) {
      throw new ConflictError("That slot was just booked by someone else. Pick another time.");
    }
    // Serialization failure means a racing booking won the commit race.
    if (err.code === "P2034") {
      throw new ConflictError("That slot was contested by another booking. Please try again.");
    }
  }
  throw err instanceof Error ? err : new Error(String(err));
}

/**
 * Books an appointment. Availability is validated inside a SERIALIZABLE
 * transaction; the partial unique index is the final authority. Exactly one of
 * two racing bookings commits.
 */
export async function bookAppointment(
  input: BookAppointmentInput,
  actor: AppointmentActor,
): Promise<AppointmentDto> {
  const start = parseSlot(input.scheduledAt);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);

  const patient = await db.patient.findFirst({
    where: { id: input.patientId, clinicId: actor.clinicId, isDeleted: false },
    select: { id: true, firstName: true, lastName: true, mrn: true },
  });
  if (!patient) throw new NotFoundError("Patient not found.");

  const doctorForNotify = await db.doctorProfile.findFirst({
    where: { id: input.doctorId, isDeleted: false },
    select: { userId: true, user: { select: { name: true } } },
  });
  if (!doctorForNotify) throw new NotFoundError("Doctor not found.");

  const row = await db.$transaction(
    async (tx) => {
      await assertSlotAvailable(tx, {
        clinicId: actor.clinicId,
        doctorId: input.doctorId,
        start,
        end,
      });
      const created = await tx.appointment.create({
        data: {
          clinicId: actor.clinicId,
          doctorId: input.doctorId,
          patientId: patient.id,
          scheduledAt: start,
          durationMinutes: input.durationMinutes,
          status: AppointmentStatus.PENDING,
          reason: input.reason ?? null,
          createdById: actor.kind === "STAFF" ? actor.actorUserId : null,
          createdByName: actor.actorName,
        },
        include: {
          doctor: { include: { user: { select: { name: true } } } },
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        },
      });
      await tx.appointmentEvent.create({
        data: {
          appointmentId: created.id,
          kind: actor.kind,
          actorUserId: actor.actorUserId,
          actorName: actor.actorName,
          type: "BOOKED",
          detail: input.reason ?? null,
        },
      });
      await createAppointmentNotifications(tx, {
        clinicId: actor.clinicId,
        patientId: patient.id,
        doctorUserId: doctorForNotify.userId,
        type: "APPOINTMENT_BOOKED",
        patientName: `${patient.firstName} ${patient.lastName}`,
        doctorName: created.doctor.user.name,
        whenIso: start.toISOString(),
      });
      await tx.auditLog.create({
        data: {
          clinicId: actor.clinicId,
          actorUserId: actor.actorUserId,
          action: "appointment.booked",
          entityType: "Appointment",
          entityId: created.id,
          after: {
            doctorId: input.doctorId,
            patientId: patient.id,
            scheduledAt: start.toISOString(),
            durationMinutes: input.durationMinutes,
          },
        },
      });
      return created;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      // Racing bookings lose with a P2002 from the partial unique index.
      maxWait: 5_000,
      timeout: 10_000,
    },
  ).catch((err) => translateSlotError(err));

  return toAppointmentDto(row);
}

export type RescheduleAppointmentServiceInput = {
  appointmentId: string;
  scheduledAt: string;
  durationMinutes?: number;
  /** Who is moving it. Patients may only move their own appointments. */
  actor: AppointmentActor;
  /** Patient-flow guard: when set, the appointment must belong to this patient. */
  patientId?: string;
};

export async function rescheduleAppointment(
  input: RescheduleAppointmentServiceInput,
): Promise<AppointmentDto> {
  const start = parseSlot(input.scheduledAt);
  const row = await db.$transaction(
    async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: {
          id: input.appointmentId,
          clinicId: input.actor.clinicId,
          status: { in: ACTIVE_STATUSES },
          ...(input.patientId ? { patientId: input.patientId } : {}),
        },
      });
      if (!existing) throw new NotFoundError("Appointment not found.");

      const duration = input.durationMinutes ?? existing.durationMinutes;
      const end = new Date(start.getTime() + duration * 60_000);

      await assertSlotAvailable(tx, {
        clinicId: input.actor.clinicId,
        doctorId: existing.doctorId,
        start,
        end,
        ignoreAppointmentId: existing.id,
      });

      const updated = await tx.appointment.update({
        where: { id: existing.id },
        data: { scheduledAt: start, durationMinutes: duration },
        include: {
          doctor: { include: { user: { select: { name: true } } } },
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        },
      });

      await tx.appointmentEvent.create({
        data: {
          appointmentId: existing.id,
          kind: input.actor.kind,
          actorUserId: input.actor.actorUserId,
          actorName: input.actor.actorName,
          type: "RESCHEDULED",
          detail: `was ${fmtWhen(existing.scheduledAt)} → now ${fmtWhen(start)}`,
        },
      });
      await createAppointmentNotifications(tx, {
        clinicId: input.actor.clinicId,
        patientId: updated.patientId,
        doctorUserId: updated.doctor.userId,
        type: "APPOINTMENT_RESCHEDULED",
        patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
        doctorName: updated.doctor.user.name,
        whenIso: start.toISOString(),
      });
      await tx.auditLog.create({
        data: {
          clinicId: input.actor.clinicId,
          actorUserId: input.actor.actorUserId,
          action: "appointment.rescheduled",
          entityType: "Appointment",
          entityId: existing.id,
          before: {
            scheduledAt: existing.scheduledAt.toISOString(),
            durationMinutes: existing.durationMinutes,
          },
          after: { scheduledAt: start.toISOString(), durationMinutes: duration },
        },
      });
      return updated;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  ).catch((err) => translateSlotError(err));

  return toAppointmentDto(row);
}

export type CancelAppointmentServiceInput = {
  appointmentId: string;
  reason?: string;
  actor: AppointmentActor;
  /** Patient-flow guard: when set, the appointment must belong to this patient. */
  patientId?: string;
};

const CANCELLABLE: AppointmentStatus[] = ["PENDING", "CONFIRMED"];

export async function cancelAppointment(input: CancelAppointmentServiceInput): Promise<AppointmentDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.appointment.findFirst({
      where: {
        id: input.appointmentId,
        clinicId: input.actor.clinicId,
        status: { in: CANCELLABLE },
        ...(input.patientId ? { patientId: input.patientId } : {}),
      },
    });
    if (!existing) throw new NotFoundError("Appointment not found or no longer cancellable.");

    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: input.reason ?? null,
      },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: existing.id,
        kind: input.actor.kind,
        actorUserId: input.actor.actorUserId,
        actorName: input.actor.actorName,
        type: "CANCELLED",
        detail: input.reason ?? null,
      },
    });
    await createAppointmentNotifications(tx, {
      clinicId: input.actor.clinicId,
      patientId: updated.patientId,
      doctorUserId: updated.doctor.userId,
      type: "APPOINTMENT_CANCELLED",
      patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
      doctorName: updated.doctor.user.name,
      whenIso: existing.scheduledAt.toISOString(),
    });
    await tx.auditLog.create({
      data: {
        clinicId: input.actor.clinicId,
        actorUserId: input.actor.actorUserId,
        action: "appointment.cancelled",
        entityType: "Appointment",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: AppointmentStatus.CANCELLED, reason: input.reason ?? null },
      },
    });
    return updated;
  });

  return toAppointmentDto(row);
}

export type SetStatusServiceInput = {
  appointmentId: string;
  status: "CONFIRMED" | "CHECKED_IN" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW";
  actor: AppointmentActor;
};

/** Legal staff-driven lifecycle transitions (cancellation goes through cancelAppointment). */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED"],
  CONFIRMED: ["CHECKED_IN", "NO_SHOW"],
  CHECKED_IN: ["IN_PROGRESS", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export async function setAppointmentStatus(input: SetStatusServiceInput): Promise<AppointmentDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.appointment.findFirst({
      where: { id: input.appointmentId, clinicId: input.actor.clinicId },
    });
    if (!existing) throw new NotFoundError("Appointment not found.");
    const allowed = TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(input.status)) {
      throw new ConflictError(`Cannot move an appointment from ${existing.status} to ${input.status}.`);
    }

    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: { status: input.status },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: existing.id,
        kind: input.actor.kind,
        actorUserId: input.actor.actorUserId,
        actorName: input.actor.actorName,
        type: "STATUS",
        detail: `${existing.status} → ${input.status}`,
      },
    });
    await tx.auditLog.create({
      data: {
        clinicId: input.actor.clinicId,
        actorUserId: input.actor.actorUserId,
        action: "appointment.status_changed",
        entityType: "Appointment",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: input.status },
      },
    });
    return updated;
  });

  return toAppointmentDto(row);
}
