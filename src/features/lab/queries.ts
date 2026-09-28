import "server-only";

import { LabOrderStatus, type LabResultFlag } from "@prisma/client";

import { db } from "@/lib/db";
import {
  orderInclude,
  toLabOrderDto,
  toLabTestDto,
  type LabOrderDto,
  type LabTestDto,
} from "@/features/lab/service";

/** The clinic's orderable catalog. Inactive entries stay visible for admins. */
export async function listLabTests(
  clinicId: string,
  options: { includeInactive?: boolean } = {},
): Promise<LabTestDto[]> {
  const rows = await db.labTest.findMany({
    where: { clinicId, isDeleted: false, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return rows.map(toLabTestDto);
}

/** One patient's laboratory history, newest request first. */
export async function listLabOrdersForPatient(
  clinicId: string,
  patientId: string,
  limit = 50,
): Promise<LabOrderDto[]> {
  const rows = await db.labOrder.findMany({
    where: { clinicId, patientId },
    include: orderInclude,
    orderBy: { orderedAt: "desc" },
    take: limit,
  });
  return rows.map(toLabOrderDto);
}

/** One request with its items, clinic-scoped. */
export async function getLabOrderForClinic(clinicId: string, orderId: string): Promise<LabOrderDto | null> {
  const row = await db.labOrder.findFirst({ where: { id: orderId, clinicId }, include: orderInclude });
  return row ? toLabOrderDto(row) : null;
}

/**
 * The bench queue: everything not yet verified or cancelled, oldest first, so
 * the longest-waiting sample sits at the top.
 */
export async function listLabWorklist(clinicId: string, limit = 100): Promise<LabOrderDto[]> {
  const rows = await db.labOrder.findMany({
    where: {
      clinicId,
      status: { in: [LabOrderStatus.ORDERED, LabOrderStatus.COLLECTED, LabOrderStatus.COMPLETED] },
    },
    include: orderInclude,
    orderBy: { orderedAt: "asc" },
    take: limit,
  });
  return rows.map(toLabOrderDto);
}

/** Recent request counts per status, for the queue header. */
export async function countLabWorklist(clinicId: string): Promise<Record<string, number>> {
  const rows = await db.labOrder.groupBy({
    by: ["status"],
    where: {
      clinicId,
      status: { in: [LabOrderStatus.ORDERED, LabOrderStatus.COLLECTED, LabOrderStatus.COMPLETED] },
    },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

export type PortalLabItemRow = {
  id: string;
  testName: string;
  testCode: string;
  resultValue: string | null;
  unit: string | null;
  referenceRange: string | null;
  flag: LabResultFlag | null;
  comment: string | null;
};

export type PortalLabOrderRow = {
  id: string;
  orderedAt: string;
  verifiedAt: string | null;
  doctorName: string | null;
  items: PortalLabItemRow[];
};

/**
 * Portal view of one patient's own laboratory results. Scoped by patientId alone
 * because the caller resolves that id from the signed-in account, and limited to
 * VERIFIED orders: a result is not patient-facing until a clinician has released
 * it. The ordering indication stays with the care team.
 */
export async function listPortalLabResults(patientId: string, limit = 10): Promise<PortalLabOrderRow[]> {
  const rows = await db.labOrder.findMany({
    where: { patientId, status: LabOrderStatus.VERIFIED },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      items: { orderBy: [{ createdAt: "asc" }, { testName: "asc" }] },
    },
    orderBy: { verifiedAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    orderedAt: row.orderedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    doctorName: row.doctor?.user.name ?? null,
    items: row.items.map((item) => ({
      id: item.id,
      testName: item.testName,
      testCode: item.testCode,
      resultValue: item.resultValue,
      unit: item.unit,
      referenceRange: item.referenceRange,
      flag: item.flag,
      comment: item.comment,
    })),
  }));
}
