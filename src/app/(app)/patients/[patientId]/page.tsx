import { notFound } from "next/navigation";

import { PatientDocuments } from "@/features/patients/components/patient-documents";
import { getPatientForClinic } from "@/features/patients/queries";
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
