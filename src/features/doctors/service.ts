/**
 * Doctor profile + schedule services. All writes are transactional with their
 * AuditLog rows; every read is clinic-scoped by the caller.
 */
import { Prisma, type DoctorSchedule } from "@prisma/client";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";

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
    where: { userId: input.userId, clinicId: input.clinicId, role: { not: "PATIENT" } },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!membership || !membership.user.isActive) {
    throw new NotFoundError("Staff member not found in this clinic.");
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
