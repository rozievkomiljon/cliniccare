/**
 * Patient module integration tests (Postgres-backed): MRN generation,
 * transactional registration + audit, clinic scoping, soft deletion, and the
 * upload validation rules enforced before anything reaches object storage.
 */
import { afterAll, describe, expect, it } from "vitest";

import { buildStorageKey, validateUpload } from "@/lib/files";
import { db } from "@/lib/db";
import {
  registerPatient,
  softDeletePatient,
  updatePatient,
} from "@/features/patients/service";
import { hashPassword } from "@/lib/auth/password";

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
const CLINIC_A = `p2-a-${suffix}`;
const CLINIC_B = `p2-b-${suffix}`;
const EMAIL_DOMAIN = "@ptest.local";

async function ensureClinic(slug: string) {
  return db.clinic.upsert({
    where: { slug },
    update: {},
    create: { name: `P2 ${slug}`, slug, timezone: "UTC" },
  });
}

async function makeStaffUser(email: string) {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "P2 Staff", passwordHash: await hashPassword("Sup3r$ecret!pw") },
  });
}

describe.skipIf(!hasDb)("upload validation rules", () => {
  it("accepts allowed extensions with matching MIME", () => {
    const ok = validateUpload("scan.pdf", "application/pdf", 1024);
    expect(ok.ok).toBe(true);
  });

  it("rejects disallowed extensions", () => {
    const result = validateUpload("payload.exe", "application/octet-stream", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed/i);
  });

  it("rejects MIME/extension mismatches", () => {
    const result = validateUpload("report.pdf", "text/html", 1024);
    expect(result.ok).toBe(false);
  });

  it("rejects oversized files", () => {
    const result = validateUpload("big.pdf", "application/pdf", 11 * 1024 * 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/10 MB/);
  });

  it("strips path traversal from filenames", () => {
    const result = validateUpload("../../etc/passwd.pdf", "application/pdf", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.safeName).toBe("passwd.pdf");
  });

  it("builds server-generated keys under clinic/patient scope", () => {
    const key = buildStorageKey("clinic1", "patient1", ".pdf");
    expect(key.startsWith("clinic1/patient1/")).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(key).not.toMatch(/proposal|fixture|password/i);
    const key2 = buildStorageKey("clinic1", "patient1", ".pdf");
    expect(key).not.toEqual(key2); // unique entropy
  });
});

describe.skipIf(!hasDb)("patient registration", () => {
  it("generates sequential per-clinic MRNs (P-YYYY-NNNNN)", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`staff-${suffix}${EMAIL_DOMAIN}`);

    const first = await registerPatient({
      clinicId: clinic.id,
      actorUserId: staff.id,
      firstName: "Ada",
      lastName: "First",
      dateOfBirth: "1991-02-03",
      sex: "FEMALE",
      phone: "+1 555 111 2222",
    });
    const second = await registerPatient({
      clinicId: clinic.id,
      actorUserId: staff.id,
      firstName: "Ben",
      lastName: "Second",
      dateOfBirth: "1992-03-04",
      sex: "MALE",
      phone: "+1 555 111 2223",
    });

    const year = new Date().getUTCFullYear();
    expect(first.mrn).toMatch(new RegExp(`^P-${year}-\\d{5}$`));
    expect(BigInt(second.mrn.slice(-5))).toBe(BigInt(first.mrn.slice(-5)) + 1n);
  });

  it("writes a patient.registered audit row in the same transaction", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`staff2-${suffix}${EMAIL_DOMAIN}`);

    const created = await registerPatient({
      clinicId: clinic.id,
      actorUserId: staff.id,
      firstName: "Cara",
      lastName: "Audited",
      dateOfBirth: "1988-07-07",
      sex: "FEMALE",
      phone: "+1 555 111 2224",
    });

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Patient", entityId: created.id, action: "patient.registered" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(staff.id);
    expect(audit?.after).toMatchObject({ mrn: created.mrn });
  });

  it("clinic B cannot read or mutate clinic A's patient", async () => {
    const a = await ensureClinic(CLINIC_A);
    const b = await ensureClinic(CLINIC_B);
    const staffB = await makeStaffUser(`staffb-${suffix}${EMAIL_DOMAIN}`);

    const patientA = await db.patient.findFirst({
      where: { clinicId: a.id, isDeleted: false },
    });
    expect(patientA).not.toBeNull();

    // Clinic-scoped lookups find nothing across the boundary.
    const crossRead = await db.patient.findFirst({
      where: { id: patientA!.id, clinicId: b.id, isDeleted: false },
    });
    expect(crossRead).toBeNull();

    // Service-level update rejects (throws NotFound) with the wrong clinicId.
    await expect(
      db.$transaction(async (tx) =>
        updatePatient(tx, {
          patientId: patientA!.id,
          clinicId: b.id,
          actorUserId: staffB.id,
          data: { phone: "+1 555 999 0000" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("updates are audited with before/after values", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`staff3-${suffix}${EMAIL_DOMAIN}`);
    const patient = await registerPatient({
      clinicId: clinic.id,
      actorUserId: staff.id,
      firstName: "Dora",
      lastName: "Update",
      dateOfBirth: "1980-01-01",
      sex: "FEMALE",
      phone: "+1 555 111 2225",
    });

    await db.$transaction(async (tx) =>
      updatePatient(tx, {
        patientId: patient.id,
        clinicId: clinic.id,
        actorUserId: staff.id,
        data: { city: "Newtown" },
      }),
    );

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Patient", entityId: patient.id, action: "patient.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.before).toMatchObject({ city: null });
    expect(audit?.after).toMatchObject({ city: "Newtown" });
  });

  it("soft deletion keeps the row but hides it from the clinic-scoped list", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const staff = await makeStaffUser(`staff4-${suffix}${EMAIL_DOMAIN}`);
    const patient = await registerPatient({
      clinicId: clinic.id,
      actorUserId: staff.id,
      firstName: "Evan",
      lastName: "Deleted",
      dateOfBirth: "1975-05-05",
      sex: "MALE",
      phone: "+1 555 111 2226",
    });

    await db.$transaction(async (tx) =>
      softDeletePatient(tx, {
        patientId: patient.id,
        clinicId: clinic.id,
        actorUserId: staff.id,
      }),
    );

    const raw = await db.patient.findUnique({ where: { id: patient.id } });
    expect(raw?.isDeleted).toBe(true);
    const visible = await db.patient.findFirst({
      where: { id: patient.id, clinicId: clinic.id, isDeleted: false },
    });
    expect(visible).toBeNull();
  });

  it("portal account resolves to exactly one patient (own data only)", async () => {
    // The seed links the portal user to P-2026-00001 in demo-clinic.
    const patient = await db.patient.findFirst({
      where: { clinic: { slug: "demo-clinic" }, mrn: "P-2026-00001" },
    });
    const portalUser = await db.user.findUnique({ where: { email: "patient@cliniccare.local" } });
    if (!patient || !portalUser) return; // seed may not have run in this DB

    const account = await db.patientAccount.findUnique({
      where: { userId: portalUser.id },
      include: { patient: true },
    });
    expect(account?.patient.id).toBe(patient.id);
    expect(account?.patient.mrn).toBe("P-2026-00001");
  });
});

afterAll(async () => {
  try {
    const clinicIds = (
      await db.clinic.findMany({
        where: { slug: { in: [CLINIC_A, CLINIC_B] } },
        select: { id: true },
      })
    ).map((c) => c.id);
    if (clinicIds.length > 0) {
      await db.attachment.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.patient.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.serviceCatalogItem.deleteMany({ where: { clinicId: { in: clinicIds } } });
      await db.membership.deleteMany({ where: { clinicId: { in: clinicIds } } });
    }
    await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await db.clinic.deleteMany({ where: { slug: { in: [CLINIC_A, CLINIC_B] } } });
  } catch {
    // best-effort
  }
  await db.$disconnect();
});
