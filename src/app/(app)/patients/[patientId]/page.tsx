import Link from "next/link";
import { notFound } from "next/navigation";

import { PatientDocuments } from "@/features/patients/components/patient-documents";
import { StartEncounterForm, VitalsForm } from "@/features/clinical/components/clinical-record";
import { fmtStamp, kindLabel, vitalsSummary } from "@/features/clinical/format";
import { listEncountersForPatient, listVitalsForPatient } from "@/features/clinical/queries";
import { getClinicTimeZone, listDoctors } from "@/features/doctors/queries";
import { getDoctorProfileForUser } from "@/features/doctors/service";
import { getPatientForClinic } from "@/features/patients/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Patient" };

function age(dob: string): string {
  const d = new Date(dob);
  const now = new Date();
  const years = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  return String(years - (beforeBirthday ? 1 : 0));
}

function fmt(b: string | null): string {
  if (!b) return "Unknown";
  return b.replaceAll("_", " ");
}

export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const session = await requirePagePermission("patients:view");
  const { patientId } = await params;
  const patient = await getPatientForClinic(session.activeClinicId ?? "", patientId);
  if (!patient) notFound();

  const canManage =
    session.activeRole === "RECEPTIONIST" ||
    session.activeRole === "CLINIC_ADMIN" ||
    session.user.isSuperAdmin;

  const canSeeClinical =
    session.activeRole === "DOCTOR" ||
    session.activeRole === "NURSE" ||
    session.activeRole === "CLINIC_ADMIN" ||
    session.user.isSuperAdmin;

  const canViewClinical = hasPermission(session.activeRole, "clinical:view");
  const canAuthor = hasPermission(session.activeRole, "clinical:author");
  const canRecordVitals = hasPermission(session.activeRole, "vitals:record");

  // Clinical rows load only for roles that may read them. Hiding the section is
  // cosmetic; the permission check above is the boundary.
  const clinical = canViewClinical
    ? await (async () => {
        const clinicId = session.activeClinicId ?? "";
        const [encounters, vitals, timeZone, doctors, own] = await Promise.all([
          listEncountersForPatient(clinicId, patientId),
          listVitalsForPatient(clinicId, patientId),
          getClinicTimeZone(clinicId),
          canAuthor ? listDoctors(clinicId) : Promise.resolve([]),
          session.activeRole === "DOCTOR" ? getDoctorProfileForUser(session.user.id) : Promise.resolve(null),
        ]);
        return { encounters, vitals, timeZone, doctors, ownProfileId: own?.id };
      })()
    : null;

  const rows: Array<[string, string]> = [
    ["MRN", patient.mrn],
    ["Name", `${patient.lastName}, ${patient.firstName}`],
    ["Date of birth", patient.dateOfBirth.toISOString().slice(0, 10)],
    ["Age", age(patient.dateOfBirth.toISOString().slice(0, 10))],
    ["Sex", fmt(patient.sex)],
    ["Phone", patient.phone ?? "—"],
    ["Email", patient.email ?? "—"],
    ["Address", [patient.address, patient.city].filter(Boolean).join(", ") || "—"],
    ["Emergency contact", patient.emergencyContactName ? `${patient.emergencyContactName} · ${patient.emergencyContactPhone ?? "—"}` : "—"],
    ["Blood group", fmt(patient.bloodGroup)],
    ["Registered", patient.createdAt.toISOString().slice(0, 10)],
  ];

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs text-muted-foreground">{patient.mrn}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {patient.firstName} {patient.lastName}
        </h1>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Demographics & contact
          </h2>
          <dl className="space-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-lg border p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Medical history
          </h2>
          {canSeeClinical ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Allergies</dt>
                <dd className="mt-0.5 whitespace-pre-wrap font-medium">{patient.allergies ?? "None recorded"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Chronic conditions</dt>
                <dd className="mt-0.5 whitespace-pre-wrap font-medium">{patient.chronicConditions ?? "None recorded"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap font-medium">{patient.notes ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Clinical history is visible to clinical roles only.
            </p>
          )}
        </div>
      </section>

      {clinical ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Clinical record
            </h2>
            {canAuthor ? (
              <StartEncounterForm
                patientId={patient.id}
                timeZone={clinical.timeZone}
                defaultDoctorId={clinical.ownProfileId ?? undefined}
                doctors={clinical.doctors.map((d) => ({
                  id: d.id,
                  name: d.name,
                  specialization: d.specialization,
                }))}
              />
            ) : null}
          </div>

          {clinical.encounters.length === 0 ? (
            <p className="rounded-lg border bg-white p-5 text-sm text-muted-foreground dark:bg-zinc-900">
              No encounters recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {clinical.encounters.map((e) => (
                <li key={e.id} className="rounded-lg border bg-white p-4 text-sm dark:bg-zinc-900">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {fmtStamp(e.occurredAt, clinical.timeZone)} · {kindLabel(e.kind)}{" "}
                        <span
                          className={
                            "rounded border px-1.5 py-0.5 text-xs " +
                            (e.status === "SIGNED"
                              ? "border-teal-600/40 text-teal-700 dark:text-teal-400"
                              : "border-amber-500/50 text-amber-700 dark:text-amber-400")
                          }
                        >
                          {e.status === "SIGNED" ? "signed" : "draft"}
                        </span>
                      </p>
                      <p className="text-muted-foreground">
                        {e.doctorName ? `${e.doctorName} · ` : ""}
                        {e.diagnosis ?? "No diagnosis yet"} · {e.noteCount} note(s)
                        {e.hasVitals ? " · vitals" : ""}
                      </p>
                    </div>
                    <Link
                      href={`/patients/${patient.id}/encounters/${e.id}`}
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      open record →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Latest vitals
            </h3>
            {clinical.vitals.length === 0 ? (
              <p className="text-muted-foreground">No vitals recorded.</p>
            ) : (
              <ul className="space-y-1">
                {clinical.vitals.slice(0, 5).map((v) => (
                  <li key={v.id} className="flex flex-wrap justify-between gap-2">
                    <span>{vitalsSummary(v)}</span>
                    <span className="text-muted-foreground">{fmtStamp(v.recordedAt, clinical.timeZone)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canRecordVitals ? (
              <div className="mt-3 border-t pt-3">
                <VitalsForm patientId={patient.id} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </h2>
        <PatientDocuments
          patientId={patient.id}
          canManage={canManage}
          attachments={patient.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            contentType: a.contentType,
            sizeBytes: a.sizeBytes,
            description: a.description,
            uploadedByName: a.uploadedBy?.name ?? null,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </section>
    </div>
  );
}
