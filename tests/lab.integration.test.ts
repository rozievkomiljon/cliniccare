/**
 * Phase 5 integration tests (Postgres-backed): the bench workflow, the
 * verify-and-lock transition, clinic isolation, the PHI-safe audit trail and the
 * portal's release rule.
 *
 * The point of the phase: a reported result is released by a clinician, and once
 * released it cannot be quietly rewritten — the tests below try and prove it.
 */
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { hasPermission } from "@/lib/rbac/permissions";
import {
  cancelLabOrder,
  collectLabOrderSample,
  deactivateLabTest,
  enterLabResults,
  placeLabOrder,
  upsertLabTest,
  verifyLabOrder,
  type LabActor,
} from "@/features/lab/service";
import { getLabOrderForClinic, listLabWorklist, listPortalLabResults } from "@/features/lab/queries";

const DB_AVAILABLE = await (async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();
const CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const hasDb = DB_AVAILABLE || CI;

const suffix = process.env.GITHUB_RUN_ID ?? "local";
const CLINIC_A = `p5-a-${suffix}`;
const CLINIC_B = `p5-b-${suffix}`;
const EMAIL_DOMAIN = "@cp5test.local";

async function ensureClinic(slug: string) {
  return db.clinic.upsert({
    where: { slug },
    update: {},
    create: { name: `P5 ${slug}`, slug, timezone: "UTC" },
  });
}

async function makeUser(email: string, name: string) {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash: await hashPassword("Sup3r$ecret!pw") },
  });
}

async function makePatient(clinicId: string, tag: string) {
  return db.patient.create({
    data: {
      clinicId,
      mrn: `P5-${Date.now()}-${tag}`,
      firstName: "Lab",
      lastName: `Case${tag}`,
      dateOfBirth: new Date("1979-03-03T00:00:00.000Z"),
      sex: "MALE",
    },
  });
}

async function makeActor(clinicId: string, emailTag: string, name: string): Promise<LabActor> {
  const user = await makeUser(`${emailTag}-${suffix}${EMAIL_DOMAIN}`, name);
  return { clinicId, actorUserId: user.id, actorName: user.name };
}

/** Two orderable tests in the clinic's catalog, with distinct codes per run. */
async function makeTests(actor: LabActor, tag: string) {
  const glucose = await upsertLabTest(
    {
      testId: "",
      code: `GLU${tag}`,
      name: "Fasting glucose",
      category: "BIOCHEMISTRY",
      specimen: "BLOOD",
      unit: "mmol/L",
      referenceRange: "3.9-5.5",
      isActive: true,
    },
    actor,
  );
  const hgb = await upsertLabTest(
    {
      testId: "",
      code: `HGB${tag}`,
      name: "Haemoglobin",
      category: "HAEMATOLOGY",
      specimen: "BLOOD",
      unit: "g/dL",
      referenceRange: "13.0-17.0",
      isActive: true,
    },
    actor,
  );
  return { glucose, hgb };
}

describe.skipIf(!hasDb)("laboratory", () => {
  it("runs the bench in order and locks the results on verification", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const actor = await makeActor(clinic.id, "lab1", "Luke Lab");
    const patient = await makePatient(clinic.id, "1");
    const { glucose, hgb } = await makeTests(actor, "1");

    const ordered = await placeLabOrder(
      { patientId: patient.id, priority: "URGENT", indication: "Suspected anaemia", testIds: [glucose.id, hgb.id] },
      actor,
    );
    expect(ordered.status).toBe("ORDERED");
    expect(ordered.items).toHaveLength(2);
    // The item snapshots the catalog at order time.
    expect(ordered.items.find((item) => item.testId === glucose.id)?.referenceRange).toBe("3.9-5.5");
    expect(ordered.items.every((item) => item.resultValue === null)).toBe(true);

    // A request cannot be verified before it is even collected.
    await expect(verifyLabOrder({ orderId: ordered.id }, actor)).rejects.toBeInstanceOf(ConflictError);

    const collected = await collectLabOrderSample({ orderId: ordered.id }, actor);
    expect(collected.status).toBe("COLLECTED");
    expect(collected.collectedByName).toBe("Luke Lab");
    // Collection happens once.
    await expect(collectLabOrderSample({ orderId: ordered.id }, actor)).rejects.toBeInstanceOf(ConflictError);

    // A partial entry leaves the order in the lab.
    const partial = await enterLabResults(
      { orderId: ordered.id, items: [{ itemId: ordered.items[0]!.id, resultValue: "5.1", flag: "NORMAL" }] },
      actor,
    );
    expect(partial.status).toBe("COLLECTED");
    await expect(verifyLabOrder({ orderId: ordered.id }, actor)).rejects.toBeInstanceOf(ConflictError);

    const complete = await enterLabResults(
      { orderId: ordered.id, items: [{ itemId: ordered.items[1]!.id, resultValue: "11.9", flag: "LOW" }] },
      actor,
    );
    expect(complete.status).toBe("COMPLETED");
    expect(complete.completedAt).not.toBeNull();

    const verifier = await makeActor(clinic.id, "lab1v", "Dr Verifier");
    const verified = await verifyLabOrder({ orderId: ordered.id }, verifier);
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedByName).toBe("Dr Verifier");

    // Verification is the lock: no edits, no second signature.
    await expect(
      enterLabResults(
        { orderId: ordered.id, items: [{ itemId: ordered.items[0]!.id, resultValue: "9.9" }] },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(verifyLabOrder({ orderId: ordered.id }, verifier)).rejects.toBeInstanceOf(ConflictError);

    // History intact: the reported values are still what was verified.
    const reread = await getLabOrderForClinic(clinic.id, ordered.id);
    expect(reread?.status).toBe("VERIFIED");
    expect(reread?.items.find((item) => item.testId === glucose.id)?.resultValue).toBe("5.1");
  });

  it("rejects a duplicate test code and can retire a test", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const actor = await makeActor(clinic.id, "lab2", "Cat Admin");
    const { glucose } = await makeTests(actor, "2");

    await expect(
      upsertLabTest(
        {
          testId: "",
          code: glucose.code,
          name: "Duplicate",
          category: "BIOCHEMISTRY",
          specimen: "BLOOD",
          isActive: true,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const retired = await deactivateLabTest({ testId: glucose.id }, actor);
    expect(retired.isActive).toBe(false);

    // A retired test can no longer be ordered, but the catalog row survives.
    const patient = await makePatient(clinic.id, "2");
    await expect(
      placeLabOrder({ patientId: patient.id, priority: "ROUTINE", testIds: [glucose.id] }, actor),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps result values and the indication out of the audit trail", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const actor = await makeActor(clinic.id, "lab3", "Dr Quiet");
    const patient = await makePatient(clinic.id, "3");
    const { glucose } = await makeTests(actor, "3");

    const indication = "Rule out diabetes after polyuria";
    const result = "5.4";
    const order = await placeLabOrder(
      { patientId: patient.id, priority: "ROUTINE", indication, testIds: [glucose.id] },
      actor,
    );
    await collectLabOrderSample({ orderId: order.id }, actor);
    await enterLabResults(
      { orderId: order.id, items: [{ itemId: order.items[0]!.id, resultValue: result, flag: "NORMAL", comment: "Fasting sample." }] },
      actor,
    );
    await verifyLabOrder({ orderId: order.id }, actor);

    const audits = await db.auditLog.findMany({ where: { clinicId: clinic.id, actorUserId: actor.actorUserId } });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("lab.order_placed");
    expect(actions).toContain("lab.sample_collected");
    expect(actions).toContain("lab.results_entered");
    expect(actions).toContain("lab.order_verified");

    // Clinical text never lands in the broadly-readable audit log.
    const serialized = JSON.stringify(audits.map((a) => ({ before: a.before, after: a.after })));
    expect(serialized).not.toContain(indication);
    expect(serialized).not.toContain(result);
    expect(serialized).not.toContain("Fasting sample.");

    const resultsAudit = audits.find((a) => a.action === "lab.results_entered");
    const resultsAfter = resultsAudit?.after as { orderComplete?: boolean } | null;
    expect(resultsAfter?.orderComplete).toBe(true);
    // Exactly these keys: no measurement ever lands in the audit payload.
    expect(Object.keys(resultsAfter ?? {}).sort()).toEqual(["itemIds", "orderComplete", "patientId"]);
  });

  it("keeps laboratory data inside its clinic", async () => {
    const a = await ensureClinic(CLINIC_A);
    const b = await ensureClinic(CLINIC_B);
    const actorA = await makeActor(a.id, "lab4a", "Dr Tenant");
    const actorB = await makeActor(b.id, "lab4b", "Dr Other");
    const patientA = await makePatient(a.id, "4");
    const { glucose } = await makeTests(actorA, "4");

    const order = await placeLabOrder(
      { patientId: patientA.id, priority: "ROUTINE", testIds: [glucose.id] },
      actorA,
    );
    await collectLabOrderSample({ orderId: order.id }, actorA);

    // Reads are scoped, so another clinic sees nothing.
    expect(await getLabOrderForClinic(b.id, order.id)).toBeNull();
    expect(await listLabWorklist(b.id)).toHaveLength(0);

    // Writes fail closed.
    await expect(collectLabOrderSample({ orderId: order.id }, actorB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      enterLabResults({ orderId: order.id, items: [{ itemId: order.items[0]!.id, resultValue: "1.0" }] }, actorB),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(verifyLabOrder({ orderId: order.id }, actorB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelLabOrder({ orderId: order.id }, actorB)).rejects.toBeInstanceOf(NotFoundError);

    // Another clinic's patient and catalog are unreachable too.
    await expect(
      placeLabOrder({ patientId: patientA.id, priority: "ROUTINE", testIds: [glucose.id] }, actorB),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancels a request that has not been reported", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const actor = await makeActor(clinic.id, "lab5", "Dr Cancel");
    const patient = await makePatient(clinic.id, "5");
    const { glucose } = await makeTests(actor, "5");

    const order = await placeLabOrder({ patientId: patient.id, priority: "ROUTINE", testIds: [glucose.id] }, actor);
    const cancelled = await cancelLabOrder({ orderId: order.id }, actor);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledByName).toBe("Dr Cancel");

    // A cancelled request leaves the bench queue and accepts nothing further.
    const queue = await listLabWorklist(clinic.id);
    expect(queue.some((row) => row.id === order.id)).toBe(false);
    await expect(cancelLabOrder({ orderId: order.id }, actor)).rejects.toBeInstanceOf(ConflictError);
    await expect(collectLabOrderSample({ orderId: order.id }, actor)).rejects.toBeInstanceOf(ConflictError);
  });

  it("exposes only verified results to the patient portal", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const actor = await makeActor(clinic.id, "lab6", "Dr Portal");
    const patient = await makePatient(clinic.id, "6");
    const { glucose } = await makeTests(actor, "6");

    const order = await placeLabOrder(
      { patientId: patient.id, priority: "ROUTINE", indication: "Routine screening", testIds: [glucose.id] },
      actor,
    );
    await collectLabOrderSample({ orderId: order.id }, actor);
    await enterLabResults(
      { orderId: order.id, items: [{ itemId: order.items[0]!.id, resultValue: "5.2", flag: "NORMAL" }] },
      actor,
    );

    // Reported but unverified is not patient-facing.
    expect(await listPortalLabResults(patient.id)).toHaveLength(0);

    await verifyLabOrder({ orderId: order.id }, actor);
    const released = await listPortalLabResults(patient.id);
    expect(released).toHaveLength(1);
    expect(released[0]!.items[0]!.resultValue).toBe("5.2");
    expect(released[0]!.verifiedAt).not.toBeNull();
    // The ordering indication stays with the care team.
    expect(JSON.stringify(released)).not.toContain("Routine screening");
  });

  it("splits laboratory duties across the RBAC matrix", async () => {
    // The bench maintains the catalog and reports; it does not order or release.
    expect(hasPermission("LAB_TECH", "lab:catalog")).toBe(true);
    expect(hasPermission("LAB_TECH", "lab:collect")).toBe(true);
    expect(hasPermission("LAB_TECH", "lab:order")).toBe(false);
    expect(hasPermission("LAB_TECH", "lab:verify")).toBe(false);

    // Clinicians order and release; they do not run the bench.
    expect(hasPermission("DOCTOR", "lab:order")).toBe(true);
    expect(hasPermission("DOCTOR", "lab:verify")).toBe(true);
    expect(hasPermission("DOCTOR", "lab:collect")).toBe(false);

    // Nurses may request tests, but releasing a result is the doctor's act.
    expect(hasPermission("NURSE", "lab:order")).toBe(true);
    expect(hasPermission("NURSE", "lab:verify")).toBe(false);

    expect(hasPermission("RECEPTIONIST", "lab:order")).toBe(false);
    expect(hasPermission("PHARMACIST", "lab:collect")).toBe(false);
  });
});

afterAll(async () => {
  try {
    const clinicIds = (
      await db.clinic.findMany({ where: { slug: { in: [CLINIC_A, CLINIC_B] } }, select: { id: true } })
    ).map((c) => c.id);
    if (clinicIds.length > 0) {
      // Items cascade with their order; the catalog is blocked by item FKs, so
      // orders go first.
      await db.labOrder.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.labTest.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
    }
    await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await db.clinic.deleteMany({ where: { slug: { in: [CLINIC_A, CLINIC_B] } } });
  } catch {
    // best-effort
  }
  await db.$disconnect();
});
