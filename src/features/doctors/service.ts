/**
 * Doctor profile + schedule services. All writes are transactional with their
 * AuditLog rows; every read is clinic-scoped by the caller.
 */
import { Prisma, type DoctorSchedule } from "@prisma/client";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";
import { formatZoned, zonedTimeToInstant } from "@/lib/timezone";

export type UpsertDoctorProfileInput = {
  clinicId: string;
  actorUserId: string;
  userId: string;
  specialization: string;
  bio?: string;
  licenseNo?: string;
};

export type DoctorDto = {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialization: string;
  bio: string | null;
  licenseNo: string | null;
};

function toDoctorDto(
  profile: {
    id: string;
    userId: string;
    specialization: string;
    bio: string | null;
    licenseNo: string | null;
    user: { name: string; email: string };
  },
): DoctorDto {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.user.name,
    email: profile.user.email,
    specialization: profile.specialization,
    bio: profile.bio,
    licenseNo: profile.licenseNo,
  };
}

/**
 * Creates (or revives) the single doctor profile for a staff member. The user
 * must hold an active non-patient membership in the acting clinic.
 */
export async function upsertDoctorProfile(input: UpsertDoctorProfileInput): Promise<DoctorDto> {
  const membership = await db.membership.findFirst({
    where: { userId: input.userId, clinicId: input.clinicId, role: "DOCTOR" },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!membership || !membership.user.isActive) {
    throw new NotFoundError("Only an active doctor-role staff member can get a doctor profile.");
  }

  const doctor = await db.$transaction(async (tx) => {
    const existing = await tx.doctorProfile.findUnique({ where: { userId: input.userId } });
    if (existing && existing.clinicId !== input.clinicId) {
      throw new ConflictError("This staff member already has a doctor profile in another clinic.");
    }

    const data = {
      clinicId: input.clinicId,
      specialization: input.specialization,
      bio: input.bio ?? null,
      licenseNo: input.licenseNo ?? null,
      isDeleted: false,
    };
    const row = existing
      ? await tx.doctorProfile.update({ where: { userId: input.userId }, data, include: { user: true } })
      : await tx.doctorProfile.create({
          data: { userId: input.userId, ...data },
          include: { user: true },
        });

    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        action: existing ? "doctor.updated" : "doctor.created",
        entityType: "DoctorProfile",
        entityId: row.id,
        before: existing
          ? { specialization: existing.specialization, isDeleted: existing.isDeleted }
          : undefined,
        after: { specialization: row.specialization, userId: row.userId },
      },
    });
    return row;
  });

  return toDoctorDto(doctor);
}

export type UpsertDoctorScheduleInput = {
  clinicId: string;
  actorUserId: string;
  doctorId: string;
  /** Empty array clears the week (doctor unavailable until re-added). */
  rows: Array<{ weekday: number; startMinute: number; endMinute: number; slotMinutes: number }>;
};

/**
 * Replaces the whole weekly schedule in one transaction. Appointments are NOT
 * re-validated against the new schedule: existing bookings stand (staff can
 * cancel them); only NEW bookings must fit the updated availability.
 */
export async function upsertDoctorSchedule(input: UpsertDoctorScheduleInput): Promise<DoctorSchedule[]> {
  const doctor = await db.doctorProfile.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, isDeleted: false },
    select: { id: true },
  });
  if (!doctor) throw new NotFoundError("Doctor not found.");

  return db.$transaction(
    async (tx) => {
      await tx.doctorSchedule.updateMany({
        where: { doctorId: input.doctorId, isDeleted: false },
        data: { isDeleted: true },
      });
      if (input.rows.length > 0) {
        await tx.doctorSchedule.createMany({
          data: input.rows.map((row) => ({ doctorId: input.doctorId, ...row })),
        });
      }
      await tx.auditLog.create({
        data: {
          clinicId: input.clinicId,
          actorUserId: input.actorUserId,
          action: "doctor.schedule_updated",
          entityType: "DoctorSchedule",
          entityId: input.doctorId,
          after: {
            rows: input.rows.map((r) => `${r.weekday}:${r.startMinute}-${r.endMinute}/${r.slotMinutes}`),
          },
        },
      });
      return tx.doctorSchedule.findMany({
        where: { doctorId: input.doctorId, isDeleted: false },
        orderBy: { weekday: "asc" },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** One doctor (clinic-scoped) with their active weekly schedule. */
export async function getDoctorForClinic(clinicId: string, doctorId: string) {
  return db.doctorProfile.findFirst({
    where: { id: doctorId, clinicId, isDeleted: false },
    include: {
      user: { select: { name: true, email: true } },
      schedules: { where: { isDeleted: false }, orderBy: { weekday: "asc" } },
    },
  });
}

export type DoctorTimeOffDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  isFullDay: boolean;
};

export type AddTimeOffInput = {
  clinicId: string;
  actorUserId: string;
  doctorId: string;
  /** Clinic-local date `YYYY-MM-DD`. */
  date: string;
  /** Clinic-local `HH:MM`; ignored for full days. */
  startTime?: string;
  endTime?: string;
  isFullDay: boolean;
  reason?: string;
};

function toTimeOffDto(row: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  isFullDay: boolean;
}): DoctorTimeOffDto {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    isFullDay: row.isFullDay,
  };
}

function parseClock(value: string, timeZone: string, date: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new ConflictError(`Invalid time "${value}" (${timeZone}, ${date}).`);
  }
  return { hour: h!, minute: m! };
}

/**
 * Records an absence (full day or a local window). Booking validation consults
 * these rows, so adding them immediately blocks new bookings in the window.
 */
export async function addDoctorTimeOff(input: AddTimeOffInput): Promise<DoctorTimeOffDto> {
  const [doctor, clinic] = await Promise.all([
    db.doctorProfile.findFirst({
      where: { id: input.doctorId, clinicId: input.clinicId, isDeleted: false },
      select: { id: true },
    }),
    db.clinic.findUnique({ where: { id: input.clinicId }, select: { timezone: true } }),
  ]);
  if (!doctor) throw new NotFoundError("Doctor not found.");
  if (!clinic) throw new NotFoundError("Clinic not found.");

  const [year, month, day] = input.date.split("-").map(Number);
  if (![year, month, day].every((n) => Number.isFinite(n))) {
    throw new ConflictError("Invalid date.");
  }

  let startsAt: Date;
  let endsAt: Date;
  if (input.isFullDay) {
    startsAt = zonedTimeToInstant({ year: year!, month: month!, day: day!, hour: 0, minute: 0 }, clinic.timezone);
    endsAt = zonedTimeToInstant({ year: year!, month: month!, day: day! + 1, hour: 0, minute: 0 }, clinic.timezone);
  } else {
    if (!input.startTime || !input.endTime) {
      throw new ConflictError("Provide a start and end time for a partial absence.");
    }
    const from = parseClock(input.startTime, clinic.timezone, input.date);
    const to = parseClock(input.endTime, clinic.timezone, input.date);
    if (from.hour * 60 + from.minute >= to.hour * 60 + to.minute) {
      throw new ConflictError("End time must be after the start time.");
    }
    startsAt = zonedTimeToInstant({ year: year!, month: month!, day: day!, ...from }, clinic.timezone);
    endsAt = zonedTimeToInstant({ year: year!, month: month!, day: day!, ...to }, clinic.timezone);
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.doctorTimeOff.create({
      data: {
        doctorId: input.doctorId,
        startsAt,
        endsAt,
        isFullDay: input.isFullDay,
        reason: input.reason ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        action: "doctor.timeoff_added",
        entityType: "DoctorTimeOff",
        entityId: created.id,
        after: {
          doctorId: input.doctorId,
          // Rendered in clinic-local time so an auditor reads plain wall clock.
          window: `${formatZoned(startsAt, clinic.timezone)} → ${formatZoned(endsAt, clinic.timezone)} (${clinic.timezone})`,
          reason: input.reason ?? null,
        },
      },
    });
    return created;
  });

  return toTimeOffDto(row);
}

/** Removes an absence; bookings in the window become possible again. */
export async function removeDoctorTimeOff(input: {
  clinicId: string;
  actorUserId: string;
  timeOffId: string;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.doctorTimeOff.findFirst({
      where: { id: input.timeOffId, doctor: { clinicId: input.clinicId, isDeleted: false } },
    });
    if (!existing) throw new NotFoundError("Absence not found.");

    await tx.doctorTimeOff.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        action: "doctor.timeoff_removed",
        entityType: "DoctorTimeOff",
        entityId: existing.id,
        before: { doctorId: existing.doctorId, startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString() },
      },
    });
  });
}

/** Resolves the doctor profile behind a portal/staff login, if any. */
export async function getDoctorProfileForUser(userId: string) {
  return db.doctorProfile.findFirst({
    where: { userId, isDeleted: false },
    include: {
      user: { select: { name: true, email: true } },
      schedules: { where: { isDeleted: false }, orderBy: { weekday: "asc" } },
    },
  });
}
