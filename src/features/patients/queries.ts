import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

const PAGE_SIZE = 20;

export type PatientListRow = {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  phone: string | null;
  city: string | null;
};

/** Clinic-scoped, searchable, paginated patient list. */
export async function listPatients(
  clinicId: string,
  opts: { query?: string; page?: number } = {},
): Promise<{ rows: PatientListRow[]; total: number; page: number; pageCount: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.query?.trim();

  const where: Prisma.PatientWhereInput = {
    clinicId,
    isDeleted: false,
    ...(q
      ? {
          OR: [
            { mrn: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.patient.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        sex: true,
        phone: true,
        city: true,
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.patient.count({ where }),
  ]);

  return {
    rows: rows.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
      sex: p.sex,
      phone: p.phone,
      city: p.city,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getPatientForClinic(clinicId: string, patientId: string) {
  return db.patient.findFirst({
    where: { id: patientId, clinicId, isDeleted: false },
    include: {
      attachments: {
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });
}

/** Resolves the patient record a portal account may access (own data only). */
export async function getPatientForPortalUser(userId: string) {
  const account = await db.patientAccount.findUnique({
    where: { userId },
    include: {
      patient: {
        include: {
          attachments: {
            where: { isDeleted: false },
            orderBy: { createdAt: "desc" },
            include: { uploadedBy: { select: { name: true } } },
          },
        },
      },
    },
  });
  return account?.patient ?? null;
}
