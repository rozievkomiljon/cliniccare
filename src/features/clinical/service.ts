/**
 * Clinical record services (Phase 4). Every write is transactional with its
 * AuditLog row, and clinical data is append-only by construction:
 *
 *  - an Encounter is editable only while OPEN; signing locks the field set, so
 *    a correction after signing has to arrive as a ClinicalNote addendum;
 *  - notes and vitals are write-once — there is no update or delete path.
 *
 * Audit rows carry METADATA only (which fields changed, how long a note is),
 * never clinical values: the audit log is broadly readable and PHI-safe logging
 * is a project rule.
 */
import { ClinicalNoteKind, EncounterKind, EncounterStatus, type Prisma } from "@prisma/client";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";
import { parseLocalDateTime } from "@/lib/timezone";
import { getClinicTimeZone } from "@/features/doctors/queries";
import type {
  AddClinicalNoteInput,
  OpenEncounterInput,
  RecordVitalsInput,
  SignEncounterInput,
  UpdateEncounterInput,
} from "@/features/clinical/schemas";

/** The acting staff member's clinic scope. Row scoping is enforced by callers. */
export type ClinicalActor = {
  clinicId: string;
  actorUserId: string;
  actorName: string;
};

export type EncounterDto = {
  id: string;
  patientId: string;
  doctorId: string | null;
  doctorName: string | null;
  appointmentId: string | null;
  occurredAt: string;
  kind: EncounterKind;
  chiefComplaint: string | null;
  diagnosis: string | null;
  plan: string | null;
  status: EncounterStatus;
  signedAt: string | null;
  signedByName: string | null;
  createdByName: string;
  createdAt: string;
};

export type ClinicalNoteDto = {
  id: string;
  patientId: string;
  encounterId: string | null;
  kind: ClinicalNoteKind;
  body: string;
  authorName: string;
  createdAt: string;
};

export type VitalsDto = {
  id: string;
  patientId: string;
  encounterId: string | null;
  recordedAt: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  weightKg: number | null;
  heightCm: number | null;
  notes: string | null;
  recordedByName: string;
};

const encounterInclude = {
  doctor: { include: { user: { select: { name: true } } } },
} satisfies Prisma.EncounterInclude;

type EncounterRow = Prisma.EncounterGetPayload<{ include: typeof encounterInclude }>;

export function toEncounterDto(row: EncounterRow): EncounterDto {
  return {
    id: row.id,
    patientId: row.patientId,
    doctorId: row.doctorId,
    doctorName: row.doctor?.user.name ?? null,
    appointmentId: row.appointmentId,
    occurredAt: row.occurredAt.toISOString(),
    kind: row.kind,
    chiefComplaint: row.chiefComplaint,
    diagnosis: row.diagnosis,
    plan: row.plan,
    status: row.status,
    signedAt: row.signedAt?.toISOString() ?? null,
    signedByName: row.signedByName,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNoteDto(row: {
  id: string;
  patientId: string;
  encounterId: string | null;
  kind: ClinicalNoteKind;
  body: string;
  authorName: string;
  createdAt: Date;
}): ClinicalNoteDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    kind: row.kind,
    body: row.body,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toVitalsDto(row: {
  id: string;
  patientId: string;
  encounterId: string | null;
  recordedAt: Date;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  weightKg: number | null;
  heightCm: number | null;
  notes: string | null;
  recordedByName: string;
}): VitalsDto {
  return {
    id: row.id,
    patientId: row.patientId,
    encounterId: row.encounterId,
    recordedAt: row.recordedAt.toISOString(),
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse,
    temperature: row.temperature,
    spo2: row.spo2,
    weightKg: row.weightKg,
    heightCm: row.heightCm,
    notes: row.notes,
    recordedByName: row.recordedByName,
  };
}

/** The patient must exist and belong to the acting clinic. */
async function requirePatient(clinicId: string, patientId: string): Promise<void> {
  const patient = await db.patient.findFirst({
    where: { id: patientId, clinicId, isDeleted: false },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError("Patient not found.");
}

/**
 * Creates the clinical record for a visit. The encounter starts OPEN: the
 * author may still correct it until it is signed.
 */
export async function openEncounter(input: OpenEncounterInput, actor: ClinicalActor): Promise<EncounterDto> {
  await requirePatient(actor.clinicId, input.patientId);

  const timeZone = await getClinicTimeZone(actor.clinicId);
  const occurredAt = parseLocalDateTime(input.occurredAt, timeZone);
  if (!occurredAt) throw new ConflictError("Invalid encounter time.");

  const doctorId = input.doctorId || null;
  if (doctorId) {
    const doctor = await db.doctorProfile.findFirst({
      where: { id: doctorId, clinicId: actor.clinicId, isDeleted: false },
      select: { id: true },
    });
    if (!doctor) throw new NotFoundError("Doctor not found.");
  }

  const appointmentId = input.appointmentId || null;
  if (appointmentId) {
    const appointment = await db.appointment.findFirst({
      where: { id: appointmentId, clinicId: actor.clinicId, patientId: input.patientId },
      select: { id: true },
    });
    if (!appointment) throw new NotFoundError("Appointment not found for this patient.");
    const existing = await db.encounter.findUnique({ where: { appointmentId }, select: { id: true } });
    if (existing) throw new ConflictError("That appointment already has a clinical record.");
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.encounter.create({
      data: {
        clinicId: actor.clinicId,
        patientId: input.patientId,
        doctorId,
        appointmentId,
        occurredAt,
        kind: input.kind,
        chiefComplaint: input.chiefComplaint ?? null,
        createdById: actor.actorUserId,
        createdByName: actor.actorName,
      },
      include: encounterInclude,
    });
    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "clinical.encounter_opened",
        entityType: "Encounter",
        entityId: created.id,
        after: {
          patientId: input.patientId,
          doctorId,
          appointmentId,
          kind: input.kind,
          occurredAt: occurredAt.toISOString(),
        },
      },
    });
    return created;
  });

  return toEncounterDto(row);
}

/** Corrects an OPEN encounter. Signed records reject the change outright. */
export async function updateEncounterDraft(
  input: UpdateEncounterInput,
  actor: ClinicalActor,
): Promise<EncounterDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.encounter.findFirst({
      where: { id: input.encounterId, clinicId: actor.clinicId },
    });
    if (!existing) throw new NotFoundError("Encounter not found.");
    if (existing.status === EncounterStatus.SIGNED) {
      throw new ConflictError("A signed encounter cannot be edited — add an addendum note instead.");
    }

    const updated = await tx.encounter.update({
      where: { id: existing.id },
      data: {
        chiefComplaint: input.chiefComplaint ?? null,
        diagnosis: input.diagnosis ?? null,
        plan: input.plan ?? null,
      },
      include: encounterInclude,
    });

    // Field names only: the audit log must not become a second copy of the chart.
    const changedFields = (["chiefComplaint", "diagnosis", "plan"] as const).filter(
      (key) => (existing[key] ?? null) !== (updated[key] ?? null),
    );
    if (changedFields.length > 0) {
      await tx.auditLog.create({
        data: {
          clinicId: actor.clinicId,
          actorUserId: actor.actorUserId,
          action: "clinical.encounter_updated",
          entityType: "Encounter",
          entityId: existing.id,
          after: { changedFields },
        },
      });
    }
    return updated;
  });

  return toEncounterDto(row);
}

/** Signs an encounter. One-way: the transition is what makes the record final. */
export async function signEncounter(input: SignEncounterInput, actor: ClinicalActor): Promise<EncounterDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.encounter.findFirst({
      where: { id: input.encounterId, clinicId: actor.clinicId },
    });
    if (!existing) throw new NotFoundError("Encounter not found.");
    if (existing.status === EncounterStatus.SIGNED) {
      throw new ConflictError("This encounter is already signed.");
    }

    const signed = await tx.encounter.update({
      where: { id: existing.id },
      data: {
        status: EncounterStatus.SIGNED,
        signedAt: new Date(),
        signedByUserId: actor.actorUserId,
        signedByName: actor.actorName,
      },
      include: encounterInclude,
    });
    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "clinical.encounter_signed",
        entityType: "Encounter",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: signed.status, kind: signed.kind },
      },
    });
    return signed;
  });

  return toEncounterDto(row);
}

/**
 * Appends a note. Notes are never updated or deleted, so a correction after
 * signing is an ADDENDUM row rather than an edit of history.
 */
export async function addClinicalNote(
  input: AddClinicalNoteInput,
  actor: ClinicalActor,
): Promise<ClinicalNoteDto> {
  await requirePatient(actor.clinicId, input.patientId);

  const encounterId = input.encounterId || null;
  if (encounterId) {
    const encounter = await db.encounter.findFirst({
      where: { id: encounterId, clinicId: actor.clinicId, patientId: input.patientId },
      select: { id: true },
    });
    if (!encounter) throw new NotFoundError("Encounter not found for this patient.");
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.clinicalNote.create({
      data: {
        clinicId: actor.clinicId,
        patientId: input.patientId,
        encounterId,
        kind: input.kind,
        body: input.body,
        authorUserId: actor.actorUserId,
        authorName: actor.actorName,
      },
    });
    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "clinical.note_added",
        entityType: "ClinicalNote",
        entityId: created.id,
        // The note body is PHI: the audit trail records its shape, not its text.
        after: { patientId: input.patientId, encounterId, kind: input.kind, characters: input.body.length },
      },
    });
    return created;
  });

  return toNoteDto(row);
}

const VITAL_FIELDS = [
  "systolic",
  "diastolic",
  "pulse",
  "temperature",
  "spo2",
  "weightKg",
  "heightCm",
] as const;

/** Appends one observation set (nurses hold `vitals:record`, not `clinical:author`). */
export async function recordVitals(input: RecordVitalsInput, actor: ClinicalActor): Promise<VitalsDto> {
  await requirePatient(actor.clinicId, input.patientId);

  const encounterId = input.encounterId || null;
  if (encounterId) {
    const encounter = await db.encounter.findFirst({
      where: { id: encounterId, clinicId: actor.clinicId, patientId: input.patientId },
      select: { id: true },
    });
    if (!encounter) throw new NotFoundError("Encounter not found for this patient.");
  }

  const recorded = VITAL_FIELDS.filter((field) => input[field] !== undefined);

  const row = await db.$transaction(async (tx) => {
    const created = await tx.vital.create({
      data: {
        clinicId: actor.clinicId,
        patientId: input.patientId,
        encounterId,
        systolic: input.systolic ?? null,
        diastolic: input.diastolic ?? null,
        pulse: input.pulse ?? null,
        temperature: input.temperature ?? null,
        spo2: input.spo2 ?? null,
        weightKg: input.weightKg ?? null,
        heightCm: input.heightCm ?? null,
        notes: input.notes ?? null,
        recordedById: actor.actorUserId,
        recordedByName: actor.actorName,
      },
    });
    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "clinical.vitals_recorded",
        entityType: "Vital",
        entityId: created.id,
        // Which measurements were taken — the values themselves are PHI.
        after: { patientId: input.patientId, encounterId, fields: recorded },
      },
    });
    return created;
  });

  return toVitalsDto(row);
}
