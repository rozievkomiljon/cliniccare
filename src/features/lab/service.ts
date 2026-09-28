/**
 * Laboratory services (Phase 5). The workflow is
 * ORDERED → COLLECTED → COMPLETED → VERIFIED, with CANCELLED reachable only from
 * the first two. Results stay editable while an order is COLLECTED or COMPLETED;
 * verification is the lock (rule 7), so a correction after reporting is a new
 * order rather than a silent rewrite of a reported value.
 *
 * Audit rows carry METADATA only (which items, how many, the order's state) —
 * result values, comments, the clinical indication and test names are all
 * clinical data and never enter the broadly-readable audit log.
 */
import {
  LabOrderStatus,
  Prisma,
  type LabOrderPriority,
  type LabOrderStatus as LabOrderStatusType,
  type LabResultFlag,
  type LabSpecimenType,
} from "@prisma/client";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type {
  CancelLabOrderInput,
  CollectLabOrderInput,
  DeactivateLabTestInput,
  EnterLabResultsInput,
  PlaceLabOrderInput,
  UpsertLabTestInput,
  VerifyLabOrderInput,
} from "@/features/lab/schemas";

/** The acting staff member's clinic scope. Row scoping is enforced by callers. */
export type LabActor = {
  clinicId: string;
  actorUserId: string;
  actorName: string;
};

export type LabTestDto = {
  id: string;
  code: string;
  name: string;
  category: string;
  specimen: LabSpecimenType;
  unit: string | null;
  referenceRange: string | null;
  turnaroundHours: number | null;
  isActive: boolean;
};

export type LabOrderItemDto = {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  unit: string | null;
  referenceRange: string | null;
  resultValue: string | null;
  flag: LabResultFlag | null;
  comment: string | null;
  resultedAt: string | null;
  resultedByName: string | null;
};

export type LabOrderDto = {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string | null;
  doctorName: string | null;
  encounterId: string | null;
  status: LabOrderStatusType;
  priority: LabOrderPriority;
  indication: string | null;
  orderedByName: string;
  orderedAt: string;
  collectedAt: string | null;
  collectedByName: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  items: LabOrderItemDto[];
};

/** Order statuses that still accept (or accept corrected) results. */
export const RESULT_EDITABLE_STATUSES: readonly LabOrderStatusType[] = [
  LabOrderStatus.COLLECTED,
  LabOrderStatus.COMPLETED,
];

/** Order statuses a cancellation may come from. */
export const CANCELLABLE_STATUSES: readonly LabOrderStatusType[] = [
  LabOrderStatus.ORDERED,
  LabOrderStatus.COLLECTED,
];

export const orderInclude = {
  patient: { select: { firstName: true, lastName: true, mrn: true } },
  doctor: { include: { user: { select: { name: true } } } },
  items: { orderBy: [{ createdAt: "asc" }, { testName: "asc" }] },
} satisfies Prisma.LabOrderInclude;

type OrderRow = Prisma.LabOrderGetPayload<{ include: typeof orderInclude }>;

export function toLabTestDto(row: {
  id: string;
  code: string;
  name: string;
  category: string;
  specimen: LabSpecimenType;
  unit: string | null;
  referenceRange: string | null;
  turnaroundHours: number | null;
  isActive: boolean;
}): LabTestDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    specimen: row.specimen,
    unit: row.unit,
    referenceRange: row.referenceRange,
    turnaroundHours: row.turnaroundHours,
    isActive: row.isActive,
  };
}

export function toLabOrderItemDto(row: {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  unit: string | null;
  referenceRange: string | null;
  resultValue: string | null;
  flag: LabResultFlag | null;
  comment: string | null;
  resultedAt: Date | null;
  resultedByName: string | null;
}): LabOrderItemDto {
  return {
    id: row.id,
    testId: row.testId,
    testCode: row.testCode,
    testName: row.testName,
    unit: row.unit,
    referenceRange: row.referenceRange,
    resultValue: row.resultValue,
    flag: row.flag,
    comment: row.comment,
    resultedAt: row.resultedAt?.toISOString() ?? null,
    resultedByName: row.resultedByName,
  };
}

export function toLabOrderDto(row: OrderRow): LabOrderDto {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: `${row.patient.lastName}, ${row.patient.firstName}`,
    patientMrn: row.patient.mrn,
    doctorId: row.doctorId,
    doctorName: row.doctor?.user.name ?? null,
    encounterId: row.encounterId,
    status: row.status,
    priority: row.priority,
    indication: row.indication,
    orderedByName: row.orderedByName,
    orderedAt: row.orderedAt.toISOString(),
    collectedAt: row.collectedAt?.toISOString() ?? null,
    collectedByName: row.collectedByName,
    completedAt: row.completedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedByName: row.verifiedByName,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByName: row.cancelledByName,
    items: row.items.map(toLabOrderItemDto),
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
 * Creates or edits a catalog entry. The code is unique per clinic, so a
 * duplicate surfaces as a friendly conflict rather than a raw constraint error.
 */
export async function upsertLabTest(input: UpsertLabTestInput, actor: LabActor): Promise<LabTestDto> {
  const data = {
    code: input.code,
    name: input.name,
    category: input.category,
    specimen: input.specimen,
    unit: input.unit ?? null,
    referenceRange: input.referenceRange ?? null,
    turnaroundHours: input.turnaroundHours ?? null,
    isActive: input.isActive,
  };

  const testId = input.testId || null;
  if (testId) {
    const existing = await db.labTest.findFirst({
      where: { id: testId, clinicId: actor.clinicId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Test not found in this clinic's catalog.");
  }

  try {
    const row = await db.$transaction(async (tx) => {
      const saved = testId
        ? await tx.labTest.update({ where: { id: testId }, data })
        : await tx.labTest.create({ data: { clinicId: actor.clinicId, ...data } });

      await tx.auditLog.create({
        data: {
          clinicId: actor.clinicId,
          actorUserId: actor.actorUserId,
          action: testId ? "lab.test_updated" : "lab.test_created",
          entityType: "LabTest",
          entityId: saved.id,
          after: { code: saved.code, category: saved.category, isActive: saved.isActive },
        },
      });
      return saved;
    });
    return toLabTestDto(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("A test with that code already exists in this clinic.");
    }
    throw err;
  }
}

/** Retires a test from the orderable list. Existing orders keep their snapshot. */
export async function deactivateLabTest(input: DeactivateLabTestInput, actor: LabActor): Promise<LabTestDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.labTest.findFirst({
      where: { id: input.testId, clinicId: actor.clinicId, isDeleted: false },
    });
    if (!existing) throw new NotFoundError("Test not found in this clinic's catalog.");

    const updated = await tx.labTest.update({ where: { id: existing.id }, data: { isActive: false } });
    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.test_deactivated",
        entityType: "LabTest",
        entityId: existing.id,
        before: { isActive: existing.isActive },
        after: { isActive: false, code: existing.code },
      },
    });
    return updated;
  });

  return toLabTestDto(row);
}

/**
 * Places an order for one or more catalog tests. The item rows are written with
 * the tests' name/unit/range snapshotted, so a later catalog edit cannot change
 * what a result was reported against.
 */
export async function placeLabOrder(input: PlaceLabOrderInput, actor: LabActor): Promise<LabOrderDto> {
  await requirePatient(actor.clinicId, input.patientId);

  const doctorId = input.doctorId || null;
  if (doctorId) {
    const doctor = await db.doctorProfile.findFirst({
      where: { id: doctorId, clinicId: actor.clinicId, isDeleted: false },
      select: { id: true },
    });
    if (!doctor) throw new NotFoundError("Doctor not found.");
  }

  const encounterId = input.encounterId || null;
  if (encounterId) {
    const encounter = await db.encounter.findFirst({
      where: { id: encounterId, clinicId: actor.clinicId, patientId: input.patientId },
      select: { id: true },
    });
    if (!encounter) throw new NotFoundError("Encounter not found for this patient.");
  }

  const testIds = [...new Set(input.testIds)];
  const tests = await db.labTest.findMany({
    where: { id: { in: testIds }, clinicId: actor.clinicId, isDeleted: false, isActive: true },
  });
  if (tests.length !== testIds.length) {
    throw new NotFoundError("One or more tests are not available in this clinic's catalog.");
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.labOrder.create({
      data: {
        clinicId: actor.clinicId,
        patientId: input.patientId,
        doctorId,
        encounterId,
        priority: input.priority,
        indication: input.indication ?? null,
        orderedById: actor.actorUserId,
        orderedByName: actor.actorName,
        items: {
          create: tests.map((test) => ({
            testId: test.id,
            testCode: test.code,
            testName: test.name,
            unit: test.unit,
            referenceRange: test.referenceRange,
          })),
        },
      },
      include: orderInclude,
    });

    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.order_placed",
        entityType: "LabOrder",
        entityId: created.id,
        // Test ids and the priority are workflow metadata; the indication is PHI.
        after: { patientId: input.patientId, doctorId, encounterId, priority: input.priority, testIds },
      },
    });
    return created;
  });

  return toLabOrderDto(row);
}

/** Records sample collection. Only an ORDERED request can be collected. */
export async function collectLabOrderSample(
  input: CollectLabOrderInput,
  actor: LabActor,
): Promise<LabOrderDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.labOrder.findFirst({
      where: { id: input.orderId, clinicId: actor.clinicId },
      include: orderInclude,
    });
    if (!existing) throw new NotFoundError("Lab order not found.");
    if (existing.status !== LabOrderStatus.ORDERED) {
      throw new ConflictError("Only a newly ordered request can be marked collected.");
    }

    const updated = await tx.labOrder.update({
      where: { id: existing.id },
      data: {
        status: LabOrderStatus.COLLECTED,
        collectedAt: new Date(),
        collectedByName: actor.actorName,
      },
      include: orderInclude,
    });

    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.sample_collected",
        entityType: "LabOrder",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: updated.status, patientId: existing.patientId },
      },
    });
    return updated;
  });

  return toLabOrderDto(row);
}

/**
 * Enters or corrects results. Allowed while the order is COLLECTED or COMPLETED;
 * the order flips to COMPLETED once every item has a value, and a partial entry
 * leaves it COLLECTED.
 */
export async function enterLabResults(input: EnterLabResultsInput, actor: LabActor): Promise<LabOrderDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.labOrder.findFirst({
      where: { id: input.orderId, clinicId: actor.clinicId },
      include: { items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError("Lab order not found.");
    if (!RESULT_EDITABLE_STATUSES.includes(existing.status)) {
      throw new ConflictError(
        existing.status === LabOrderStatus.VERIFIED
          ? "This order is verified — results are locked. Place a new order for a recheck."
          : "Results cannot be entered on a cancelled order.",
      );
    }

    const owned = new Set(existing.items.map((item) => item.id));
    for (const entry of input.items) {
      if (!owned.has(entry.itemId)) throw new NotFoundError("That test is not part of this order.");
    }

    const now = new Date();
    for (const entry of input.items) {
      await tx.labOrderItem.update({
        where: { id: entry.itemId },
        data: {
          resultValue: entry.resultValue,
          flag: entry.flag ? entry.flag : null,
          comment: entry.comment ?? null,
          resultedAt: now,
          resultedByName: actor.actorName,
        },
      });
    }

    const outstanding = await tx.labOrderItem.count({
      where: { orderId: existing.id, resultValue: null },
    });
    const complete = outstanding === 0;

    const updated = await tx.labOrder.update({
      where: { id: existing.id },
      data: {
        status: complete ? LabOrderStatus.COMPLETED : LabOrderStatus.COLLECTED,
        completedAt: complete ? (existing.completedAt ?? now) : null,
      },
      include: orderInclude,
    });

    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.results_entered",
        entityType: "LabOrder",
        entityId: existing.id,
        // Which tests were reported and whether the set is complete — not values.
        after: {
          patientId: existing.patientId,
          itemIds: input.items.map((entry) => entry.itemId),
          orderComplete: complete,
        },
      },
    });
    return updated;
  });

  return toLabOrderDto(row);
}

/** Verifies a completed order. One-way: verification is what makes results final. */
export async function verifyLabOrder(input: VerifyLabOrderInput, actor: LabActor): Promise<LabOrderDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.labOrder.findFirst({
      where: { id: input.orderId, clinicId: actor.clinicId },
    });
    if (!existing) throw new NotFoundError("Lab order not found.");
    if (existing.status === LabOrderStatus.VERIFIED) {
      throw new ConflictError("This order is already verified.");
    }
    if (existing.status !== LabOrderStatus.COMPLETED) {
      throw new ConflictError("Every test must have a result before the order can be verified.");
    }

    const verified = await tx.labOrder.update({
      where: { id: existing.id },
      data: {
        status: LabOrderStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedByName: actor.actorName,
      },
      include: orderInclude,
    });

    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.order_verified",
        entityType: "LabOrder",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: verified.status, patientId: existing.patientId, itemCount: verified.items.length },
      },
    });
    return verified;
  });

  return toLabOrderDto(row);
}

/** Cancels a request that has not been reported yet. Kept as a status, not a delete. */
export async function cancelLabOrder(input: CancelLabOrderInput, actor: LabActor): Promise<LabOrderDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.labOrder.findFirst({
      where: { id: input.orderId, clinicId: actor.clinicId },
    });
    if (!existing) throw new NotFoundError("Lab order not found.");
    if (!CANCELLABLE_STATUSES.includes(existing.status)) {
      throw new ConflictError("A completed or cancelled order cannot be cancelled.");
    }

    const cancelled = await tx.labOrder.update({
      where: { id: existing.id },
      data: {
        status: LabOrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByName: actor.actorName,
      },
      include: orderInclude,
    });

    await tx.auditLog.create({
      data: {
        clinicId: actor.clinicId,
        actorUserId: actor.actorUserId,
        action: "lab.order_cancelled",
        entityType: "LabOrder",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: cancelled.status, patientId: existing.patientId },
      },
    });
    return cancelled;
  });

  return toLabOrderDto(row);
}
