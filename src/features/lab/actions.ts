"use server";

/**
 * Laboratory Server Actions. The permission split follows the RBAC matrix:
 * `lab:catalog` maintains tests, `lab:order` raises and cancels requests,
 * `lab:collect` runs the bench (collection + results) and `lab:verify` releases
 * a completed order — the doctor's sign-off.
 */
import { revalidatePath } from "next/cache";

import {
  cancelLabOrder,
  collectLabOrderSample,
  deactivateLabTest,
  enterLabResults,
  placeLabOrder,
  upsertLabTest,
  verifyLabOrder,
  type LabActor,
  type LabOrderDto,
  type LabTestDto,
} from "@/features/lab/service";
import {
  cancelLabOrderSchema,
  collectLabOrderSchema,
  deactivateLabTestSchema,
  enterLabResultsSchema,
  placeLabOrderSchema,
  upsertLabTestSchema,
  verifyLabOrderSchema,
} from "@/features/lab/schemas";
import { withAction } from "@/lib/actions";
import { requirePermission } from "@/lib/rbac/guard";
import type { AppSession } from "@/lib/rbac/guard";
import type { Permission } from "@/lib/rbac/permissions";

function actorFrom(session: AppSession): LabActor {
  return {
    clinicId: session.activeClinicId ?? "",
    actorUserId: session.user.id,
    actorName: session.user.name,
  };
}

async function labActor(permission: Permission): Promise<LabActor> {
  return actorFrom(await requirePermission(permission));
}

/** The bench queue and the patient chart both change; refresh them together. */
function touchLab(patientId?: string | null): void {
  revalidatePath("/laboratory");
  if (patientId) revalidatePath(`/patients/${patientId}`);
  revalidatePath("/portal");
}

export const upsertLabTestAction = withAction(
  upsertLabTestSchema,
  async (input): Promise<LabTestDto> => {
    const test = await upsertLabTest(input, await labActor("lab:catalog"));
    touchLab();
    return test;
  },
);

export const deactivateLabTestAction = withAction(
  deactivateLabTestSchema,
  async (input): Promise<LabTestDto> => {
    const test = await deactivateLabTest(input, await labActor("lab:catalog"));
    touchLab();
    return test;
  },
);

export const placeLabOrderAction = withAction(
  placeLabOrderSchema,
  async (input): Promise<LabOrderDto> => {
    const order = await placeLabOrder(input, await labActor("lab:order"));
    touchLab(order.patientId);
    return order;
  },
);

export const cancelLabOrderAction = withAction(
  cancelLabOrderSchema,
  async (input): Promise<LabOrderDto> => {
    const order = await cancelLabOrder(input, await labActor("lab:order"));
    touchLab(order.patientId);
    return order;
  },
);

export const collectLabOrderSampleAction = withAction(
  collectLabOrderSchema,
  async (input): Promise<LabOrderDto> => {
    const order = await collectLabOrderSample(input, await labActor("lab:collect"));
    touchLab(order.patientId);
    return order;
  },
);

export const enterLabResultsAction = withAction(
  enterLabResultsSchema,
  async (input): Promise<LabOrderDto> => {
    const order = await enterLabResults(input, await labActor("lab:collect"));
    touchLab(order.patientId);
    return order;
  },
);

export const verifyLabOrderAction = withAction(
  verifyLabOrderSchema,
  async (input): Promise<LabOrderDto> => {
    const order = await verifyLabOrder(input, await labActor("lab:verify"));
    touchLab(order.patientId);
    return order;
  },
);
