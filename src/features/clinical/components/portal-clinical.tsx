import { fmtStamp, kindLabel, vitalsSummary } from "@/features/clinical/format";
import { listPortalClinicalSummary } from "@/features/clinical/queries";
import { getClinicTimeZone } from "@/features/doctors/queries";

/**
 * Server component: the patient's own signed visits and latest vitals. Scoped
 * by the patient id resolved from the portal session, and limited to SIGNED
 * encounters — a draft is still being written and is not patient-facing.
 */
export async function PortalClinicalSummary({
  patientId,
  clinicId,
}: {
  patientId: string;
  clinicId: string;
}) {
  const [summary, timeZone] = await Promise.all([
    listPortalClinicalSummary(patientId),
    getClinicTimeZone(clinicId),
  ]);

  return (
    <section className="rounded-lg border bg-white p-5 text-sm dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold uppercase tracking-wide text-muted-foreground">My visits</h2>
      {summary.encounters.length === 0 ? (
        <p className="text-muted-foreground">No completed visits on record yet.</p>
      ) : (
        <ul className="space-y-4">
          {summary.encounters.map((e) => (
            <li key={e.id} className="rounded-md border p-3">
              <p className="font-medium">
                {fmtStamp(e.occurredAt, timeZone)} · {kindLabel(e.kind)}
                {e.doctorName ? ` — ${e.doctorName}` : ""}
              </p>
              <dl className="mt-1 space-y-1 text-muted-foreground">
                <div>
                  <dt className="inline">Diagnosis: </dt>
                  <dd className="inline whitespace-pre-wrap">{e.diagnosis ?? "not recorded"}</dd>
                </div>
                <div>
                  <dt className="inline">Plan: </dt>
                  <dd className="inline whitespace-pre-wrap">{e.plan ?? "not recorded"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Recent vitals
      </h3>
      {summary.vitals.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {summary.vitals.slice(0, 5).map((v) => (
            <li key={v.id} className="flex flex-wrap justify-between gap-2">
              <span>{vitalsSummary(v)}</span>
              <span className="text-muted-foreground">{fmtStamp(v.recordedAt, timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Clinical notes stay with your care team. Ask reception if you need a copy of your records.
      </p>
    </section>
  );
}
