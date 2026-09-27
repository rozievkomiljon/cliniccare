"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addClinicalNoteAction,
  openEncounterAction,
  recordVitalsAction,
  signEncounterAction,
  updateEncounterDraftAction,
} from "@/features/clinical/actions";
import { toLocalInputValue } from "@/lib/timezone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const labelCls = "block text-xs text-muted-foreground";
const inputCls = "mt-1 w-full";

type ActionResult = { ok: boolean; error?: string };

/** Shared submit plumbing: surface the server error, refresh the server tree. */
function useSubmit(onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, okMessage?: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await fn();
      if (result.ok) {
        if (okMessage) setNotice(okMessage);
        onDone?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });

  return { error, notice, pending, run, setError };
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? <p className="text-sm text-teal-700 dark:text-teal-400">{notice}</p> : null}
    </>
  );
}

/** Opens a clinical record for a visit; the author can still edit it until signing. */
export function StartEncounterForm({
  patientId,
  doctors,
  timeZone,
  defaultDoctorId,
}: {
  patientId: string;
  doctors: Array<{ id: string; name: string; specialization: string }>;
  timeZone: string;
  defaultDoctorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { error, pending, run, setError } = useSubmit(() => setOpen(false));

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Start clinical record</Button>;
  }

  return (
    <form
      className="w-full space-y-4 rounded-xl border bg-white p-5 dark:bg-zinc-900"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        run(
          () =>
            openEncounterAction({
              patientId,
              doctorId: String(form.get("doctorId") ?? ""),
              occurredAt: String(form.get("occurredAt") ?? ""),
              kind: String(form.get("kind") ?? "CONSULTATION") as never,
              chiefComplaint: String(form.get("chiefComplaint") ?? ""),
            }),
          "Clinical record opened.",
        );
      }}
    >
      <h3 className="text-sm font-semibold">Start clinical record</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="enc-doctor" className={labelCls}>
            Clinician
          </Label>
          <select
            id="enc-doctor"
            name="doctorId"
            aria-label="Clinician"
            defaultValue={defaultDoctorId}
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            <option value="">Not specified</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.specialization}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="enc-kind" className={labelCls}>
            Type
          </Label>
          <select
            id="enc-kind"
            name="kind"
            aria-label="Encounter type"
            defaultValue="CONSULTATION"
            className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {["CONSULTATION", "FOLLOW_UP", "PROCEDURE", "TELEHEALTH"].map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="enc-when" className={labelCls}>
            Date &amp; time ({timeZone})
          </Label>
          <Input
            id="enc-when"
            name="occurredAt"
            type="datetime-local"
            required
            aria-label="Encounter date and time"
            defaultValue={toLocalInputValue(new Date(), timeZone)}
            className={inputCls}
          />
        </div>
        <div>
          <Label htmlFor="enc-complaint" className={labelCls}>
            Chief complaint
          </Label>
          <Input id="enc-complaint" name="chiefComplaint" aria-label="Chief complaint" className={inputCls} />
        </div>
      </div>
      <Feedback error={error} notice={null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Opening…" : "Open record"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Edits an OPEN encounter. Signing is what freezes these fields. */
export function EncounterDraftForm({
  encounter,
}: {
  encounter: { id: string; chiefComplaint: string | null; diagnosis: string | null; plan: string | null };
}) {
  const { error, notice, pending, run } = useSubmit();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(
          () =>
            updateEncounterDraftAction({
              encounterId: encounter.id,
              chiefComplaint: String(form.get("chiefComplaint") ?? ""),
              diagnosis: String(form.get("diagnosis") ?? ""),
              plan: String(form.get("plan") ?? ""),
            }),
          "Draft saved.",
        );
      }}
    >
      <Feedback error={error} notice={notice} />
      <div>
        <Label htmlFor="draft-complaint" className={labelCls}>
          Chief complaint
        </Label>
        <Input
          id="draft-complaint"
          name="chiefComplaint"
          aria-label="Chief complaint"
          defaultValue={encounter.chiefComplaint ?? ""}
          className={inputCls}
        />
      </div>
      <div>
        <Label htmlFor="draft-diagnosis" className={labelCls}>
          Diagnosis
        </Label>
        <Input
          id="draft-diagnosis"
          name="diagnosis"
          aria-label="Diagnosis"
          defaultValue={encounter.diagnosis ?? ""}
          className={inputCls}
        />
      </div>
      <div>
        <Label htmlFor="draft-plan" className={labelCls}>
          Plan
        </Label>
        <textarea
          id="draft-plan"
          name="plan"
          aria-label="Plan"
          rows={4}
          defaultValue={encounter.plan ?? ""}
          className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );
}

/** Signs the record. One-way — afterwards corrections arrive as addenda. */
export function SignEncounterButton({ encounterId }: { encounterId: string }) {
  const { error, pending, run } = useSubmit();

  return (
    <div className="space-y-2">
      <Feedback error={error} notice={null} />
      <Button size="sm" disabled={pending} onClick={() => run(() => signEncounterAction({ encounterId }))}>
        {pending ? "Signing…" : "Sign record"}
      </Button>
    </div>
  );
}

/** Appends a note (or an addendum to a signed record). Never edits history. */
export function AddNoteForm({
  patientId,
  encounterId,
  signed,
}: {
  patientId: string;
  encounterId?: string;
  signed?: boolean;
}) {
  const { error, pending, run } = useSubmit();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = String(form.get("body") ?? "");
        const kind = String(form.get("kind") ?? "NOTE");
        event.currentTarget.reset();
        run(
          () => addClinicalNoteAction({ patientId, encounterId: encounterId ?? "", kind: kind as never, body }),
          "Note added.",
        );
      }}
    >
      <Feedback error={error} notice={null} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`note-kind-${encounterId ?? "patient"}`} className={labelCls}>
            Kind
          </Label>
          <select
            id={`note-kind-${encounterId ?? "patient"}`}
            name="kind"
            aria-label="Note kind"
            defaultValue={signed ? "ADDENDUM" : "NOTE"}
            className="mt-1 rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {["NOTE", "ADDENDUM", "PROCEDURE"].map((k) => (
              <option key={k} value={k}>
                {k.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor={`note-body-${encounterId ?? "patient"}`} className={labelCls}>
          Note
        </Label>
        <textarea
          id={`note-body-${encounterId ?? "patient"}`}
          name="body"
          aria-label="Note"
          rows={3}
          required
          className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : signed ? "Add addendum" : "Add note"}
      </Button>
    </form>
  );
}

/** Records one observation set. Blank fields are simply not measured. */
export function VitalsForm({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const { error, notice, pending, run } = useSubmit();

  const field = (name: keyof typeof FIELDS, label: string) => (
    <div>
      <Label htmlFor={`vitals-${name}`} className={labelCls}>
        {label}
      </Label>
      <Input
        id={`vitals-${name}`}
        name={name}
        aria-label={label}
        type="number"
        step={FIELDS[name].step}
        className={inputCls}
      />
    </div>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(
          () =>
            recordVitalsAction({
              patientId,
              encounterId: encounterId ?? "",
              systolic: String(form.get("systolic") ?? ""),
              diastolic: String(form.get("diastolic") ?? ""),
              pulse: String(form.get("pulse") ?? ""),
              temperature: String(form.get("temperature") ?? ""),
              spo2: String(form.get("spo2") ?? ""),
              weightKg: String(form.get("weightKg") ?? ""),
              heightCm: String(form.get("heightCm") ?? ""),
              notes: String(form.get("notes") ?? ""),
            }),
          "Vitals recorded.",
        );
      }}
    >
      <Feedback error={error} notice={notice} />
      <div className="grid gap-3 sm:grid-cols-4">
        {field("systolic", "Systolic")}
        {field("diastolic", "Diastolic")}
        {field("pulse", "Pulse")}
        {field("spo2", "SpO₂")}
        {field("temperature", "Temp °C")}
        {field("weightKg", "Weight kg")}
        {field("heightCm", "Height cm")}
        <div>
          <Label htmlFor="vitals-notes" className={labelCls}>
            Notes
          </Label>
          <Input id="vitals-notes" name="notes" aria-label="Vitals notes" className={inputCls} />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Recording…" : "Record vitals"}
      </Button>
    </form>
  );
}

const FIELDS = {
  systolic: { step: 1 },
  diastolic: { step: 1 },
  pulse: { step: 1 },
  spo2: { step: 1 },
  temperature: { step: 0.1 },
  weightKg: { step: 0.1 },
  heightCm: { step: 0.1 },
} as const;
