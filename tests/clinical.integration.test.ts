/**
 * Phase 4 integration tests (Postgres-backed): the append-only contract, the
 * sign-and-lock transition, clinic isolation and the PHI-safe audit trail.
 *
 * The point of the phase: a clinical record cannot be silently rewritten. The
 * tests below try to rewrite one and prove it fails.
 */
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { hasPermission } from "@/lib/rbac/permissions";
import {
  addClinicalNote,
  openEncounter,
  recordVitals,
  signEncounter,
  updateEncounterDraft,
  type ClinicalActor,
} from "@/features/clinical/service";
import { getEncounterForClinic, listPortalClinicalSummary } from "@/features/clinical/queries";

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
const CLINIC_A = `p4-a-${suffix}`;
const CLINIC_B = `p4-b-${suffix}`;
const EMAIL_DOMAIN = "@cp4test.local";

async function ensureClinic(slug: string) {
  return db.clinic.upsert({
    where: { slug },
    update: {},
    create: { name: `P4 ${slug}`, slug, timezone: "UTC" },
  });
}

async function makeUser(email: string, name: string) {
  return db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash: await hashPassword("Sup3r$ecret!pw") },
  });
}

async function makePatient(clinicId: string, tag: string, firstName = "Clinical") {
  return db.patient.create({
    data: {
      clinicId,
      mrn: `P4-${Date.now()}-${tag}`,
      firstName,
      lastName: "Case",
      dateOfBirth: new Date("1985-05-05T00:00:00.000Z"),
      sex: "FEMALE",
      phone: `+1 555 05${tag}`,
    },
  });
}

function nextMondayAt(hour: number): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  const add = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 16);

describe.skipIf(!hasDb)("clinical record", () => {
  it("edits an open encounter, then locks it on signing", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const author = await makeUser(`auth-${suffix}${EMAIL_DOMAIN}`, "Dr Author");
    const patient = await makePatient(clinic.id, "1");
    const actor: ClinicalActor = { clinicId: clinic.id, actorUserId: author.id, actorName: author.name };

    const opened = await openEncounter(
      {
        patientId: patient.id,
        occurredAt: iso(nextMondayAt(9)),
        kind: "CONSULTATION",
        chiefComplaint: "Headache",
      },
      actor,
    );
    expect(opened.status).toBe("OPEN");
    expect(opened.signedAt).toBeNull();

    const drafted = await updateEncounterDraft(
      { encounterId: opened.id, diagnosis: "Tension headache", plan: "Hydration and rest." },
      actor,
    );
    expect(drafted.diagnosis).toBe("Tension headache");

    const signed = await signEncounter({ encounterId: opened.id }, actor);
    expect(signed.status).toBe("SIGNED");
    expect(signed.signedByName).toBe(author.name);
    expect(signed.signedAt).not.toBeNull();

    // The signature is the lock: further edits must be addenda instead.
    await expect(
      updateEncounterDraft({ encounterId: opened.id, diagnosis: "Migraine" }, actor),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(signEncounter({ encounterId: opened.id }, actor)).rejects.toBeInstanceOf(ConflictError);

    const addendum = await addClinicalNote(
      { patientId: patient.id, encounterId: opened.id, kind: "ADDENDUM", body: "Diagnosis revised after review: migraine." },
      actor,
    );
    expect(addendum.kind).toBe("ADDENDUM");

    const reread = await getEncounterForClinic(clinic.id, opened.id);
    expect(reread?.encounter.diagnosis).toBe("Tension headache"); // history intact
    expect(reread?.notes.map((n) => n.kind)).toEqual(["ADDENDUM"]);
  });

  it("keeps clinical values out of the audit trail", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const author = await makeUser(`auth2-${suffix}${EMAIL_DOMAIN}`, "Dr Quiet");
    const patient = await makePatient(clinic.id, "2", "Quiet");
    const actor: ClinicalActor = { clinicId: clinic.id, actorUserId: author.id, actorName: author.name };
    const secret = "Patient reports chest tightness on exertion.";

    const encounter = await openEncounter(
      { patientId: patient.id, occurredAt: iso(nextMondayAt(10)), kind: "FOLLOW_UP" },
      actor,
    );
    const note = await addClinicalNote(
      { patientId: patient.id, encounterId: encounter.id, kind: "NOTE", body: secret },
      actor,
    );
    await recordVitals({ patientId: patient.id, encounterId: encounter.id, systolic: 145, diastolic: 92 }, actor);

    const audits = await db.auditLog.findMany({ where: { clinicId: clinic.id, actorUserId: author.id } });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("clinical.encounter_opened");
    expect(actions).toContain("clinical.note_added");
    expect(actions).toContain("clinical.vitals_recorded");

    // Metadata only: the note body is replaced by its length, and vitals are
    // recorded as the field names that were measured, never their values.
    const noteAudit = audits.find((a) => a.action === "clinical.note_added");
    const noteAfter = noteAudit?.after as { characters?: number; body?: string } | null;
    expect(noteAudit?.entityId).toBe(note.id);
    expect(noteAfter?.characters).toBe(secret.length);
    expect(noteAfter?.body).toBeUndefined();

    const vitalsAudit = audits.find((a) => a.action === "clinical.vitals_recorded");
    const vitalsAfter = vitalsAudit?.after as { fields?: string[] } | null;
    expect(vitalsAfter?.fields).toEqual(["systolic", "diastolic"]);
    // Exactly these keys: no measurement ever lands in the audit payload.
    expect(Object.keys(vitalsAfter ?? {}).sort()).toEqual(["encounterId", "fields", "patientId"]);
  });

  it("keeps clinical records inside their clinic", async () => {
    const a = await ensureClinic(CLINIC_A);
    const b = await ensureClinic(CLINIC_B);
    const authorA = await makeUser(`auth3-${suffix}${EMAIL_DOMAIN}`, "Dr Tenant");
    const intruder = await makeUser(`auth4-${suffix}${EMAIL_DOMAIN}`, "Dr Other");
    const patientA = await makePatient(a.id, "3", "Tenant");
    const actorA: ClinicalActor = { clinicId: a.id, actorUserId: authorA.id, actorName: authorA.name };
    const actorB: ClinicalActor = { clinicId: b.id, actorUserId: intruder.id, actorName: intruder.name };

    const encounter = await openEncounter(
      { patientId: patientA.id, occurredAt: iso(nextMondayAt(11)), kind: "CONSULTATION" },
      actorA,
    );

    // Reads are scoped, so another clinic sees nothing.
    expect(await getEncounterForClinic(b.id, encounter.id)).toBeNull();
    // Writes fail closed.
    await expect(
      updateEncounterDraft({ encounterId: encounter.id, diagnosis: "Tampered" }, actorB),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(signEncounter({ encounterId: encounter.id }, actorB)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addClinicalNote({ patientId: patientA.id, kind: "NOTE", body: "not mine to write" }, actorB),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordVitals({ patientId: patientA.id, pulse: 60 }, actorB),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("exposes only signed encounters to the patient portal", async () => {
    const clinic = await ensureClinic(CLINIC_A);
    const author = await makeUser(`auth5-${suffix}${EMAIL_DOMAIN}`, "Dr Portal");
    const patient = await makePatient(clinic.id, "4", "Portal");
    const actor: ClinicalActor = { clinicId: clinic.id, actorUserId: author.id, actorName: author.name };

    const draft = await openEncounter(
      { patientId: patient.id, occurredAt: iso(nextMondayAt(12)), kind: "TELEHEALTH" },
      actor,
    );
    await updateEncounterDraft({ encounterId: draft.id, diagnosis: "Under review" }, actor);

    const beforeSigning = await listPortalClinicalSummary(patient.id);
    expect(beforeSigning.encounters).toHaveLength(0); // a draft is not patient-facing

    await signEncounter({ encounterId: draft.id }, actor);
    const afterSigning = await listPortalClinicalSummary(patient.id);
    expect(afterSigning.encounters.map((e) => e.diagnosis)).toEqual(["Under review"]);
    expect(afterSigning.encounters[0]!.doctorName).toBeNull();
  });

  it("splits authoring from observation rights in the RBAC matrix", () => {
    expect(hasPermission("DOCTOR", "clinical:author")).toBe(true);
    expect(hasPermission("DOCTOR", "vitals:record")).toBe(true);
    expect(hasPermission("NURSE", "vitals:record")).toBe(true);
    // Nurses take observations but do not author or sign the chart.
    expect(hasPermission("NURSE", "clinical:author")).toBe(false);
    expect(hasPermission("RECEPTIONIST", "clinical:view")).toBe(false);
  });
});

afterAll(async () => {
  try {
    const clinicIds = (
      await db.clinic.findMany({ where: { slug: { in: [CLINIC_A, CLINIC_B] } }, select: { id: true } })
    ).map((c) => c.id);
    if (clinicIds.length > 0) {
      const patientIds = (
        await db.patient.findMany({ where: { clinicId: { in: clinicIds } }, select: { id: true } })
      ).map((p) => p.id);
      if (patientIds.length > 0) {
        await db.clinicalNote.deleteMany({ where: { patientId: { in: patientIds } } });
        await db.vital.deleteMany({ where: { patientId: { in: patientIds } } });
        await db.encounter.deleteMany({ where: { patientId: { in: patientIds } } });
      }
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
