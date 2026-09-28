import Link from "next/link";

import { PortalAppointments } from "@/features/appointments/components/portal-appointments";
import { PortalClinicalSummary } from "@/features/clinical/components/portal-clinical";
import { PortalLabResults } from "@/features/lab/components/portal-lab";
import { listAppointmentsForPatient } from "@/features/appointments/queries";
import { getClinicTimeZone, listDoctors } from "@/features/doctors/queries";
import { getPatientForPortalUser } from "@/features/patients/queries";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "My health" };

export default async function PortalPage() {
  const session = await requirePagePermission("portal:access");

  // Row scoping: a portal account resolves to exactly one clinical record —
  // its own. There is no parameter by which another patient could be addressed.
  const patient = await getPatientForPortalUser(session.user.id);

  if (!patient) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">My health</h1>
        <p className="text-sm text-muted-foreground">
          Your portal account is not yet linked to a clinic record. Please contact reception.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs text-muted-foreground">{patient.mrn}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {patient.firstName} {patient.lastName}
        </h1>
      </header>

      <PortalAppointments
        appointments={await listAppointmentsForPatient(patient.id)}
        doctors={await listDoctors(patient.clinicId)}
        timeZone={await getClinicTimeZone(patient.clinicId)}
      />

      <PortalClinicalSummary patientId={patient.id} clinicId={patient.clinicId} />

      <PortalLabResults patientId={patient.id} clinicId={patient.clinicId} />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-5 text-sm">
          <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">My details</h2>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Date of birth</dt>
              <dd className="font-medium">{patient.dateOfBirth.toISOString().slice(0, 10)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-medium">{patient.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Allergies</dt>
              <dd className="font-medium">{patient.allergies ?? "None recorded"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Chronic conditions</dt>
              <dd className="font-medium">{patient.chronicConditions ?? "None recorded"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Something wrong?{" "}
            <Link href="/forbidden" className="underline">
              Contact your clinic
            </Link>{" "}
            to update your details.
          </p>
        </div>

        <div className="rounded-lg border p-5 text-sm">
          <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">My documents</h2>
          {patient.attachments.length === 0 ? (
            <p className="text-muted-foreground">No documents shared with you yet.</p>
          ) : (
            <ul className="space-y-2">
              {patient.attachments.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/patients/${patient.id}/documents/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    {a.fileName}
                  </a>
                  <span className="text-muted-foreground"> · {a.description ?? "document"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
