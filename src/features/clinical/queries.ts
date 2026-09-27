import "server-only";

import { EncounterStatus, type Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  toEncounterDto,
  toNoteDto,
  toVitalsDto,
  type ClinicalNoteDto,
  type EncounterDto,
  type VitalsDto,
} from "@/features/clinical/service";

const encounterInclude = {
  doctor: { include: { user: { select: { name: true } } } },
} satisfies Prisma.EncounterInclude;

export type EncounterListRow = EncounterDto & { noteCount: number; hasVitals: boolean };

/** Clinic-scoped encounter timeline for one patient, newest first. */
export async function listEncountersForPatient(
  clinicId: string,
  patientId: string,
  limit = 50,
): Promise<EncounterListRow[]> {
  const rows = await db.encounter.findMany({
    where: { clinicId, patientId },
    include: { ...encounterInclude, _count: { select: { notes: true, vitals: true } } },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    ...toEncounterDto(row),
    noteCount: row._count.notes,
    hasVitals: row._count.vitals > 0,
  }));
}

/** One encounter with its append-only notes and vitals, clinic-scoped. */
export async function getEncounterForClinic(
  clinicId: string,
  encounterId: string,
): Promise<{ encounter: EncounterDto; notes: ClinicalNoteDto[]; vitals: VitalsDto[] } | null> {
  const row = await db.encounter.findFirst({
    where: { id: encounterId, clinicId },
    include: {
      ...encounterInclude,
      notes: { orderBy: { createdAt: "asc" } },
      vitals: { orderBy: { recordedAt: "asc" } },
    },
  });
  if (!row) return null;
  return {
    encounter: toEncounterDto(row),
    notes: row.notes.map(toNoteDto),
    vitals: row.vitals.map(toVitalsDto),
  };
}

/** Latest observation sets for one patient (chart history strip). */
export async function listVitalsForPatient(
  clinicId: string,
  patientId: string,
  limit = 20,
): Promise<VitalsDto[]> {
  const rows = await db.vital.findMany({
    where: { clinicId, patientId },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
  return rows.map(toVitalsDto);
}

/** Recent notes on the patient record (including encounter addenda). */
export async function listNotesForPatient(
  clinicId: string,
  patientId: string,
  limit = 20,
): Promise<ClinicalNoteDto[]> {
  const rows = await db.clinicalNote.findMany({
    where: { clinicId, patientId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toNoteDto);
}

export type PortalEncounterRow = {
  id: string;
  occurredAt: string;
  kind: string;
  doctorName: string | null;
  diagnosis: string | null;
  plan: string | null;
};

export type PortalClinicalSummary = {
  encounters: PortalEncounterRow[];
  vitals: VitalsDto[];
};

/**
 * Portal view of one patient's own clinical record. Scoped by patientId alone
 * because the caller resolves that id from the signed-in account — there is no
 * parameter by which another patient could be addressed. Only SIGNED encounters
 * are exposed: an unsigned record is still being written.
 */
export async function listPortalClinicalSummary(
  patientId: string,
  limit = 10,
): Promise<PortalClinicalSummary> {
  const [encounters, vitals] = await Promise.all([
    db.encounter.findMany({
      where: { patientId, status: EncounterStatus.SIGNED },
      include: encounterInclude,
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    db.vital.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: limit }),
  ]);

  return {
    encounters: encounters.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      kind: e.kind,
      doctorName: e.doctor?.user.name ?? null,
      diagnosis: e.diagnosis,
      plan: e.plan,
    })),
    vitals: vitals.map(toVitalsDto),
  };
}
