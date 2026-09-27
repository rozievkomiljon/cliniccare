"use server";

/**
 * Patient Server Actions. Zod at the boundary, requirePermission for the
 * guard, transactional services (which write the audit rows), ActionResult
 * envelopes out. Clinic scoping always comes from the session.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createPatientSchema,
  deleteAttachmentSchema,
  updatePatientSchema,
} from "@/features/patients/schemas";
import {
  deleteAttachment,
  registerPatient,
  softDeletePatient,
  updatePatient,
  type PatientDto,
} from "@/features/patients/service";
import { withAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";

export const createPatientAction = withAction(createPatientSchema, async (input): Promise<PatientDto> => {
  const session = await requirePermission("patients:manage");
  const patient = await registerPatient({
    ...input,
    clinicId: session.activeClinicId ?? "",
    actorUserId: session.user.id,
  });
  revalidatePath("/patients");
  return patient;
});

export const updatePatientAction = withAction(updatePatientSchema, async (input): Promise<PatientDto> => {
  const session = await requirePermission("patients:manage");
  const { patientId, dateOfBirth, ...data } = input;
  const result = await db.$transaction(async (tx) =>
    updatePatient(tx, {
      patientId,
      clinicId: session.activeClinicId ?? "",
      actorUserId: session.user.id,
      dateOfBirth,
      data: data as Record<string, unknown>,
    }),
  );
  revalidatePath(`/patients/${patientId}`);
  return result;
});

export const deletePatientAction = withAction(
  z.object({ patientId: z.string().min(1) }),
  async (input): Promise<{ deleted: true }> => {
    const session = await requirePermission("patients:manage");
    await db.$transaction(async (tx) =>
      softDeletePatient(tx, {
        patientId: input.patientId,
        clinicId: session.activeClinicId ?? "",
        actorUserId: session.user.id,
      }),
    );
    revalidatePath("/patients");
    return { deleted: true };
  },
);

export const deleteAttachmentAction = withAction(
  deleteAttachmentSchema,
  async (input): Promise<{ deleted: true }> => {
    const session = await requirePermission("patients:manage");
    await db.$transaction(async (tx) =>
      deleteAttachment(tx, {
        attachmentId: input.attachmentId,
        clinicId: session.activeClinicId ?? "",
        actorUserId: session.user.id,
      }),
    );
    revalidatePath("/patients");
    return { deleted: true };
  },
);
