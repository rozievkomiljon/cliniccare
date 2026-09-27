"use server";

/**
 * Clinical Server Actions. `clinical:author` guards the record itself
 * (encounters, signing, notes); `vitals:record` guards observations, which
 * nurses take without authoring the chart.
 */
import { revalidatePath } from "next/cache";

import {
  addClinicalNoteSchema,
  openEncounterSchema,
  recordVitalsSchema,
  signEncounterSchema,
  updateEncounterSchema,
} from "@/features/clinical/schemas";
import {
  addClinicalNote,
  openEncounter,
  recordVitals,
  signEncounter,
  updateEncounterDraft,
  type ClinicalActor,
  type ClinicalNoteDto,
  type EncounterDto,
  type VitalsDto,
} from "@/features/clinical/service";
import { withAction } from "@/lib/actions";
import { requirePermission } from "@/lib/rbac/guard";

/** The acting clinician, scoped to their active clinic. */
async function authorActor(): Promise<ClinicalActor> {
  const session = await requirePermission("clinical:author");
  return {
    clinicId: session.activeClinicId ?? "",
    actorUserId: session.user.id,
    actorName: session.user.name,
  };
}

function touch(patientId: string): void {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/portal");
}

export const openEncounterAction = withAction(
  openEncounterSchema,
  async (input): Promise<EncounterDto> => {
    const actor = await authorActor();
    const encounter = await openEncounter(input, actor);
    touch(input.patientId);
    return encounter;
  },
);

export const updateEncounterDraftAction = withAction(
  updateEncounterSchema,
  async (input): Promise<EncounterDto> => {
    const actor = await authorActor();
    const encounter = await updateEncounterDraft(input, actor);
    touch(encounter.patientId);
    return encounter;
  },
);

export const signEncounterAction = withAction(
  signEncounterSchema,
  async (input): Promise<EncounterDto> => {
    const actor = await authorActor();
    const encounter = await signEncounter(input, actor);
    touch(encounter.patientId);
    return encounter;
  },
);

export const addClinicalNoteAction = withAction(
  addClinicalNoteSchema,
  async (input): Promise<ClinicalNoteDto> => {
    const actor = await authorActor();
    const note = await addClinicalNote(input, actor);
    touch(input.patientId);
    return note;
  },
);

export const recordVitalsAction = withAction(
  recordVitalsSchema,
  async (input): Promise<VitalsDto> => {
    const session = await requirePermission("vitals:record");
    const vitals = await recordVitals(input, {
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
      actorName: session.user.name,
    });
    touch(input.patientId);
    return vitals;
  },
);
