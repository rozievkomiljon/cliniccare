import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AddNoteForm,
  EncounterDraftForm,
  SignEncounterButton,
  VitalsForm,
} from "@/features/clinical/components/clinical-record";
import { fmtStamp, kindLabel, vitalsSummary } from "@/features/clinical/format";
import { getEncounterForClinic } from "@/features/clinical/queries";
import { getClinicTimeZone } from "@/features/doctors/queries";
import { hasPermission } from "@/lib/rbac/permissions";
import { requirePagePermission } from "@/lib/rbac/page-guard";

export const metadata = { title: "Clinical record" };

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ patientId: string; encounterId: string }>;
}) {
  const session = await requirePagePermission("clinical:view");
  const { patientId, encounterId } = await params;
  const clinicId = session.activeClinicId ?? "";

  const [record, timeZone] = await Promise.all([
    getEncounterForClinic(clinicId, encounterId),
    getClinicTimeZone(clinicId),
  ]);
  // The URL carries the patient too, so a mismatched pair is simply not found.
  if (!record || record.encounter.patientId !== patientId) notFound();

  const { encounter, notes, vitals } = record;
  const signed = encounter.status === "SIGNED";
  const canAuthor = hasPermission(session.activeRole, "clinical:author");
  const canRecordVitals = hasPermission(session.activeRole, "vitals:record");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href={`/patients/${patientId}`} className="text-teal-700 hover:underline dark:text-teal-400">
          ← Back to patient
        </Link>
        <Link href="/appointments" className="text-teal-700 hover:underline dark:text-teal-400">
          Calendar
        </Link>
      </nav>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {kindLabel(encounter.kind)} · {encounter.status}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Clinical record · {fmtStamp(encounter.occurredAt, timeZone)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {encounter.doctorName ? `${encounter.doctorName} · ` : ""}
          opened by {encounter.createdByName}
          {signed && encounter.signedAt
            ? ` · signed by ${encounter.signedByName ?? "—"} ${fmtStamp(encounter.signedAt, timeZone)}`
            : " · unsigned draft"}
        </p>
      </header>

      <section className="space-y-3 rounded-lg border bg-white p-5 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Assessment &amp; plan
        </h2>
        {signed ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Chief complaint</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-medium">{encounter.chiefComplaint ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Diagnosis</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-medium">{encounter.diagnosis ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-medium">{encounter.plan ?? "—"}</dd>
            </div>
          </dl>
        ) : canAuthor ? (
          <>
            <EncounterDraftForm encounter={encounter} />
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Signing finalises this record. Afterwards corrections are recorded as addenda, never as edits.
              </p>
              <SignEncounterButton encounterId={encounter.id} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This record is an unsigned draft.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-5 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Vitals ({vitals.length})
        </h2>
        {vitals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded for this visit yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {vitals.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2">
                <span>{vitalsSummary(v)}</span>
                <span className="text-muted-foreground">
                  {fmtStamp(v.recordedAt, timeZone)} · {v.recordedByName}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canRecordVitals ? <VitalsForm patientId={patientId} encounterId={encounter.id} /> : null}
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-5 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Notes ({notes.length})
        </h2>
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="border-l-2 border-teal-600/40 pl-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {kindLabel(n.kind)} · {n.authorName} · {fmtStamp(n.createdAt, timeZone)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ol>
        )}
        {canAuthor ? <AddNoteForm patientId={patientId} encounterId={encounter.id} signed={signed} /> : null}
      </section>
    </div>
  );
}
