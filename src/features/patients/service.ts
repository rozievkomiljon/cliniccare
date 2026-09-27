/**
 * Patient services — all writes are transactional with their AuditLog rows and
 * every read is clinic-scoped by the caller (guard-derived), never by client
 * input. MRNs are generated server-side per clinic: P-YYYY-XXXXX.
 */
import { Prisma, type Sex, type BloodGroup } from "@prisma/client";

import { deletePatientDocument, putPatientDocument, buildStorageKey } from "@/lib/files";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";

export type RegisterPatientInput = {
  clinicId: string;
  actorUserId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  sex: Sex;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  bloodGroup?: BloodGroup;
  allergies?: string;
  chronicConditions?: string;
  notes?: string;
};

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Patient payload safe to hand to the UI (no internal fields). */
export function toPatientDto(p: {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  sex: Sex;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bloodGroup: BloodGroup | null;
  allergies: string | null;
  chronicConditions: string | null;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    mrn: p.mrn,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
    sex: p.sex,
    phone: p.phone,
    email: p.email,
    address: p.address,
    city: p.city,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: p.emergencyContactPhone,
    bloodGroup: p.bloodGroup,
    allergies: p.allergies,
    chronicConditions: p.chronicConditions,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  };
}

export type PatientDto = ReturnType<typeof toPatientDto>;

/**
 * Generates the next MRN for a clinic: P-YYYY-NNNNN. Uses MAX(mrn) within a
 * serialized transaction so two concurrent registrations cannot collide.
 */
export async function nextMrn(tx: Prisma.TransactionClient, clinicId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `P-${year}-`;
  const rows = await tx.$queryRaw<Array<{ mrn: string }>>`
    SELECT "mrn" FROM "Patient"
    WHERE "clinicId" = ${clinicId} AND "mrn" LIKE ${`${prefix}%`}
    ORDER BY "mrn" DESC
    LIMIT 1
  `;
  const last = rows[0]?.mrn;
  const nextSeq = last ? Number(last.slice(prefix.length)) + 1 : 1;
  if (!Number.isFinite(nextSeq)) throw new ConflictError("Could not generate a medical record number.");
  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

export async function registerPatient(input: RegisterPatientInput): Promise<PatientDto> {
  const patient = await db.$transaction(
    async (tx) => {
      const mrn = await nextMrn(tx, input.clinicId);
      const created = await tx.patient.create({
        data: {
          clinicId: input.clinicId,
          mrn,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: toDateOnly(input.dateOfBirth),
          sex: input.sex,
          phone: input.phone,
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          bloodGroup: input.bloodGroup ?? null,
          allergies: input.allergies ?? null,
          chronicConditions: input.chronicConditions ?? null,
          notes: input.notes ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          clinicId: input.clinicId,
          actorUserId: input.actorUserId,
          action: "patient.registered",
          entityType: "Patient",
          entityId: created.id,
          after: { mrn, name: `${input.firstName} ${input.lastName}` },
        },
      });
      return created;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return toPatientDto(patient);
}

const EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "sex",
  "phone",
  "email",
  "address",
  "city",
  "emergencyContactName",
  "emergencyContactPhone",
  "bloodGroup",
  "allergies",
  "chronicConditions",
  "notes",
] as const;

export async function updatePatient(
  tx: Prisma.TransactionClient,
  input: {
    patientId: string;
    clinicId: string;
    actorUserId: string;
    dateOfBirth?: string;
    data: Record<string, unknown>;
  },
): Promise<PatientDto> {
  const existing = await tx.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, isDeleted: false },
  });
  if (!existing) throw new NotFoundError("Patient not found.");

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in input.data) patch[field] = input.data[field] ?? null;
  }
  if (input.dateOfBirth) patch.dateOfBirth = toDateOnly(input.dateOfBirth);
  if (Object.keys(patch).length === 0) return toPatientDto(existing);

  const updated = await tx.patient.update({
    where: { id: existing.id },
    data: patch,
  });

  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: "patient.updated",
      entityType: "Patient",
      entityId: existing.id,
      before: Object.fromEntries(
        Object.keys(patch).map((k) => [k, k === "dateOfBirth" ? existing.dateOfBirth.toISOString().slice(0, 10) : (existing as unknown as Record<string, unknown>)[k]]),
      ) as Prisma.InputJsonValue,
      after: Object.fromEntries(
        Object.keys(patch).map((k) => [k, k === "dateOfBirth" ? patch.dateOfBirth : patch[k]]),
      ) as Prisma.InputJsonValue,
    },
  });

  return toPatientDto(updated);
}

/** Soft-deletes a patient (registry row stays for audit/history). */
export async function softDeletePatient(
  tx: Prisma.TransactionClient,
  input: { patientId: string; clinicId: string; actorUserId: string },
): Promise<void> {
  const existing = await tx.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, isDeleted: false },
  });
  if (!existing) throw new NotFoundError("Patient not found.");

  await tx.patient.update({ where: { id: existing.id }, data: { isDeleted: true } });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: "patient.deleted",
      entityType: "Patient",
      entityId: existing.id,
      before: { mrn: existing.mrn },
    },
  });
}

export type UploadAttachmentInput = {
  clinicId: string;
  patientId: string;
  actorUserId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  description?: string;
};

export async function uploadAttachment(
  input: UploadAttachmentInput,
): Promise<{ id: string; fileName: string; sizeBytes: number }> {
  const { validateUpload } = await import("@/lib/files");
  const validation = validateUpload(input.fileName, input.contentType, input.body.length);
  if (!validation.ok) throw new ConflictError(validation.error);

  const patient = await db.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, isDeleted: false },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError("Patient not found.");

  const key = buildStorageKey(input.clinicId, input.patientId, validation.ext);
  await putPatientDocument(key, input.body, input.contentType || validation.ext);

  const attachment = await db.$transaction(async (tx) => {
    const row = await tx.attachment.create({
      data: {
        clinicId: input.clinicId,
        patientId: input.patientId,
        storageKey: key,
        fileName: validation.safeName,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        description: input.description ?? null,
        uploadedById: input.actorUserId,
      },
    });
    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        action: "attachment.uploaded",
        entityType: "Attachment",
        entityId: row.id,
        after: { patientId: input.patientId, fileName: validation.safeName, sizeBytes: input.body.length },
      },
    });
    return row;
  });

  return { id: attachment.id, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes };
}

/** Loads attachment metadata after an RBAC check; bytes stream via the route handler. */
export async function getAttachmentForDownload(
  attachmentId: string,
  clinicId: string,
): Promise<{ storageKey: string; fileName: string; contentType: string } | null> {
  const row = await db.attachment.findFirst({
    where: { id: attachmentId, clinicId, isDeleted: false },
    select: { storageKey: true, fileName: true, contentType: true },
  });
  return row ?? null;
}

export async function deleteAttachment(
  tx: Prisma.TransactionClient,
  input: { attachmentId: string; clinicId: string; actorUserId: string },
): Promise<void> {
  const existing = await tx.attachment.findFirst({
    where: { id: input.attachmentId, clinicId: input.clinicId, isDeleted: false },
  });
  if (!existing) throw new NotFoundError("Document not found.");

  await tx.attachment.update({ where: { id: existing.id }, data: { isDeleted: true } });
  await tx.auditLog.create({
    data: {
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      action: "attachment.deleted",
      entityType: "Attachment",
      entityId: existing.id,
      before: { fileName: existing.fileName, patientId: existing.patientId },
    },
  });

  // Bytes are removed outside the transaction; failure leaves an orphaned
  // object but never an inconsistent DB row.
  await deletePatientDocument(existing.storageKey).catch(() => undefined);
}
